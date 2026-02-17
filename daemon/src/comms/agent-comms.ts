/**
 * Agent-to-Agent Communication — receive, validate, inject, send, log.
 *
 * Single module handling both inbound and outbound inter-agent messaging.
 * Messages are injected directly into the Claude Code session with [Agent]
 * prefix (same as Telegram — tmux buffers input natively) and logged to
 * agent-comms.log as JSONL.
 */

import fs from 'node:fs';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { loadConfig, resolveProjectPath } from '../core/config.js';
import type { AgentMessage, AgentMessageResponse, AgentCommsPeerConfig, CC4MeConfig } from '../core/config.js';
import { validateAgentCommsAuth, getAgentCommsSecret } from '../core/keychain.js';
import { injectText } from '../core/session-bridge.js';
import { createLogger } from '../core/logger.js';
import { sendViaRelay } from './network/relay-client.js';
import { getNetworkClient } from './network/sdk-bridge.js';

const log = createLogger('agent-comms');

// ── Types ─────────────────────────────────────────────────────

export interface CommsLogEntry {
  ts: string;
  direction: 'in' | 'out' | 'relay-in' | 'relay-out';
  from: string;
  to?: string;
  type: string;
  text?: string;
  messageId: string;
  groupId?: string;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
}

const VALID_TYPES = ['text', 'status', 'coordination', 'pr-review'] as const;

// ── Display name mapping ──────────────────────────────────────

/**
 * Map agent IDs to display names for injection.
 * Reads from config peers, falls back to titlecasing the agent ID.
 */
function getDisplayName(agentId: string): string {
  const config = loadConfig();
  const peers = config['agent-comms']?.peers ?? [];
  for (const peer of peers) {
    if (peer.name.toLowerCase() === agentId.toLowerCase()) {
      // Use the peer name as-is (it's already the configured display name)
      return peer.name;
    }
  }
  // Fallback: titlecase the agent ID
  return agentId.charAt(0).toUpperCase() + agentId.slice(1);
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

const COMMS_LOG_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const COMMS_LOG_MAX_FILES = 3;

function rotateCommsLogIfNeeded(logPath: string): void {
  try {
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size < COMMS_LOG_MAX_SIZE) return;

    // Rotate: agent-comms.log -> .1 -> .2 -> ...
    for (let i = COMMS_LOG_MAX_FILES - 1; i >= 1; i--) {
      const src = `${logPath}.${i}`;
      const dst = `${logPath}.${i + 1}`;
      if (fs.existsSync(src)) {
        if (i + 1 >= COMMS_LOG_MAX_FILES) {
          fs.unlinkSync(src);
        } else {
          fs.renameSync(src, dst);
        }
      }
    }
    fs.renameSync(logPath, `${logPath}.1`);
    log.info('Rotated agent-comms.log');
  } catch (err) {
    log.warn('Failed to rotate agent-comms.log', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function logCommsEntry(entry: CommsLogEntry): void {
  const logPath = resolveProjectPath('logs', 'agent-comms.log');

  // Ensure logs directory exists
  const logDir = resolveProjectPath('logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  rotateCommsLogIfNeeded(logPath);
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

// ── Handle Incoming Message ───────────────────────────────────

/**
 * Handle an incoming agent message. Called by the HTTP endpoint.
 *
 * Injects directly into the tmux session — same as Telegram.
 * tmux buffers input natively, so no queue/drain needed.
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

  // Inject directly — tmux handles buffering if Claude is mid-response
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
    to: loadConfig().agent.name.toLowerCase(),
    type: msg.type,
    text: msg.text,
    messageId: msg.messageId,
  });

  return {
    status: 200,
    body: { ok: true, queued: false },
  };
}

// ── Send Outgoing Message ─────────────────────────────────────

// ── LAN Send (curl) ──────────────────────────────────────────

/**
 * Send a message to a peer via LAN (direct HTTP using curl).
 * Uses curl instead of Node.js http.request to avoid macOS EHOSTUNREACH.
 */
function sendViaLAN(
  peer: AgentCommsPeerConfig,
  msg: AgentMessage,
  secret: string,
  config: CC4MeConfig,
): Promise<AgentMessageResponse> {
  const payload = JSON.stringify(msg);
  const hosts: string[] = [peer.host];
  if (peer.ip && peer.ip !== peer.host) hosts.push(peer.ip);
  const startTime = Date.now();

  return new Promise<AgentMessageResponse>((resolve) => {
    const trySend = (hostIdx: number): void => {
      const host = hosts[hostIdx];
      const url = `http://${host}:${peer.port}/agent/message`;

      const args = [
        '-s', '--connect-timeout', '5',
        '-w', '\n%{http_code}',
        '-X', 'POST', url,
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${secret}`,
        '--data-raw', payload,
      ];

      execFile('curl', args, { timeout: 10000 }, (err, stdout, stderr) => {
        const latencyMs = Date.now() - startTime;

        if (err) {
          if (hostIdx + 1 < hosts.length) {
            log.info(`Connection to ${peer.name} (${host}) failed, trying fallback IP ${hosts[hostIdx + 1]}`);
            trySend(hostIdx + 1);
            return;
          }
          const detail = stderr?.trim() || err.message || 'unknown error';
          const errorResponse: AgentMessageResponse = {
            ok: false,
            queued: false,
            error: `Failed to reach peer ${peer.name} (${peer.host}:${peer.port}): ${detail}`,
          };
          logCommsEntry({
            ts: new Date().toISOString(),
            direction: 'out',
            from: config.agent.name.toLowerCase(),
            to: peer.name,
            type: msg.type,
            text: msg.text,
            messageId: msg.messageId,
            latencyMs,
            error: errorResponse.error,
          });
          log.error(`LAN send failed to ${peer.name}`, { error: detail, latencyMs });
          resolve(errorResponse);
          return;
        }

        const lines = stdout.trimEnd().split('\n');
        const httpStatus = parseInt(lines.pop() ?? '', 10) || undefined;
        const responseBody = lines.join('\n');

        try {
          const response = JSON.parse(responseBody) as AgentMessageResponse;
          const via = hostIdx > 0 ? ` (via fallback IP ${host})` : '';
          logCommsEntry({
            ts: new Date().toISOString(),
            direction: 'out',
            from: config.agent.name.toLowerCase(),
            to: peer.name,
            type: msg.type,
            text: msg.text,
            messageId: msg.messageId,
            httpStatus,
            latencyMs,
          });
          log.info(`Sent to ${peer.name} via LAN${via}`, { messageId: msg.messageId, type: msg.type, httpStatus, latencyMs });
          resolve(response);
        } catch {
          const errorResponse: AgentMessageResponse = {
            ok: false,
            queued: false,
            error: `Invalid response from peer (HTTP ${httpStatus ?? '?'}): ${responseBody.slice(0, 200)}`,
          };
          logCommsEntry({
            ts: new Date().toISOString(),
            direction: 'out',
            from: config.agent.name.toLowerCase(),
            to: peer.name,
            type: msg.type,
            text: msg.text,
            messageId: msg.messageId,
            httpStatus,
            latencyMs,
            error: errorResponse.error,
          });
          log.warn(`Bad LAN response from ${peer.name}`, { httpStatus, latencyMs });
          resolve(errorResponse);
        }
      });
    };

    trySend(0);
  });
}

// ── Send Outgoing Message ─────────────────────────────────────

/**
 * Send a message to a peer agent.
 * Tries LAN direct first (if peer is configured), then relay fallback.
 * If peer is not in LAN config but network is enabled, sends via relay only.
 *
 * @param peerName - Name of the peer
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
  const networkEnabled = config.network?.enabled ?? false;

  // Need either LAN comms or network enabled
  if (!agentComms.enabled && !networkEnabled) {
    return { ok: false, queued: false, error: 'Neither agent comms nor network enabled' };
  }

  // Look up LAN peer config (may not exist for relay-only peers)
  const peer = agentComms.enabled
    ? agentComms.peers.find((p: AgentCommsPeerConfig) => p.name.toLowerCase() === peerName.toLowerCase())
    : undefined;

  const msg: AgentMessage = {
    from: config.agent.name.toLowerCase(),
    type,
    text,
    timestamp: new Date().toISOString(),
    messageId: crypto.randomUUID(),
    ...extra,
  };

  // Strategy 1: LAN peer configured → try LAN first, then relay fallback
  let lanResult: AgentMessageResponse | null = null;
  if (peer && agentComms.enabled) {
    const secret = getAgentCommsSecret();
    if (secret) {
      lanResult = await sendViaLAN(peer, msg, secret, config);
      if (lanResult.ok) return lanResult;
    } else {
      lanResult = { ok: false, queued: false, error: 'Agent comms secret not found in Keychain' };
    }
  }

  // Strategy 2: P2P via SDK (E2E encrypted, presence-gated, retry queue)
  const networkClient = getNetworkClient();
  if (networkClient) {
    try {
      const sendResult = await networkClient.send(peerName, {
        type: msg.type,
        text: msg.text,
        from: msg.from,
        timestamp: msg.timestamp,
        messageId: msg.messageId,
        ...(msg.status && { status: msg.status }),
        ...(msg.action && { action: msg.action }),
        ...(msg.task && { task: msg.task }),
        ...(msg.context && { context: msg.context }),
      });

      if (sendResult.status === 'delivered' || sendResult.status === 'queued') {
        const direction = sendResult.status === 'delivered' ? 'relay-out' : 'relay-out';
        logCommsEntry({
          ts: new Date().toISOString(),
          direction,
          from: config.agent.name.toLowerCase(),
          to: peerName,
          type: msg.type,
          text: msg.text,
          messageId: msg.messageId,
        });
        log.info(`Sent to ${peerName} via P2P SDK (${sendResult.status})`, {
          messageId: msg.messageId,
          type: msg.type,
        });
        return { ok: true, queued: sendResult.status === 'queued' };
      }

      // SDK send failed — fall through to legacy relay
      log.warn(`P2P SDK send failed to ${peerName}`, { error: sendResult.error });
    } catch (err) {
      log.warn(`P2P SDK send error`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Strategy 3: Legacy v1 relay fallback
  if (networkEnabled) {
    const relayResult = await sendViaRelay(peerName, msg);
    if (relayResult.ok) {
      logCommsEntry({
        ts: new Date().toISOString(),
        direction: 'relay-out',
        from: config.agent.name.toLowerCase(),
        to: peerName,
        type: msg.type,
        text: msg.text,
        messageId: msg.messageId,
      });
      log.info(`Sent to ${peerName} via legacy relay`, { messageId: msg.messageId, type: msg.type });
      return { ok: true, queued: false };
    }

    // All strategies failed
    const errors: string[] = [];
    if (lanResult) errors.push(`LAN: ${lanResult.error}`);
    if (networkClient) errors.push('P2P: SDK send failed');
    errors.push(`Relay: ${relayResult.error}`);
    return { ok: false, queued: false, error: errors.join('; ') };
  }

  // No relay — return LAN result or unknown peer error
  if (lanResult) return lanResult;
  return { ok: false, queued: false, error: `Unknown peer: ${peerName}` };
}

// ── Peer State Cache ─────────────────────────────────────────

export interface PeerState {
  status: 'idle' | 'busy' | 'unknown';
  updatedAt: number;   // Date.now()
  latencyMs?: number;
}

/** Cached peer states from heartbeat exchanges. */
const _peerStates = new Map<string, PeerState>();

/** Update cached state for a peer (called by peer-heartbeat task). */
export function updatePeerState(peerName: string, state: PeerState): void {
  _peerStates.set(peerName.toLowerCase(), state);
}

/** Get cached state for a specific peer. */
export function getPeerState(peerName: string): PeerState | undefined {
  return _peerStates.get(peerName.toLowerCase());
}

/** Get all cached peer states. */
export function getAllPeerStates(): Record<string, PeerState> {
  const result: Record<string, PeerState> = {};
  for (const [name, state] of _peerStates) {
    result[name] = state;
  }
  return result;
}

// ── Agent Status ──────────────────────────────────────────────

export interface AgentStatusResponse {
  agent: string;
  status: 'idle' | 'busy';
  uptime: number;
}

/**
 * Get this agent's current status for the /agent/status endpoint.
 * Used for both GET (simple status check) and POST (heartbeat exchange).
 */
export function getAgentStatus(): AgentStatusResponse {
  const config = loadConfig();
  return {
    agent: config.agent.name,
    status: 'idle', // Always idle — busy detection removed
    uptime: process.uptime(),
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
 * Clean shutdown.
 */
export function stopAgentComms(): void {
  log.info('Agent comms stopped');
}
