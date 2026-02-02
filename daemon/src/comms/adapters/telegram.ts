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
import fs from 'node:fs';
import path from 'node:path';
import { getTelegramBotToken, getTelegramChatId, getShortcutAuthToken } from '../../core/keychain.js';
import { resolveProjectPath, loadConfig } from '../../core/config.js';
import { sessionExists, startSession, injectText, isBusy } from '../../core/session-bridge.js';
import { registerTelegramHandler, setChannel } from '../channel-router.js';
import { createLogger } from '../../core/logger.js';
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

interface TelegramUpdate {
  message?: TelegramMessage;
}

interface TelegramMessage {
  chat: { id: number };
  from?: { first_name?: string };
  text?: string;
  photo?: Array<{ file_id: string }>;
  document?: { file_id: string; file_name?: string };
  caption?: string;
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

function sendMessage(text: string, chatId?: string): void {
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
let _pendingMessages: Array<{ text: string; chatId: string; firstName: string }> = [];

// State for 3rd-party approval flow
// Maps chatId to queued messages awaiting primary approval
const _approvalQueues: Map<string, Array<{ text: string; firstName: string }>> = new Map();
// Maps a context key to the pending sender's chatId (so we can match primary's reply)
let _pendingApprovalContext: { senderChatId: string; senderName: string; channel: string } | null = null;

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
 */
function checkForApprovalResponse(text: string, chatId: string): boolean {
  if (!_pendingApprovalContext) return false;

  // Only the primary human can approve/deny
  const primaryChatId = getTelegramChatId();
  if (chatId !== primaryChatId) return false;

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

    // Send self-introduction to the new sender
    const agentName = loadConfig().agent.name;
    sendMessage(
      `Hi! I'm ${agentName}, a personal assistant. My human just approved you to chat with me. I can help with general tasks, tech questions, brainstorming, and more. What can I help you with?`,
      ctx.senderChatId,
    );

    // Notify primary
    const expiryNote = expires ? ` (until ${new Date(expires).toLocaleDateString()})` : ' (persistent)';
    sendMessage(`Approved ${ctx.senderName}${expiryNote}. Processing their queued messages now.`);

    // Process queued messages from this sender
    const queued = _approvalQueues.get(ctx.senderChatId) ?? [];
    _approvalQueues.delete(ctx.senderChatId);
    for (const msg of queued) {
      doInject(msg.text, ctx.senderChatId, msg.firstName, true);
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
      sendMessage(`Sorry, I'm not able to help right now.`, ctx.senderChatId);
    } else {
      sendMessage(`Denied ${ctx.senderName}. They can try again later.`);
      sendMessage(`Sorry, I'm not able to help with that right now. You're welcome to try again later.`, ctx.senderChatId);
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

async function processIncomingMessage(text: string, chatId: string, firstName: string): Promise<void> {
  // Classify the sender
  const tier: SenderTier = classifySender(chatId, 'telegram');

  log.debug(`Sender ${firstName} (${chatId}) classified as: ${tier}`);

  // ── Blocked: silently drop ──
  if (tier === 'blocked') {
    log.info(`Dropped message from blocked sender: ${firstName} (${chatId})`);
    return;
  }

  // ── Safe sender: full access (existing behavior) ──
  if (tier === 'safe') {
    // Check if this is an approval response from the primary
    if (checkForApprovalResponse(text, chatId)) {
      return;
    }

    // Normal safe sender flow
    await injectWithSessionWakeup(text, chatId, firstName, false);
    return;
  }

  // ── Approved 3rd party: rate-limit check, then inject with tag ──
  if (tier === 'approved') {
    if (!checkIncomingRate(chatId, 'telegram')) {
      sendMessage("You're sending messages faster than I can process them. Please slow down — I'll catch up shortly.", chatId);
      log.warn(`Rate-limited approved sender: ${firstName} (${chatId})`);
      return;
    }
    await injectWithSessionWakeup(text, chatId, firstName, true);
    return;
  }

  // ── Pending: queue additional messages ──
  if (isPending(chatId, 'telegram')) {
    const queue = _approvalQueues.get(chatId) ?? [];
    queue.push({ text, firstName });
    _approvalQueues.set(chatId, queue);
    log.info(`Queued additional message from pending sender: ${firstName} (${chatId})`);
    return;
  }

  // ── Denied or Unknown: trigger approval flow ──
  const primaryChatId = getTelegramChatId();
  if (!primaryChatId) {
    log.error('Cannot notify primary: no chat ID configured');
    return;
  }

  // Tell the sender we're checking
  sendMessage("I need to check with my human first — I'll get back to you when I hear from them.", chatId);

  // Add to pending
  addPending(chatId, 'telegram', firstName, text);

  // Queue the message
  const queue = _approvalQueues.get(chatId) ?? [];
  queue.push({ text, firstName });
  _approvalQueues.set(chatId, queue);

  // Set context for matching primary's reply
  _pendingApprovalContext = { senderChatId: chatId, senderName: firstName, channel: 'telegram' };

  // Notify primary
  const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
  sendMessage(
    `New message from unknown sender:\n\n` +
    `Name: ${firstName}\n` +
    `Telegram ID: ${chatId}\n` +
    `Message: "${preview}"\n\n` +
    `Reply "approve", "approve for 1 week", "deny", or "block".`,
    primaryChatId,
  );

  log.info(`Approval request sent to primary for sender: ${firstName} (${chatId})`);
}

/**
 * Inject a message into the Claude session, waking it up first if needed.
 */
async function injectWithSessionWakeup(text: string, chatId: string, firstName: string, isThirdParty: boolean): Promise<void> {
  if (!sessionExists()) {
    log.info('No session found, waking up...');
    startTypingLoop(chatId);
    _pendingMessages.push({ text, chatId, firstName });

    if (!_sessionStarting) {
      _sessionStarting = true;
      const started = startSession();
      if (started) {
        await new Promise(resolve => setTimeout(resolve, 12_000));
      }
      _sessionStarting = false;

      for (const msg of _pendingMessages) {
        doInject(msg.text, msg.chatId, msg.firstName, isThirdParty);
      }
      _pendingMessages = [];
    }
    return;
  }

  if (_sessionStarting) {
    _pendingMessages.push({ text, chatId, firstName });
    return;
  }

  startTypingLoop(chatId);
  doInject(text, chatId, firstName, isThirdParty);
}

function doInject(text: string, chatId: string, firstName: string, isThirdParty: boolean): void {
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
  // Register outgoing message handler with channel router
  registerTelegramHandler((text) => {
    sendMessage(text);
  });

  log.info('Telegram adapter initialized');

  return {
    async handleUpdate(update: TelegramUpdate) {
      const msg = update.message;
      if (!msg) return;

      const chatId = msg.chat.id.toString();
      const firstName = msg.from?.first_name ?? 'User';

      // Handle text messages
      if (msg.text) {
        await processIncomingMessage(msg.text, chatId, firstName);
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
          await processIncomingMessage(text, chatId, firstName);
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
          await processIncomingMessage(text, chatId, firstName);
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

      // Echo in Telegram chat
      sendMessage(`User (via Siri): ${trimmed}`, chatId);

      // Set channel and start typing
      setChannel('telegram');
      startTypingLoop(chatId);

      // Inject into session
      if (!sessionExists()) {
        _pendingMessages.push({ text: trimmed, chatId, firstName: 'User' });
        if (!_sessionStarting) {
          _sessionStarting = true;
          startSession();
          await new Promise(resolve => setTimeout(resolve, 12_000));
          _sessionStarting = false;
          for (const msg of _pendingMessages) {
            doInject(msg.text, msg.chatId, msg.firstName, false);
          }
          _pendingMessages = [];
        }
      } else {
        doInject(trimmed, chatId, 'User', false);
      }

      return { status: 200, body: { ok: true, message: `Delivered to ${loadConfig().agent.name}` } };
    },

    stopTyping() {
      stopTypingLoop();
    },
  };
}
