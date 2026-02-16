/**
 * Relay client — send messages via relay, poll inbox, ack messages.
 *
 * Uses native fetch() (Node 22 built-in) for all relay communication.
 * The macOS EHOSTUNREACH bug only affects LAN IPs — relay is public internet.
 *
 * Auth: X-Agent + X-Signature headers with Ed25519 per-request signatures.
 * POST: sign the JSON body. GET: sign "METHOD /path TIMESTAMP".
 */

import crypto from 'node:crypto';
import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { signPayload, verifySignature, loadKeyFromKeychain } from './crypto.js';
import type { AgentMessage } from '../../core/config.js';

const log = createLogger('network:relay-client');

// ── Directory Cache ──────────────────────────────────────────

interface DirectoryEntry {
  name: string;
  publicKey: string;
  status: string;
}

let _directoryCache: DirectoryEntry[] | null = null;
let _directoryCacheTime = 0;
const DIRECTORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the agent directory from the relay. Cached for 5 minutes.
 */
async function getDirectory(): Promise<DirectoryEntry[]> {
  const now = Date.now();
  if (_directoryCache && now - _directoryCacheTime < DIRECTORY_CACHE_TTL) {
    return _directoryCache;
  }

  const config = loadConfig();
  const relayUrl = config.network?.relay_url;
  if (!relayUrl) throw new Error('Relay URL not configured');

  const response = await fetch(`${relayUrl}/registry/agents`);
  if (!response.ok) throw new Error(`Directory fetch failed: HTTP ${response.status}`);

  _directoryCache = await response.json() as DirectoryEntry[];
  _directoryCacheTime = now;
  return _directoryCache;
}

/**
 * Get a specific agent's public key from the directory.
 */
export async function getAgentPublicKey(agentName: string): Promise<string | null> {
  try {
    const directory = await getDirectory();
    const agent = directory.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    return agent?.publicKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear the directory cache (useful after new agents are added/approved).
 */
export function clearDirectoryCache(): void {
  _directoryCache = null;
  _directoryCacheTime = 0;
}

// ── Send via Relay ───────────────────────────────────────────

/**
 * Send a message to another agent via the relay.
 * Signs the message body with our private key.
 */
export async function sendViaRelay(
  to: string,
  msg: AgentMessage,
): Promise<{ ok: boolean; error?: string }> {
  const config = loadConfig();
  const relayUrl = config.network?.relay_url;
  if (!relayUrl) return { ok: false, error: 'Relay URL not configured' };

  const privateKey = loadKeyFromKeychain();
  if (!privateKey) return { ok: false, error: 'No agent key in Keychain' };

  const agentName = config.agent.name.toLowerCase();

  // Build relay message with required fields
  const relayMsg = {
    from: agentName,
    to: to.toLowerCase(),
    type: msg.type,
    text: msg.text,
    timestamp: msg.timestamp,
    messageId: msg.messageId,
    nonce: crypto.randomUUID(),
    // Include optional fields if present
    ...(msg.status && { status: msg.status }),
    ...(msg.action && { action: msg.action }),
    ...(msg.task && { task: msg.task }),
    ...(msg.context && { context: msg.context }),
    ...(msg.repo && { repo: msg.repo }),
    ...(msg.branch && { branch: msg.branch }),
    ...(msg.pr && { pr: msg.pr }),
  };

  const body = JSON.stringify(relayMsg);
  const signature = signPayload(body, privateKey);

  try {
    const response = await fetch(`${relayUrl}/relay/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent': agentName,
        'X-Signature': signature,
      },
      body,
    });

    const data = await response.json() as { ok?: boolean; error?: string; messageId?: string };

    if (response.ok && data.ok) {
      log.info(`Sent message via relay to ${to}`, { messageId: msg.messageId });
      return { ok: true };
    }

    return { ok: false, error: data.error || `HTTP ${response.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Relay send failed', { error: message, to });
    return { ok: false, error: message };
  }
}

// ── Poll Inbox ───────────────────────────────────────────────

export interface RelayInboxMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  text?: string;
  payload: string;
  signature: string;
  createdAt: string;
  verified: boolean;
}

/**
 * Poll the relay inbox for pending messages.
 * Verifies each message's signature against the sender's public key.
 */
export async function pollRelayInbox(): Promise<RelayInboxMessage[]> {
  const config = loadConfig();
  const relayUrl = config.network?.relay_url;
  if (!relayUrl) return [];

  const privateKey = loadKeyFromKeychain();
  if (!privateKey) return [];

  const agentName = config.agent.name.toLowerCase();

  // Sign the GET request: "GET /inbox/:agent TIMESTAMP"
  // Note: Express req.path strips the router mount prefix (/relay),
  // so the server sees /inbox/:agent, not /relay/inbox/:agent
  const timestamp = new Date().toISOString();
  const sigPayload = `GET /inbox/${agentName} ${timestamp}`;
  const signature = signPayload(sigPayload, privateKey);

  try {
    const response = await fetch(`${relayUrl}/relay/inbox/${agentName}`, {
      headers: {
        'X-Agent': agentName,
        'X-Signature': signature,
        'X-Timestamp': timestamp,
      },
    });

    if (!response.ok) {
      log.warn(`Inbox poll failed: HTTP ${response.status}`);
      return [];
    }

    const messages = await response.json() as RelayInboxMessage[];

    // Verify each message's signature against the sender's public key
    for (const msg of messages) {
      const senderKey = await getAgentPublicKey(msg.from);
      if (senderKey && msg.payload && msg.signature) {
        msg.verified = verifySignature(msg.payload, msg.signature, senderKey);
      } else {
        msg.verified = false;
      }
    }

    return messages;
  } catch (err) {
    log.warn('Inbox poll error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Acknowledge Messages ─────────────────────────────────────

/**
 * Acknowledge received messages (deletes them from relay inbox).
 */
export async function ackRelayMessages(messageIds: string[]): Promise<boolean> {
  if (messageIds.length === 0) return true;

  const config = loadConfig();
  const relayUrl = config.network?.relay_url;
  if (!relayUrl) return false;

  const privateKey = loadKeyFromKeychain();
  if (!privateKey) return false;

  const agentName = config.agent.name.toLowerCase();
  const body = JSON.stringify({ messageIds });
  const signature = signPayload(body, privateKey);

  try {
    const response = await fetch(`${relayUrl}/relay/inbox/${agentName}/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent': agentName,
        'X-Signature': signature,
      },
      body,
    });

    if (!response.ok) {
      log.warn(`Ack failed: HTTP ${response.status}`);
      return false;
    }

    return true;
  } catch (err) {
    log.warn('Ack error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
