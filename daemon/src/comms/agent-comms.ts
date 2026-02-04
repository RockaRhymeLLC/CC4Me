/**
 * Agent-to-Agent Communication — receive, validate, queue, inject, send, log.
 *
 * Single module handling both inbound and outbound inter-agent messaging.
 * Messages are injected into the Claude Code session with [Agent] prefix,
 * queued when busy, and logged to agent-comms.log as JSONL.
 */

import fs from 'node:fs';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { loadConfig, resolveProjectPath } from '../core/config.js';
import type { AgentMessage, AgentMessageResponse, AgentCommsPeerConfig } from '../core/config.js';
import { validateAgentCommsAuth, getAgentCommsSecret } from '../core/keychain.js';
import { isBusy, isActivelyProcessing, injectText } from '../core/session-bridge.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('agent-comms');

// ── Types ─────────────────────────────────────────────────────

interface QueuedMessage {
  message: AgentMessage;
  receivedAt: number;
}

interface CommsLogEntry {
  ts: string;
  direction: 'in' | 'out';
  from: string;
  type: string;
  text?: string;
  messageId: string;
  queued: boolean;
  queued_duration_ms?: number;
  error?: string;
}

// ── State ─────────────────────────────────────────────────────

const messageQueue: QueuedMessage[] = [];
let drainInterval: ReturnType<typeof setInterval> | null = null;
const DRAIN_INTERVAL_MS = 3000;

const VALID_TYPES = ['text', 'status', 'coordination', 'pr-review'] as const;

// ── Display name mapping ──────────────────────────────────────

/**
 * Map agent IDs to display names for injection.
 * "r2d2" → "R2", "bmo" → "BMO", etc.
 */
function getDisplayName(agentId: string): string {
  const names: Record<string, string> = {
    r2d2: 'R2',
    bmo: 'BMO',
  };
  return names[agentId.toLowerCase()] ?? agentId;
}

// ── Message Formatting ────────────────────────────────────────

/**
 * Format an agent message for injection into Claude Code session.
 */
function formatMessage(msg: AgentMessage): string {
  const name = getDisplayName(msg.from);

  switch (msg.type) {
    case 'text':
      return `[Agent] ${name}: ${msg.text ?? ''}`;

    case 'status':
      return `[Agent] ${name}: [Status: ${msg.status ?? msg.text ?? 'unknown'}]`;

    case 'coordination': {
      const action = msg.action ?? 'unknown';
      const task = msg.task ?? msg.text ?? '';
      return `[Agent] ${name}: [Coordination: ${action} "${task}"]`;
    }

    case 'pr-review': {
      const parts = [`PR review request`];
      if (msg.repo) parts.push(`repo: ${msg.repo}`);
      if (msg.branch) parts.push(`branch: ${msg.branch}`);
      if (msg.pr) parts.push(`PR #${msg.pr}`);
      if (msg.text) parts.push(msg.text);
      return `[Agent] ${name}: [${parts.join(', ')}]`;
    }

    default:
      return `[Agent] ${name}: ${msg.text ?? JSON.stringify(msg)}`;
  }
}

// ── JSONL Logging ─────────────────────────────────────────────

function logCommsEntry(entry: CommsLogEntry): void {
  const logPath = resolveProjectPath('logs', 'agent-comms.log');

  // Ensure logs directory exists
  const logDir = resolveProjectPath('logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line);
}

// ── Validation ────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate an incoming agent message structure.
 */
function validateMessage(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const msg = body as Record<string, unknown>;

  if (!msg.from || typeof msg.from !== 'string') {
    return { valid: false, error: "'from' is required and must be a string" };
  }

  if (!msg.type || typeof msg.type !== 'string') {
    return { valid: false, error: "'type' is required and must be a string" };
  }

  if (!VALID_TYPES.includes(msg.type as typeof VALID_TYPES[number])) {
    return { valid: false, error: `Invalid message type '${msg.type}'. Valid types: ${VALID_TYPES.join(', ')}` };
  }

  if (!msg.messageId || typeof msg.messageId !== 'string') {
    return { valid: false, error: "'messageId' is required and must be a string" };
  }

  if (!msg.timestamp || typeof msg.timestamp !== 'string') {
    return { valid: false, error: "'timestamp' is required and must be a string" };
  }

  return { valid: true };
}

// ── Queue Drain ───────────────────────────────────────────────

function startDrain(): void {
  if (drainInterval) return; // Already running

  log.debug(`Queue drain started (${messageQueue.length} messages pending)`);

  drainInterval = setInterval(() => {
    if (messageQueue.length === 0) {
      stopDrain();
      return;
    }

    if (isActivelyProcessing()) {
      log.debug(`Agent actively processing, ${messageQueue.length} messages waiting`);
      return;
    }

    // Deliver all pending messages while not actively processing
    while (messageQueue.length > 0 && !isActivelyProcessing()) {
      const queued = messageQueue.shift()!;
      const formatted = formatMessage(queued.message);
      const durationMs = Date.now() - queued.receivedAt;

      injectText(formatted);
      log.info(`Delivered queued message from ${queued.message.from}`, {
        messageId: queued.message.messageId,
        queuedMs: durationMs,
      });

      logCommsEntry({
        ts: new Date().toISOString(),
        direction: 'in',
        from: queued.message.from,
        type: queued.message.type,
        text: queued.message.text,
        messageId: queued.message.messageId,
        queued: true,
        queued_duration_ms: durationMs,
      });
    }

    if (messageQueue.length === 0) {
      stopDrain();
    }
  }, DRAIN_INTERVAL_MS);
}

function stopDrain(): void {
  if (drainInterval) {
    clearInterval(drainInterval);
    drainInterval = null;
    log.debug('Queue drain stopped (queue empty)');
  }
}

// ── Handle Incoming Message ───────────────────────────────────

/**
 * Handle an incoming agent message. Called by the HTTP endpoint.
 *
 * @param authToken - Bearer token from Authorization header
 * @param body - Parsed JSON body
 * @returns Response object with status code and body
 */
export function handleAgentMessage(
  authToken: string | null,
  body: unknown,
): { status: number; body: AgentMessageResponse | { error: string } } {
  // Auth check
  if (!authToken || !validateAgentCommsAuth(authToken)) {
    log.warn('Agent message rejected: invalid auth', {
      hasToken: !!authToken,
    });
    return {
      status: 401,
      body: { error: 'Unauthorized: invalid or missing bearer token' },
    };
  }

  // Validate message structure
  const validation = validateMessage(body);
  if (!validation.valid) {
    log.warn('Agent message rejected: invalid structure', {
      error: validation.error,
    });
    return {
      status: 400,
      body: { error: validation.error! },
    };
  }

  const msg = body as AgentMessage;

  // Check if agent is actively processing → queue or inject
  const busy = isActivelyProcessing();

  if (busy) {
    messageQueue.push({ message: msg, receivedAt: Date.now() });
    startDrain();

    log.info(`Queued message from ${msg.from}`, {
      messageId: msg.messageId,
      type: msg.type,
      queueLength: messageQueue.length,
    });

    logCommsEntry({
      ts: new Date().toISOString(),
      direction: 'in',
      from: msg.from,
      type: msg.type,
      text: msg.text,
      messageId: msg.messageId,
      queued: true,
    });

    return {
      status: 200,
      body: { ok: true, queued: true },
    };
  }

  // Inject immediately
  const formatted = formatMessage(msg);
  injectText(formatted);

  log.info(`Delivered message from ${msg.from}`, {
    messageId: msg.messageId,
    type: msg.type,
  });

  logCommsEntry({
    ts: new Date().toISOString(),
    direction: 'in',
    from: msg.from,
    type: msg.type,
    text: msg.text,
    messageId: msg.messageId,
    queued: false,
  });

  return {
    status: 200,
    body: { ok: true, queued: false },
  };
}

// ── Send Outgoing Message ─────────────────────────────────────

/**
 * Send a message to a peer agent.
 *
 * @param peerName - Name of the peer (must match a peer in config)
 * @param type - Message type
 * @param text - Message text
 * @param extra - Additional fields (status, action, task, etc.)
 */
export async function sendAgentMessage(
  peerName: string,
  type: AgentMessage['type'],
  text?: string,
  extra?: Partial<Pick<AgentMessage, 'status' | 'action' | 'task' | 'context' | 'callbackUrl' | 'repo' | 'branch' | 'pr'>>,
): Promise<AgentMessageResponse> {
  const config = loadConfig();
  const agentComms = config['agent-comms'];

  if (!agentComms.enabled) {
    return { ok: false, queued: false, error: 'Agent comms not enabled' };
  }

  const peer = agentComms.peers.find(
    (p: AgentCommsPeerConfig) => p.name.toLowerCase() === peerName.toLowerCase(),
  );
  if (!peer) {
    return { ok: false, queued: false, error: `Unknown peer: ${peerName}` };
  }

  const secret = getAgentCommsSecret();
  if (!secret) {
    return { ok: false, queued: false, error: 'Agent comms secret not found in Keychain' };
  }

  const msg: AgentMessage = {
    from: config.agent.name.toLowerCase(),
    type,
    text,
    timestamp: new Date().toISOString(),
    messageId: crypto.randomUUID(),
    ...extra,
  };

  const payload = JSON.stringify(msg);
  const url = `http://${peer.host}:${peer.port}/agent/message`;

  // Use curl via child_process instead of Node.js http.request.
  // Node.js on macOS cannot make outbound TCP connections to LAN IPs
  // (EHOSTUNREACH) due to missing local network entitlements.
  // curl is not affected by this restriction.
  return new Promise<AgentMessageResponse>((resolve) => {
    const args = [
      '-s', '--connect-timeout', '5',
      '-X', 'POST', url,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${secret}`,
      '--data-raw', payload,
    ];

    execFile('curl', args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr?.trim() || err.message || 'unknown error';
        const errorResponse: AgentMessageResponse = {
          ok: false,
          queued: false,
          error: `Failed to reach peer ${peerName} (${peer.host}:${peer.port}): ${detail}`,
        };
        logCommsEntry({
          ts: new Date().toISOString(),
          direction: 'out',
          from: config.agent.name.toLowerCase(),
          type: msg.type,
          text: msg.text,
          messageId: msg.messageId,
          queued: false,
          error: errorResponse.error,
        });
        log.error(`Failed to send message to ${peerName}`, { error: detail, host: peer.host, port: peer.port });
        resolve(errorResponse);
        return;
      }

      try {
        const response = JSON.parse(stdout) as AgentMessageResponse;
        logCommsEntry({
          ts: new Date().toISOString(),
          direction: 'out',
          from: config.agent.name.toLowerCase(),
          type: msg.type,
          text: msg.text,
          messageId: msg.messageId,
          queued: response.queued ?? false,
        });
        resolve(response);
      } catch {
        const errorResponse: AgentMessageResponse = {
          ok: false,
          queued: false,
          error: `Invalid response from peer: ${stdout.slice(0, 200)}`,
        };
        logCommsEntry({
          ts: new Date().toISOString(),
          direction: 'out',
          from: config.agent.name.toLowerCase(),
          type: msg.type,
          text: msg.text,
          messageId: msg.messageId,
          queued: false,
          error: errorResponse.error,
        });
        resolve(errorResponse);
      }
    });
  });
}

// ── Agent Status ──────────────────────────────────────────────

/**
 * Get this agent's current status for the /agent/status endpoint.
 */
export function getAgentStatus(): { agent: string; status: 'idle' | 'busy'; uptime: number; queueLength: number } {
  const config = loadConfig();
  return {
    agent: config.agent.name,
    status: isBusy() ? 'busy' : 'idle',
    uptime: process.uptime(),
    queueLength: messageQueue.length,
  };
}

// ── Initialization ────────────────────────────────────────────

/**
 * Initialize agent comms. Called from main.ts on startup.
 */
export function initAgentComms(): void {
  const config = loadConfig();
  const agentComms = config['agent-comms'];

  if (!agentComms.enabled) {
    log.info('Agent comms disabled');
    return;
  }

  log.info('Agent comms initialized', {
    peers: agentComms.peers.length,
    peerNames: agentComms.peers.map((p: AgentCommsPeerConfig) => p.name),
  });
}

/**
 * Clean shutdown — stop the drain interval.
 */
export function stopAgentComms(): void {
  stopDrain();
  log.info('Agent comms stopped');
}
