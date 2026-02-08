/**
 * Telegram adapter — webhook receiver, message sender, media download, typing indicators.
 *
 * Replaces: gateway.js + telegram-send.sh + parts of transcript-watcher.sh
 *
 * Responsibilities:
 * - Receive incoming webhook messages and inject them into Claude's tmux session
 * - Send outgoing messages to Telegram
 * - Download photos and documents to local media directory
 * - Manage typing indicator loop
 * - Handle Siri Shortcut endpoint
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { getTelegramBotToken, getTelegramChatId, getShortcutAuthToken } from '../../core/keychain.js';
import { resolveProjectPath, loadConfig } from '../../core/config.js';
import { sessionExists, startSession, injectText, isBusy } from '../../core/session-bridge.js';
import { registerTelegramHandler, setChannel } from '../channel-router.js';
import { createLogger } from '../../core/logger.js';
import { getSidecarPort, isSidecarReady } from '../../browser/browser-sidecar.js';
import {
  classifySender,
  addApproved,
  addDenied,
  addPending,
  isPending,
  getDenialCount,
  addBlocked,
  checkIncomingRate,
  type SenderTier,
} from '../../core/access-control.js';

const log = createLogger('telegram');

const MEDIA_DIR_REL = '.claude/state/telegram-media';
const REPLY_CHAT_ID_REL = '.claude/state/reply-chat-id.txt';

// ── Browser hand-off state ─────────────────────────────────

interface HandoffState {
  active: boolean;
  /** Chat ID to send screenshots/status to during hand-off */
  replyChatId: string | null;
  /** Timestamp when hand-off started */
  startedAt: string | null;
}

const _handoff: HandoffState = {
  active: false,
  replyChatId: null,
  startedAt: null,
};

/**
 * Activate browser hand-off mode. Called from daemon endpoint.
 * When active, safe sender messages matching hand-off patterns
 * are intercepted and routed to the browser sidecar.
 *
 * Awaits sidecar notification — if sidecar is unreachable, hand-off still activates
 * but idle timers won't run (degraded timeout protection).
 */
export async function activateHandoff(replyChatId?: string): Promise<boolean> {
  if (!isSidecarReady()) {
    log.warn('Cannot activate hand-off: sidecar not ready');
    return false;
  }
  _handoff.active = true;
  _handoff.replyChatId = replyChatId ?? _replyChatId;
  _handoff.startedAt = new Date().toISOString();
  log.info('Browser hand-off activated', { replyChatId: _handoff.replyChatId });

  // Notify sidecar — this starts idle timers on the sidecar side
  try {
    await sidecarRequest('POST', '/handoff/set', { active: true });
  } catch (err) {
    log.warn('Failed to notify sidecar of hand-off activation — idle timeout protection is degraded', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Notify Dave that timeout protection is degraded
    sendMessage('Warning: Could not confirm hand-off with browser sidecar. Idle timeout protection may not work.');
  }

  return true;
}

/**
 * Deactivate browser hand-off mode.
 * Awaits sidecar notification to stop idle timers. Best-effort if sidecar is unreachable.
 */
export async function deactivateHandoff(): Promise<void> {
  const wasActive = _handoff.active;
  _handoff.active = false;
  _handoff.replyChatId = null;
  _handoff.startedAt = null;
  log.info('Browser hand-off deactivated');

  // Notify sidecar to stop idle timers
  if (wasActive) {
    try {
      await sidecarRequest('POST', '/handoff/set', { active: false });
    } catch (err) {
      log.warn('Failed to notify sidecar of hand-off deactivation (may already be dead)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function isHandoffActive(): boolean {
  return _handoff.active;
}

// ── Sidecar HTTP helpers ───────────────────────────────────

function sidecarRequest(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const port = getSidecarPort();
    const payload = body ? JSON.stringify(body) : undefined;

    const req = http.request({
      hostname: 'localhost',
      port,
      path,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : undefined,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] ?? '';
        if (contentType.includes('image/png')) {
          resolve({ status: res.statusCode ?? 200, data: raw });
        } else {
          try {
            resolve({ status: res.statusCode ?? 200, data: JSON.parse(raw.toString()) });
          } catch {
            resolve({ status: res.statusCode ?? 200, data: raw.toString() });
          }
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('Sidecar request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function sidecarScreenshot(): Promise<Buffer | null> {
  return sidecarRequest('GET', '/session/screenshot').then(({ status, data }) => {
    if (status === 200 && Buffer.isBuffer(data)) return data;
    return null;
  }).catch(() => null);
}

// ── Telegram sendPhoto ─────────────────────────────────────

function sendPhoto(imageBuffer: Buffer, chatId?: string, caption?: string): void {
  const token = getTelegramBotToken();
  const targetChatId = chatId ?? getTelegramChatId();
  if (!token || !targetChatId) {
    log.error('Cannot sendPhoto: missing bot token or chat ID');
    return;
  }

  const boundary = '----BMOBoundary' + Date.now();
  const parts: Buffer[] = [];

  // chat_id field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${targetChatId}\r\n`
  ));

  // caption field (optional)
  if (caption) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`
    ));
  }

  // photo field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screenshot.png"\r\nContent-Type: image/png\r\n\r\n`
  ));
  parts.push(imageBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendPhoto`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  }, (res) => {
    let responseBody = '';
    res.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
    res.on('end', () => {
      try {
        const result = JSON.parse(responseBody);
        if (result.ok) {
          log.debug('Screenshot sent to Telegram');
        } else {
          log.error('Telegram sendPhoto failed', { response: responseBody });
        }
      } catch {
        log.error('Telegram sendPhoto: unparseable response');
      }
    });
  });

  req.on('error', (err) => {
    log.error('Telegram sendPhoto error', { error: err.message });
  });

  req.write(body);
  req.end();
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  message_reaction?: MessageReactionUpdated;
}

interface TelegramMessage {
  chat: { id: number; type?: 'private' | 'group' | 'supergroup' | 'channel' };
  from?: { id?: number; first_name?: string; is_bot?: boolean };
  text?: string;
  photo?: Array<{ file_id: string }>;
  document?: { file_id: string; file_name?: string };
  caption?: string;
}

interface ReactionType {
  type: 'emoji' | 'custom_emoji' | 'paid';
  emoji?: string;
  custom_emoji_id?: string;
}

interface MessageReactionUpdated {
  chat: { id: number; type?: string };
  message_id: number;
  date: number;
  user?: { id?: number; first_name?: string; is_bot?: boolean };
  actor_chat?: { id: number };
  old_reaction: ReactionType[];
  new_reaction: ReactionType[];
}

// ── Group chat context ──────────────────────────────────────

/**
 * Track the most recent reply chat ID so outgoing transcript messages
 * go to the right place (group or DM). Falls back to Keychain default
 * (primary's DM) on cold start when no incoming message has been received yet.
 *
 * Persisted to disk so it survives daemon restarts. Restored in
 * createTelegramRouter() (after config is loaded and project dir is set).
 */
let _replyChatId: string | null = null;

function loadReplyChatId(): string | null {
  try {
    const filePath = resolveProjectPath(REPLY_CHAT_ID_REL);
    const value = fs.readFileSync(filePath, 'utf-8').trim();
    return value || null;
  } catch {
    // File doesn't exist yet — cold start
    return null;
  }
}

function persistReplyChatId(chatId: string): void {
  try {
    const filePath = resolveProjectPath(REPLY_CHAT_ID_REL);
    fs.writeFileSync(filePath, chatId + '\n', 'utf-8');
  } catch (err) {
    log.error('Failed to persist reply chat ID', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Webhook deduplication ────────────────────────────────────

const DEDUP_MAX_SIZE = 1000;
const _recentUpdateIds = new Set<number>();

function isDuplicateUpdate(updateId: number): boolean {
  if (_recentUpdateIds.has(updateId)) return true;

  _recentUpdateIds.add(updateId);

  // Evict oldest entry when the set gets too large.
  // Set iteration order is insertion order, so first value is oldest.
  if (_recentUpdateIds.size > DEDUP_MAX_SIZE) {
    const oldest = _recentUpdateIds.values().next().value!;
    _recentUpdateIds.delete(oldest);
  }

  return false;
}

interface MessageContext {
  /** User ID for access control (from.id in groups, chat.id in DMs) */
  senderId: string;
  /** Chat ID for sending replies (always chat.id — the group or DM) */
  replyChatId: string;
  /** Whether this message is from our own bot (self-loop prevention) */
  isSelf: boolean;
  /** Display name */
  firstName: string;
}

/**
 * Get our own bot's user ID from the token (format: {bot_id}:{secret}).
 * Used to skip our own messages in groups and prevent self-loops.
 */
function getOwnBotId(): string | null {
  const token = getTelegramBotToken();
  if (!token) return null;
  const parts = token.split(':');
  return parts[0] ?? null;
}

function extractMessageContext(msg: TelegramMessage): MessageContext {
  const chatType = msg.chat.type ?? 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  const replyChatId = msg.chat.id.toString();

  // In groups, use from.id for identity; in DMs, chat.id is the user's ID
  const senderId = isGroup && msg.from?.id
    ? msg.from.id.toString()
    : replyChatId;

  // Only skip our own messages (not other bots — they may be peers like R2)
  const ownBotId = getOwnBotId();
  const isSelf = msg.from?.is_bot === true && msg.from?.id?.toString() === ownBotId;

  return {
    senderId,
    replyChatId,
    isSelf,
    firstName: msg.from?.first_name ?? 'User',
  };
}

// ── Typing indicator management ─────────────────────────────

let _typingInterval: ReturnType<typeof setInterval> | null = null;
let _typingCooldown = false;

function sendTypingIndicator(chatId: string): void {
  if (_typingCooldown) return;

  const token = getTelegramBotToken();
  if (!token) return;

  const data = JSON.stringify({ chat_id: chatId, action: 'typing' });

  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendChatAction`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  });

  req.on('error', () => {}); // Ignore typing errors
  req.write(data);
  req.end();
}

function startTypingLoop(chatId: string): void {
  stopTypingLoop();
  _typingCooldown = false;
  sendTypingIndicator(chatId);
  _typingInterval = setInterval(() => sendTypingIndicator(chatId), 4000);
  // Safety timeout: 3 minutes max
  setTimeout(() => stopTypingLoop(), 180_000);
}

function stopTypingLoop(): void {
  if (_typingInterval) {
    clearInterval(_typingInterval);
    _typingInterval = null;
    _typingCooldown = true;
    setTimeout(() => { _typingCooldown = false; }, 2000);
    log.debug('Typing loop stopped');
  }
}

// ── File download ───────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function downloadTelegramFile(fileId: string, filename: string): Promise<string | null> {
  const token = getTelegramBotToken();
  if (!token) return null;

  try {
    const rawFileInfo = await httpsGet(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const fileInfo = JSON.parse(rawFileInfo);
    if (!fileInfo.ok || !fileInfo.result?.file_path) return null;

    const mediaDir = resolveProjectPath(MEDIA_DIR_REL);
    fs.mkdirSync(mediaDir, { recursive: true });
    const localPath = path.join(mediaDir, filename);

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      https.get(`https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`, (res) => {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (e) => { fs.unlink(localPath, () => {}); reject(e); });
    });

    log.info(`Downloaded media: ${filename}`);
    return localPath;
  } catch (err) {
    log.error(`Failed to download file: ${fileId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Send message ────────────────────────────────────────────

export function sendMessage(text: string, chatId?: string): void {
  const token = getTelegramBotToken();
  const targetChatId = chatId ?? getTelegramChatId();
  if (!token || !targetChatId) {
    log.error('Cannot send: missing bot token or chat ID');
    return;
  }

  // Truncate if too long (Telegram limit is 4096)
  const truncated = text.length > 4000 ? text.substring(0, 4000) + '...' : text;

  const data = JSON.stringify({ chat_id: targetChatId, text: truncated });

  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  }, (res) => {
    let body = '';
    res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    res.on('end', () => {
      try {
        const result = JSON.parse(body);
        if (result.ok) {
          log.debug(`Sent to Telegram (${truncated.length} chars) msg_id=${result.result?.message_id}`);
        } else {
          log.error(`Telegram send failed`, { response: body });
        }
      } catch {
        log.error('Telegram send: unparseable response');
      }

      // Stop typing indicator after message is sent
      stopTypingLoop();
    });
  });

  req.on('error', (err) => {
    log.error('Telegram send error', { error: err.message });
  });

  req.write(data);
  req.end();
}

// ── Incoming message handling ───────────────────────────────

// State for session wake-up
let _sessionStarting = false;
let _pendingMessages: Array<{ text: string; senderId: string; replyChatId: string; firstName: string }> = [];

// State for 3rd-party approval flow
// Maps senderId to queued messages awaiting primary approval
const _approvalQueues: Map<string, Array<{ text: string; firstName: string }>> = new Map();
// Maps a context key to the pending sender info (so we can match primary's reply)
let _pendingApprovalContext: {
  senderChatId: string;
  senderReplyChatId: string;
  senderName: string;
  channel: string;
} | null = null;

const AUTO_BLOCK_THRESHOLD = 3;

/**
 * Parse a duration string from the primary's approval message.
 * Supports: "for 1 week", "for 2 days", "for 1 month", "until Friday", etc.
 * Returns an ISO date string or null for persistent approval.
 */
function parseApprovalDuration(text: string): string | null {
  const lower = text.toLowerCase();

  // "approve for X days/weeks/months"
  const durationMatch = lower.match(/for\s+(\d+)\s+(day|week|month|hour)s?/);
  if (durationMatch) {
    const amount = parseInt(durationMatch[1]!, 10);
    const unit = durationMatch[2]!;
    const now = new Date();
    switch (unit) {
      case 'hour': now.setHours(now.getHours() + amount); break;
      case 'day': now.setDate(now.getDate() + amount); break;
      case 'week': now.setDate(now.getDate() + amount * 7); break;
      case 'month': now.setMonth(now.getMonth() + amount); break;
    }
    return now.toISOString();
  }

  return null; // Persistent (no expiry)
}

/**
 * Check if a message from the primary is an approval/denial response.
 * Uses senderId for identity matching (works in both DMs and groups).
 */
function checkForApprovalResponse(text: string, senderId: string): boolean {
  if (!_pendingApprovalContext) return false;

  // Only the primary human can approve/deny
  const primaryChatId = getTelegramChatId();
  if (senderId !== primaryChatId) return false;

  const lower = text.toLowerCase().trim();

  if (lower.startsWith('approve')) {
    const ctx = _pendingApprovalContext;
    _pendingApprovalContext = null;

    const expires = parseApprovalDuration(text);

    addApproved({
      id: ctx.senderChatId,
      channel: ctx.channel,
      name: ctx.senderName,
      type: 'human', // Default; can be refined later
      approved_by: 'primary',
      expires,
      notes: expires ? `Approved with expiry` : 'Approved persistently',
    });

    // Send self-introduction to the new sender (reply to the chat they messaged from)
    const agentName = loadConfig().agent.name;
    sendMessage(
      `Hi! I'm ${agentName}, a personal assistant. My human just approved you to chat with me. I can help with general tasks, tech questions, brainstorming, and more. What can I help you with?`,
      ctx.senderReplyChatId,
    );

    // Notify primary
    const expiryNote = expires ? ` (until ${new Date(expires).toLocaleDateString()})` : ' (persistent)';
    sendMessage(`Approved ${ctx.senderName}${expiryNote}. Processing their queued messages now.`);

    // Process queued messages from this sender
    const queued = _approvalQueues.get(ctx.senderChatId) ?? [];
    _approvalQueues.delete(ctx.senderChatId);
    for (const msg of queued) {
      doInject(msg.text, ctx.senderChatId, ctx.senderReplyChatId, msg.firstName, true);
    }

    log.info(`Primary approved sender: ${ctx.senderName} (${ctx.senderChatId})`);
    return true;
  }

  if (lower.startsWith('deny') || lower.startsWith('reject') || lower === 'no') {
    const ctx = _pendingApprovalContext;
    _pendingApprovalContext = null;

    addDenied(ctx.senderChatId, ctx.channel, ctx.senderName, 'Denied by primary');

    // Check if auto-block threshold reached
    const denialCount = getDenialCount(ctx.senderChatId, ctx.channel);
    if (denialCount >= AUTO_BLOCK_THRESHOLD) {
      addBlocked(ctx.senderChatId, ctx.channel, ctx.senderName, 'agent', `Auto-blocked after ${denialCount} denials`);
      sendMessage(`${ctx.senderName} has been denied ${denialCount} times — auto-blocked.`);
      sendMessage(`Sorry, I'm not able to help right now.`, ctx.senderReplyChatId);
    } else {
      sendMessage(`Denied ${ctx.senderName}. They can try again later.`);
      sendMessage(`Sorry, I'm not able to help with that right now. You're welcome to try again later.`, ctx.senderReplyChatId);
    }

    _approvalQueues.delete(ctx.senderChatId);
    log.info(`Primary denied sender: ${ctx.senderName} (${ctx.senderChatId})`);
    return true;
  }

  if (lower.startsWith('block')) {
    const ctx = _pendingApprovalContext;
    _pendingApprovalContext = null;

    addBlocked(ctx.senderChatId, ctx.channel, ctx.senderName, 'primary', 'Blocked by primary');
    sendMessage(`Blocked ${ctx.senderName}. They won't be able to contact me again.`);
    _approvalQueues.delete(ctx.senderChatId);
    log.info(`Primary blocked sender: ${ctx.senderName} (${ctx.senderChatId})`);
    return true;
  }

  return false;
}

/**
 * Handle a message_reaction update. Compares old/new reaction lists to
 * determine which emoji were added or removed, then injects a short
 * notification into the Claude session so the agent can see acknowledgments.
 */
function handleReaction(reaction: MessageReactionUpdated): void {
  const userId = reaction.user?.id?.toString();
  const firstName = reaction.user?.first_name ?? 'Someone';

  // Only process reactions from known senders (safe or approved)
  if (userId) {
    const tier = classifySender(userId, 'telegram');
    if (tier === 'blocked') return;
  }

  const oldEmojis = new Set(reaction.old_reaction.filter(r => r.emoji).map(r => r.emoji!));
  const newEmojis = new Set(reaction.new_reaction.filter(r => r.emoji).map(r => r.emoji!));

  const added = [...newEmojis].filter(e => !oldEmojis.has(e));
  const removed = [...oldEmojis].filter(e => !newEmojis.has(e));

  if (added.length === 0 && removed.length === 0) return;

  const parts: string[] = [];
  if (added.length > 0) parts.push(`reacted ${added.join(' ')}`);
  if (removed.length > 0) parts.push(`removed ${removed.join(' ')}`);

  const chatId = reaction.chat.id.toString();
  const text = `[Telegram] ${firstName} ${parts.join(', ')} on a message`;

  // Update reply target
  _replyChatId = chatId;
  persistReplyChatId(chatId);

  // Only inject if the session is running (don't wake up just for a reaction)
  if (sessionExists()) {
    setChannel('telegram');
    injectText(text);
    log.info(`Reaction from ${firstName}: ${parts.join(', ')}`);
  } else {
    log.debug(`Reaction from ${firstName} skipped (no session)`);
  }
}

/**
 * Handle a browser hand-off command from a safe sender.
 * Returns true if the message was a hand-off command (consumed), false otherwise.
 */
async function handleHandoffCommand(text: string, replyChatId: string): Promise<boolean> {
  const lower = text.toLowerCase().trim();

  // type: [text] — relay text to browser (takes priority over other matches)
  if (lower.startsWith('type:')) {
    const relayText = text.slice(5).trimStart(); // Preserve original case after "type:"
    if (!relayText) {
      // "type:" with nothing after — ignore
      return true;
    }

    try {
      // Security: DO NOT log relayText — it may contain passwords
      log.info('Hand-off: relaying typed text to sidecar');
      await sidecarRequest('POST', '/session/type', { text: relayText });
      sendMessage('Typed.', replyChatId);
    } catch (err) {
      log.error('Hand-off type relay failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      sendMessage('Failed to type text into browser.', replyChatId);
    }
    return true;
  }

  // screenshot — capture and send back via Telegram
  if (lower === 'screenshot') {
    try {
      const screenshot = await sidecarScreenshot();
      if (screenshot) {
        sendPhoto(screenshot, replyChatId, 'Browser screenshot');
      } else {
        sendMessage('Could not capture screenshot.', replyChatId);
      }
    } catch (err) {
      log.error('Hand-off screenshot failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      sendMessage('Screenshot failed.', replyChatId);
    }
    return true;
  }

  // done / all yours / go ahead — hand-off completion
  if (lower === 'done' || lower === 'all yours' || lower === 'go ahead') {
    await deactivateHandoff();

    // Take a fresh screenshot for Claude's context (non-fatal if it fails)
    try {
      const screenshot = await sidecarScreenshot();
      if (screenshot && screenshot.length <= 2 * 1024 * 1024) {
        const screenshotDir = resolveProjectPath(MEDIA_DIR_REL);
        fs.mkdirSync(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, `handoff_done_${Date.now()}.png`);
        fs.writeFileSync(screenshotPath, screenshot);
        injectText(`[Browser] Dave completed hand-off. Screenshot saved: ${screenshotPath}`);
      } else {
        if (screenshot) {
          log.warn('Hand-off done screenshot too large, skipping save', { bytes: screenshot.length });
        }
        injectText(`[Browser] Dave completed hand-off.`);
      }
    } catch (err) {
      log.error('Hand-off done screenshot failed', { error: err instanceof Error ? err.message : String(err) });
      injectText(`[Browser] Dave completed hand-off.`);
    }

    sendMessage('Hand-off complete. BMO is back in control.', replyChatId);
    log.info('Hand-off completed by user');
    return true;
  }

  // abort / cancel — close session and abort (always works, even if sidecar is dead)
  if (lower === 'abort' || lower === 'cancel') {
    // Deactivate daemon-side hand-off state first (always succeeds)
    await deactivateHandoff();

    // Best-effort sidecar stop — don't fail if sidecar is dead
    try {
      await sidecarRequest('POST', '/session/stop', { saveContext: true });
    } catch (err) {
      log.warn('Hand-off abort: sidecar stop failed (may already be dead)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    injectText(`[Browser] Dave aborted hand-off. Session closed.`);
    sendMessage('Hand-off aborted. Session closed.', replyChatId);
    log.info('Hand-off aborted by user');
    return true;
  }

  // Not a hand-off command
  return false;
}

async function processIncomingMessage(text: string, senderId: string, replyChatId: string, firstName: string): Promise<void> {
  // Classify the sender by their user ID (works for both DMs and groups)
  const tier: SenderTier = classifySender(senderId, 'telegram');

  log.debug(`Sender ${firstName} (${senderId}) classified as: ${tier} [replyChatId=${replyChatId}]`);

  // ── Blocked: silently drop ──
  if (tier === 'blocked') {
    log.info(`Dropped message from blocked sender: ${firstName} (${senderId})`);
    return;
  }

  // ── Safe sender: full access (existing behavior) ──
  if (tier === 'safe') {
    // Check if this is an approval response from the primary
    if (checkForApprovalResponse(text, senderId)) {
      return;
    }

    // Check if browser hand-off is active
    if (_handoff.active) {
      // /ask escape hatch — passes through to Claude even during hand-off
      if (text.startsWith('/ask ')) {
        const question = text.slice(5).trim();
        if (question) {
          await injectWithSessionWakeup(question, senderId, replyChatId, firstName, false);
          return;
        }
      }

      const handled = await handleHandoffCommand(text, replyChatId);
      if (handled) return;

      // Not a recognized command — treat as text to type into the focused field
      try {
        log.info('Hand-off: relaying message as typed text');
        await sidecarRequest('POST', '/session/type', { text });
        sendMessage('Typed.', replyChatId);
      } catch (err) {
        log.error('Hand-off type relay failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        sendMessage('Failed to type. Commands: done, abort, screenshot, /ask [question]', replyChatId);
      }
      return;
    }

    // Normal safe sender flow
    await injectWithSessionWakeup(text, senderId, replyChatId, firstName, false);
    return;
  }

  // ── Approved 3rd party: rate-limit check, then inject with tag ──
  if (tier === 'approved') {
    if (!checkIncomingRate(senderId, 'telegram')) {
      sendMessage("You're sending messages faster than I can process them. Please slow down — I'll catch up shortly.", replyChatId);
      log.warn(`Rate-limited approved sender: ${firstName} (${senderId})`);
      return;
    }
    await injectWithSessionWakeup(text, senderId, replyChatId, firstName, true);
    return;
  }

  // ── Pending: queue additional messages ──
  if (isPending(senderId, 'telegram')) {
    const queue = _approvalQueues.get(senderId) ?? [];
    queue.push({ text, firstName });
    _approvalQueues.set(senderId, queue);
    log.info(`Queued additional message from pending sender: ${firstName} (${senderId})`);
    return;
  }

  // ── Denied or Unknown: trigger approval flow ──
  const primaryChatId = getTelegramChatId();
  if (!primaryChatId) {
    log.error('Cannot notify primary: no chat ID configured');
    return;
  }

  // Tell the sender we're checking (reply in the chat they messaged from)
  sendMessage("I need to check with my human first — I'll get back to you when I hear from them.", replyChatId);

  // Add to pending (using senderId for identity)
  addPending(senderId, 'telegram', firstName, text);

  // Queue the message
  const queue = _approvalQueues.get(senderId) ?? [];
  queue.push({ text, firstName });
  _approvalQueues.set(senderId, queue);

  // Set context for matching primary's reply (store both IDs)
  _pendingApprovalContext = {
    senderChatId: senderId,
    senderReplyChatId: replyChatId,
    senderName: firstName,
    channel: 'telegram',
  };

  // Notify primary
  const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
  sendMessage(
    `New message from unknown sender:\n\n` +
    `Name: ${firstName}\n` +
    `Telegram ID: ${senderId}\n` +
    `Message: "${preview}"\n\n` +
    `Reply "approve", "approve for 1 week", "deny", or "block".`,
    primaryChatId,
  );

  log.info(`Approval request sent to primary for sender: ${firstName} (${senderId})`);
}

/**
 * Inject a message into the Claude session, waking it up first if needed.
 * @param senderId - User ID for identity (used in pending message storage)
 * @param replyChatId - Chat ID for replies (typing indicator, response routing)
 */
async function injectWithSessionWakeup(text: string, senderId: string, replyChatId: string, firstName: string, isThirdParty: boolean): Promise<void> {
  if (!sessionExists()) {
    log.info('No session found, waking up...');
    startTypingLoop(replyChatId);
    _pendingMessages.push({ text, senderId, replyChatId, firstName });

    if (!_sessionStarting) {
      _sessionStarting = true;
      const started = startSession();
      if (started) {
        await new Promise(resolve => setTimeout(resolve, 12_000));
      }
      _sessionStarting = false;

      for (const msg of _pendingMessages) {
        doInject(msg.text, msg.senderId, msg.replyChatId, msg.firstName, isThirdParty);
      }
      _pendingMessages = [];
    }
    return;
  }

  if (_sessionStarting) {
    _pendingMessages.push({ text, senderId, replyChatId, firstName });
    return;
  }

  startTypingLoop(replyChatId);
  doInject(text, senderId, replyChatId, firstName, isThirdParty);
}

function doInject(text: string, _senderId: string, _targetChatId: string, firstName: string, isThirdParty: boolean): void {
  setChannel('telegram');

  const prefix = isThirdParty ? '[3rdParty][Telegram]' : '[Telegram]';
  const formatted = `${prefix} ${firstName}: ${text}`;
  const ok = injectText(formatted);
  if (ok) {
    log.info(`Injected ${isThirdParty ? '3rd-party ' : ''}message from ${firstName} (${text.substring(0, 50)}...)`);
  }
}

// ── Public API ──────────────────────────────────────────────

export interface TelegramRouter {
  handleUpdate: (update: TelegramUpdate) => Promise<void>;
  handleShortcut: (data: { text?: string; token?: string }) => Promise<{ status: number; body: Record<string, unknown> }>;
  stopTyping: () => void;
}

export function createTelegramRouter(): TelegramRouter {
  // Restore persisted reply chat ID from previous daemon run
  _replyChatId = loadReplyChatId();
  if (_replyChatId) {
    log.info(`Restored reply chat ID: ${_replyChatId}`);
  }

  // Register outgoing message handler with channel router.
  // Uses _replyChatId so transcript responses go to the most recent incoming chat
  // (group or DM). Falls back to Keychain default (primary's DM) on cold start.
  registerTelegramHandler(
    (text) => { sendMessage(text, _replyChatId ?? undefined); },
    () => { startTypingLoop(_replyChatId ?? getTelegramChatId() ?? ''); },
    () => { stopTypingLoop(); },
  );

  log.info('Telegram adapter initialized');

  return {
    async handleUpdate(update: TelegramUpdate) {
      // Deduplicate webhook retries using Telegram's update_id
      if (update.update_id != null && isDuplicateUpdate(update.update_id)) {
        log.debug(`Duplicate update_id ${update.update_id}, skipping`);
        return;
      }

      // Handle reactions (separate path — no message body)
      if (update.message_reaction) {
        handleReaction(update.message_reaction);
        return;
      }

      const msg = update.message;
      if (!msg) return;

      const ctx = extractMessageContext(msg);

      // Skip our own messages to prevent self-loops (but process other bots like R2)
      if (ctx.isSelf) {
        log.debug(`Skipping own bot message in chat ${ctx.replyChatId}`);
        return;
      }

      // Track reply target so outgoing messages go to the right chat
      _replyChatId = ctx.replyChatId;
      persistReplyChatId(ctx.replyChatId);

      const { senderId, replyChatId, firstName } = ctx;

      // Handle text messages
      if (msg.text) {
        await processIncomingMessage(msg.text, senderId, replyChatId, firstName);
        return;
      }

      // Handle photos
      if (msg.photo && msg.photo.length > 0) {
        const photo = msg.photo[msg.photo.length - 1]!;
        const filename = `photo_${Date.now()}.jpg`;
        const localPath = await downloadTelegramFile(photo.file_id, filename);
        if (localPath) {
          const caption = msg.caption ?? '';
          const text = caption ? `[Sent a photo: ${localPath}] ${caption}` : `[Sent a photo: ${localPath}]`;
          await processIncomingMessage(text, senderId, replyChatId, firstName);
        }
        return;
      }

      // Handle documents
      if (msg.document) {
        const filename = msg.document.file_name ?? `document_${Date.now()}`;
        const localPath = await downloadTelegramFile(msg.document.file_id, filename);
        if (localPath) {
          const caption = msg.caption ?? '';
          const text = caption ? `[Sent a document: ${localPath}] ${caption}` : `[Sent a document: ${localPath}]`;
          await processIncomingMessage(text, senderId, replyChatId, firstName);
        }
        return;
      }
    },

    async handleShortcut(data) {
      const { text, token } = data;

      // Validate auth token
      const expectedToken = getShortcutAuthToken();
      if (!expectedToken) {
        return { status: 500, body: { error: 'Auth not configured' } };
      }
      if (!token || token !== expectedToken) {
        return { status: 401, body: { error: 'Unauthorized' } };
      }
      if (!text || !text.trim()) {
        return { status: 400, body: { error: 'No message provided' } };
      }

      const chatId = getTelegramChatId() ?? '';
      const trimmed = text.trim();

      // Echo in Telegram chat (Siri doesn't identify the caller — label generically)
      sendMessage(`User (via Siri): ${trimmed}`, chatId);

      // Set channel and start typing
      setChannel('telegram');
      startTypingLoop(chatId);

      // Siri Shortcut always targets primary's DM (senderId = replyChatId = chatId)
      if (!sessionExists()) {
        _pendingMessages.push({ text: trimmed, senderId: chatId, replyChatId: chatId, firstName: 'User' });
        if (!_sessionStarting) {
          _sessionStarting = true;
          startSession();
          await new Promise(resolve => setTimeout(resolve, 12_000));
          _sessionStarting = false;
          for (const msg of _pendingMessages) {
            doInject(msg.text, msg.senderId, msg.replyChatId, msg.firstName, false);
          }
          _pendingMessages = [];
        }
      } else {
        doInject(trimmed, chatId, chatId, 'User', false);
      }

      return { status: 200, body: { ok: true, message: `Delivered to ${loadConfig().agent.name}` } };
    },

    stopTyping() {
      stopTypingLoop();
    },
  };
}
