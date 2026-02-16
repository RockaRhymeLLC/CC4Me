/**
 * Relay Inbox Poll task — fetches messages from the relay service.
 *
 * Runs every 30 seconds. Polls the relay inbox, verifies message
 * signatures, injects valid messages into the Claude Code session,
 * and acknowledges them. Invalid signatures are logged and discarded.
 *
 * requiresSession: false — polls regardless of session state,
 * but only injects messages when a session exists.
 */

import fs from 'node:fs';
import { loadConfig, resolveProjectPath } from '../../core/config.js';
import { sessionExists, injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { pollRelayInbox, ackRelayMessages } from '../../comms/network/relay-client.js';
import type { AgentMessage } from '../../core/config.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('relay-inbox-poll');

/** Map agent IDs to display names. */
function getDisplayName(agentId: string): string {
  const names: Record<string, string> = { r2d2: 'R2', bmo: 'BMO' };
  return names[agentId.toLowerCase()] ?? agentId;
}

/** Format a relay message for session injection. */
function formatRelayMessage(from: string, payload: string): string {
  const displayName = getDisplayName(from);

  try {
    const msg = JSON.parse(payload) as AgentMessage;

    switch (msg.type) {
      case 'text':
        return `[Agent] ${displayName}: ${msg.text ?? ''}`;
      case 'status':
        return `[Agent] ${displayName}: [Status: ${msg.status ?? msg.text ?? 'unknown'}]`;
      case 'coordination': {
        const action = msg.action ?? 'unknown';
        const task = msg.task ?? msg.text ?? '';
        return `[Agent] ${displayName}: [Coordination: ${action} "${task}"]`;
      }
      case 'pr-review': {
        const parts = ['PR review request'];
        if (msg.repo) parts.push(`repo: ${msg.repo}`);
        if (msg.branch) parts.push(`branch: ${msg.branch}`);
        if (msg.pr) parts.push(`PR #${msg.pr}`);
        if (msg.text) parts.push(msg.text);
        return `[Agent] ${displayName}: [${parts.join(', ')}]`;
      }
      default:
        return `[Agent] ${displayName}: ${msg.text ?? ''}`;
    }
  } catch {
    // Payload not parseable — use raw text
    return `[Agent] ${displayName}: (relay message)`;
  }
}

/** Log a comms entry to agent-comms.log. */
function logCommsEntry(entry: Record<string, unknown>): void {
  const logDir = resolveProjectPath('logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logPath = resolveProjectPath('logs', 'agent-comms.log');
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

async function run(): Promise<void> {
  const config = loadConfig();
  if (!config.network?.enabled) return;

  const messages = await pollRelayInbox();
  if (messages.length === 0) return;

  log.info(`Received ${messages.length} relay message(s)`);
  const idsToAck: string[] = [];

  for (const msg of messages) {
    if (!msg.verified) {
      log.warn('Discarding message with invalid signature', {
        from: msg.from,
        id: msg.id,
      });
      logCommsEntry({
        ts: new Date().toISOString(),
        direction: 'relay-in',
        from: msg.from,
        type: msg.type,
        messageId: msg.id,
        error: 'Invalid signature — discarded',
      });
      idsToAck.push(msg.id); // Still ack to remove from inbox
      continue;
    }

    // Format and inject into session
    const formatted = formatRelayMessage(msg.from, msg.payload);

    if (sessionExists()) {
      injectText(formatted);
    } else {
      log.info('No session — relay message logged but not injected', {
        from: msg.from,
        id: msg.id,
      });
    }

    logCommsEntry({
      ts: new Date().toISOString(),
      direction: 'relay-in',
      from: msg.from,
      to: config.agent.name.toLowerCase(),
      type: msg.type,
      text: msg.text,
      messageId: msg.id,
    });

    idsToAck.push(msg.id);
  }

  // Acknowledge all processed messages
  if (idsToAck.length > 0) {
    const acked = await ackRelayMessages(idsToAck);
    if (acked) {
      log.info(`Acknowledged ${idsToAck.length} relay message(s)`);
    } else {
      log.warn('Failed to acknowledge relay messages', { count: idsToAck.length });
    }
  }
}

registerTask({ name: 'relay-inbox-poll', run, requiresSession: false });
