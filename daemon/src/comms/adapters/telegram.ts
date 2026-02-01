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

function getSafeSenders(): string[] {
  try {
    const file = resolveProjectPath(loadConfig().security.safe_senders_file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.telegram?.users ?? [];
  } catch {
    return [];
  }
}

async function processIncomingMessage(text: string, chatId: string, firstName: string): Promise<void> {
  // Check authorization
  const safeSenders = getSafeSenders();
  if (!safeSenders.includes(chatId)) {
    log.warn(`Rejected message from unauthorized sender: ${chatId}`);
    return;
  }

  // Check if session exists
  if (!sessionExists()) {
    log.info('No session found, waking up...');
    startTypingLoop(chatId);
    _pendingMessages.push({ text, chatId, firstName });

    if (!_sessionStarting) {
      _sessionStarting = true;
      const started = startSession();
      if (started) {
        // Wait for Claude to initialize
        await new Promise(resolve => setTimeout(resolve, 12_000));
      }
      _sessionStarting = false;

      // Process queued messages
      for (const msg of _pendingMessages) {
        doInject(msg.text, msg.chatId, msg.firstName);
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
  doInject(text, chatId, firstName);
}

function doInject(text: string, chatId: string, firstName: string): void {
  // Set channel to telegram
  setChannel('telegram');

  const formatted = `[Telegram] ${firstName}: ${text}`;
  const ok = injectText(formatted);
  if (ok) {
    log.info(`Injected message from ${firstName} (${text.substring(0, 50)}...)`);
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
      sendMessage(`Dave (via Siri): ${trimmed}`, chatId);

      // Set channel and start typing
      setChannel('telegram');
      startTypingLoop(chatId);

      // Inject into session
      if (!sessionExists()) {
        _pendingMessages.push({ text: trimmed, chatId, firstName: 'Dave' });
        if (!_sessionStarting) {
          _sessionStarting = true;
          startSession();
          await new Promise(resolve => setTimeout(resolve, 12_000));
          _sessionStarting = false;
          for (const msg of _pendingMessages) {
            doInject(msg.text, msg.chatId, msg.firstName);
          }
          _pendingMessages = [];
        }
      } else {
        doInject(trimmed, chatId, 'Dave');
      }

      return { status: 200, body: { ok: true, message: `Delivered to ${loadConfig().agent.name}` } };
    },

    stopTyping() {
      stopTypingLoop();
    },
  };
}
