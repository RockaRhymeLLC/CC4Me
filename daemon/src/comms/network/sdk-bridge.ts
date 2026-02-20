/**
 * SDK Bridge — integrates the CC4Me Network SDK into the daemon.
 *
 * Initializes the CC4MeNetwork client with config from cc4me.config.yaml,
 * wires SDK events to the session bridge, and exposes the network client
 * for use by agent-comms (P2P encrypted messaging fallback).
 *
 * If initialization fails (bad config, no key, relay unreachable), the daemon
 * degrades gracefully to LAN-only mode — no crash.
 */

import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { sessionExists, injectText } from '../../core/session-bridge.js';
import { loadKeyFromKeychain } from './crypto.js';
import { logCommsEntry } from '../agent-comms.js';

const log = createLogger('network:sdk');

// cc4me-network types — resolved dynamically to avoid crash if SDK isn't built
type CC4MeNetwork = import('cc4me-network').CC4MeNetwork;
type Message = import('cc4me-network').Message;
type ContactRequest = import('cc4me-network').ContactRequest;
type Broadcast = import('cc4me-network').Broadcast;
type GroupMessage = import('cc4me-network').GroupMessage;
type GroupInvitationEvent = import('cc4me-network').GroupInvitationEvent;

/** Re-export WireEnvelope type for callers that need it. */
export type WireEnvelope = import('cc4me-network').WireEnvelope;

let _network: CC4MeNetwork | null = null;

/**
 * Get the active CC4MeNetwork client (null if SDK not initialized).
 */
export function getNetworkClient(): CC4MeNetwork | null {
  return _network;
}

/**
 * Initialize the CC4Me Network SDK.
 *
 * Reads config, loads private key from Keychain, creates the CC4MeNetwork
 * instance, wires events, and starts the client (heartbeat + retry queue).
 *
 * Returns true if initialization succeeded, false if degraded to LAN-only.
 */
export async function initNetworkSDK(): Promise<boolean> {
  const config = loadConfig();
  const networkConfig = config.network;

  if (!networkConfig?.enabled) {
    log.info('Network SDK disabled');
    return false;
  }

  if (!networkConfig.relay_url) {
    log.warn('Network SDK: no relay_url configured');
    return false;
  }

  if (!networkConfig.endpoint) {
    log.warn('Network SDK: no endpoint configured — P2P messaging requires a public endpoint');
    return false;
  }

  // Load private key from Keychain
  const privateKeyBase64 = loadKeyFromKeychain();
  if (!privateKeyBase64) {
    log.warn('Network SDK: no agent key in Keychain — run registration first');
    return false;
  }

  // Dynamically import the SDK — if cc4me-network isn't built, we degrade gracefully
  let CC4MeNetworkClass: { new (opts: any): CC4MeNetwork };
  try {
    const sdk = await import('cc4me-network');
    CC4MeNetworkClass = sdk.CC4MeNetwork;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ERR_MODULE_NOT_FOUND') || msg.includes('Cannot find')) {
      log.error(
        'Network SDK: cc4me-network package not found. ' +
        'Build it with: cd ~/cc4me-network/packages/sdk && npm run build ' +
        'then: cd <project>/daemon && npm install'
      );
    } else {
      log.error('Network SDK: failed to load cc4me-network', { error: msg });
    }
    return false;
  }

  try {
    const privateKeyBuffer = Buffer.from(privateKeyBase64, 'base64');
    const agentName = config.agent.name.toLowerCase();

    _network = new CC4MeNetworkClass({
      relayUrl: networkConfig.relay_url,
      username: agentName,
      privateKey: privateKeyBuffer,
      endpoint: networkConfig.endpoint,
      dataDir: '.claude/state/network-cache',
      heartbeatInterval: networkConfig.heartbeat_interval ?? 300_000,
    });

    // Wire events
    wireMessageEvent();
    wireGroupMessageEvent();
    wireGroupInvitationEvent();
    wireContactRequestEvent(networkConfig.auto_approve_contacts ?? false);
    wireBroadcastEvent();

    // Start the client (loads cache, sends heartbeat, starts retry queue)
    await _network!.start();

    log.info('Network SDK initialized', {
      relay: networkConfig.relay_url,
      endpoint: networkConfig.endpoint,
      agent: agentName,
    });

    return true;
  } catch (err) {
    log.error('Network SDK initialization failed — degrading to LAN-only', {
      error: err instanceof Error ? err.message : String(err),
    });
    _network = null;
    return false;
  }
}

/**
 * Process an incoming P2P message envelope.
 * Called from the HTTP endpoint when another agent POSTs to our /agent/p2p.
 *
 * Handles both direct messages and group messages based on envelope type.
 * Returns true if the message was processed, false otherwise.
 */
export async function handleIncomingP2P(envelope: WireEnvelope): Promise<boolean> {
  if (!_network) {
    log.warn('Received P2P message but SDK not initialized');
    return false;
  }

  try {
    if (envelope.type === 'group') {
      // Group message — async processing with decryption + member validation
      const msg = await _network.receiveGroupMessage(envelope);
      if (!msg) {
        log.info('Group message deduplicated', { messageId: envelope.messageId });
      }
      return true;
    } else {
      // Direct message or other envelope types
      _network.receiveMessage(envelope);
      return true;
    }
  } catch (err) {
    log.warn('Failed to process incoming P2P message', {
      error: err instanceof Error ? err.message : String(err),
      sender: envelope.sender,
      type: envelope.type,
    });
    return false;
  }
}

/**
 * Stop the network SDK. Called on daemon shutdown.
 */
export async function stopNetworkSDK(): Promise<void> {
  if (_network) {
    await _network.stop();
    _network = null;
    log.info('Network SDK stopped');
  }
}

// ── Event Wiring ─────────────────────────────────────────────

/** Map agent usernames to display names. */
function getDisplayName(agentId: string): string {
  const names: Record<string, string> = { r2d2: 'R2', bmo: 'BMO' };
  return names[agentId.toLowerCase()] ?? agentId;
}

/** Wire 'message' event → session bridge injection. */
function wireMessageEvent(): void {
  if (!_network) return;

  _network.on('message', (msg: Message) => {
    const displayName = getDisplayName(msg.sender);
    const text = msg.payload?.text ?? JSON.stringify(msg.payload);
    const verified = msg.verified ? '' : ' [UNVERIFIED]';
    const formatted = `[Network] ${displayName}${verified}: ${text}`;

    if (sessionExists()) {
      injectText(formatted);
    } else {
      log.info('No session — network message logged but not injected', {
        from: msg.sender,
        messageId: msg.messageId,
      });
    }

    logCommsEntry({
      ts: new Date().toISOString(),
      direction: 'in',
      from: msg.sender,
      to: loadConfig().agent.name.toLowerCase(),
      type: 'text',
      text: String(text),
      messageId: msg.messageId,
    });
  });
}

/** Wire 'group-message' event → session bridge injection with [Group:name] prefix. */
function wireGroupMessageEvent(): void {
  if (!_network) return;

  _network.on('group-message', (msg: GroupMessage) => {
    const displayName = getDisplayName(msg.sender);
    const text = msg.payload?.text ?? JSON.stringify(msg.payload);
    const verified = msg.verified ? '' : ' [UNVERIFIED]';
    // Use groupId prefix (truncated) since we don't have group name readily available
    const groupTag = msg.groupId.slice(0, 8);
    const formatted = `[Group:${groupTag}] ${displayName}${verified}: ${text}`;

    if (sessionExists()) {
      injectText(formatted);
    } else {
      log.info('No session — group message logged but not injected', {
        from: msg.sender,
        groupId: msg.groupId,
        messageId: msg.messageId,
      });
    }

    logCommsEntry({
      ts: new Date().toISOString(),
      direction: 'in',
      from: msg.sender,
      to: loadConfig().agent.name.toLowerCase(),
      type: 'group-message',
      text: String(text),
      messageId: msg.messageId,
      groupId: msg.groupId,
    });
  });
}

/** Wire 'group-invitation' event → session bridge notification. */
function wireGroupInvitationEvent(): void {
  if (!_network) return;

  _network.on('group-invitation', (inv: GroupInvitationEvent) => {
    const displayName = getDisplayName(inv.invitedBy);
    const greeting = inv.greeting ? `: "${inv.greeting}"` : '';
    const formatted = `[Network] Group invitation: "${inv.groupName}" from ${displayName}${greeting}. Accept with: network.acceptGroupInvitation('${inv.groupId}')`;

    if (sessionExists()) {
      injectText(formatted);
    } else {
      log.info('No session — group invitation logged', {
        groupId: inv.groupId,
        groupName: inv.groupName,
        invitedBy: inv.invitedBy,
      });
    }

    log.info('Received group invitation', {
      groupId: inv.groupId,
      groupName: inv.groupName,
      invitedBy: inv.invitedBy,
    });
  });
}

/** Wire 'contact-request' event → session bridge prompt. */
function wireContactRequestEvent(autoApprove: boolean): void {
  if (!_network) return;
  const network = _network;

  _network.on('contact-request', async (req: ContactRequest) => {
    const displayName = getDisplayName(req.from);

    if (autoApprove) {
      try {
        await network.acceptContact(req.from);
        log.info(`Auto-approved contact request from ${req.from}`);
        if (sessionExists()) {
          injectText(`[Network] Auto-approved contact request from ${displayName}`);
        }
      } catch (err) {
        log.error('Failed to auto-approve contact', {
          from: req.from,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // Prompt for manual approval
    const greeting = (req as any).greeting ? `: "${(req as any).greeting}"` : '';
    const prompt = `[Network] Contact request from ${displayName}${greeting}. Accept with: network.acceptContact('${req.from}')`;

    if (sessionExists()) {
      injectText(prompt);
    } else {
      log.info('No session — contact request logged', { from: req.from });
    }
  });
}

/** Wire 'broadcast' event → session bridge display. */
function wireBroadcastEvent(): void {
  if (!_network) return;

  _network.on('broadcast', (broadcast: Broadcast) => {
    const displayName = getDisplayName(broadcast.sender);
    const summary = broadcast.payload?.message ?? broadcast.type;
    const formatted = `[Network Broadcast] ${displayName}: [${broadcast.type}] ${summary}`;

    if (sessionExists()) {
      injectText(formatted);
    }

    log.info('Received broadcast', {
      type: broadcast.type,
      sender: broadcast.sender,
    });
  });
}
