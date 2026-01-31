#!/usr/bin/env node
/**
 * BMO Telegram Gateway v6 (media support)
 * Receives webhooks and injects messages into the real Claude Code session via tmux.
 * Supports text, photos, and documents.
 * If no session exists, starts one automatically!
 * The Stop hook handles sending responses back to Telegram.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const TELEGRAM_SEND = '/Users/bmo/CC4Me-BMO/scripts/telegram-send.sh';
const MEDIA_DIR = '/Users/bmo/CC4Me-BMO/.claude/state/telegram-media';

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// Get bot token from Keychain
function getBotToken() {
  try {
    return execSync('security find-generic-password -s "credential-telegram-bot" -w', { encoding: 'utf8' }).trim();
  } catch (e) {
    console.error('Failed to get bot token from Keychain');
    return null;
  }
}

// Download file from Telegram
async function downloadTelegramFile(fileId, filename) {
  const token = getBotToken();
  if (!token) return null;

  try {
    // Get file path from Telegram
    const fileInfo = await new Promise((resolve, reject) => {
      https.get(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      console.error('Failed to get file info:', fileInfo);
      return null;
    }

    const filePath = fileInfo.result.file_path;
    const localPath = path.join(MEDIA_DIR, filename);

    // Download the file
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      https.get(`https://api.telegram.org/file/bot${token}/${filePath}`, (res) => {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (e) => {
        fs.unlink(localPath, () => {});
        reject(e);
      });
    });

    console.log(`📥 Downloaded: ${filename}`);
    return localPath;
  } catch (e) {
    console.error(`Failed to download file: ${e.message}`);
    return null;
  }
}

// Configuration
const PORT = 3847;
const BASE_DIR = '/Users/bmo/CC4Me-BMO';
const STATE_DIR = path.join(BASE_DIR, '.claude/state');
const SAFE_SENDERS_FILE = path.join(STATE_DIR, 'safe-senders.json');
const CHANNEL_FILE = path.join(STATE_DIR, 'channel.txt');
const START_SCRIPT = path.join(BASE_DIR, 'scripts/start-tmux.sh');
const TMUX = '/opt/homebrew/bin/tmux';
const SESSION_NAME = 'bmo';

// Track if we're currently starting a session
let sessionStarting = false;
let pendingMessages = [];
let typingInterval = null;
let typingCooldown = false;

// Send typing indicator (single shot)
function sendTypingIndicator(chatId) {
  if (typingCooldown) return; // Suppress during cooldown after stop
  try {
    execSync(`TELEGRAM_CHAT_ID=${chatId} "${TELEGRAM_SEND}" typing`, { stdio: 'ignore' });
    console.log('⌨️  Sent typing indicator');
  } catch (e) {
    console.error('⚠️  Failed to send typing indicator');
  }
}

// Start repeating typing indicator every 4 seconds until response is sent
function startTypingLoop(chatId) {
  stopTypingLoop(); // Clear any existing loop
  typingCooldown = false;
  sendTypingIndicator(chatId); // Send immediately
  typingInterval = setInterval(() => {
    sendTypingIndicator(chatId);
  }, 4000);
  // Safety timeout: stop after 3 minutes no matter what
  setTimeout(() => stopTypingLoop(), 180000);
}

// Stop the typing indicator loop
function stopTypingLoop() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
    // Brief cooldown to prevent straggling interval ticks
    typingCooldown = true;
    setTimeout(() => { typingCooldown = false; }, 2000);
    console.log('⌨️  Typing loop stopped');
  }
}

// Load safe senders
function getSafeSenders() {
  try {
    return JSON.parse(fs.readFileSync(SAFE_SENDERS_FILE, 'utf8')).telegram?.users || [];
  } catch (e) {
    return [];
  }
}

// Check if tmux session exists
function sessionExists() {
  try {
    execSync(`${TMUX} has-session -t ${SESSION_NAME} 2>/dev/null`);
    return true;
  } catch (e) {
    return false;
  }
}

// Start a new Claude session
async function startSession() {
  if (sessionStarting) {
    console.log('⏳ Session already starting, queuing message...');
    return false;
  }

  sessionStarting = true;
  console.log('🚀 Starting Claude session...');

  try {
    // Run start-tmux.sh --detach (this handles the full startup including auto-prompt)
    execSync(`"${START_SCRIPT}" --detach`, {
      cwd: BASE_DIR,
      stdio: 'inherit'
    });

    // Wait additional time for Claude to fully initialize
    console.log('⏳ Waiting for Claude to initialize...');
    await new Promise(resolve => setTimeout(resolve, 12000));

    sessionStarting = false;
    console.log('✅ Session started!');

    // Process any queued messages
    if (pendingMessages.length > 0) {
      console.log(`📬 Processing ${pendingMessages.length} queued message(s)...`);
      for (const msg of pendingMessages) {
        injectMessage(msg.text, msg.chatId, msg.firstName);
      }
      pendingMessages = [];
    }

    return true;
  } catch (e) {
    sessionStarting = false;
    console.error(`❌ Failed to start session: ${e.message}`);
    return false;
  }
}

// Inject message into tmux session
function injectMessage(text, chatId, firstName) {
  // Set channel to telegram so the watcher sends responses there
  fs.writeFileSync(CHANNEL_FILE, 'telegram\n');

  // Format and inject the message
  // Escape special characters for tmux
  const sanitized = text.replace(/'/g, "'\\''");
  const formatted = `[Telegram] ${firstName}: ${sanitized}`;

  try {
    // Send the text first, then Enter separately for reliability
    execSync(`${TMUX} send-keys -t ${SESSION_NAME} -l '${formatted}'`);
    execSync(`${TMUX} send-keys -t ${SESSION_NAME} Enter`);
    console.log(`📨 Injected: "${text.substring(0, 50)}..."`);
    return true;
  } catch (e) {
    console.error(`❌ Failed to inject: ${e.message}`);
    return false;
  }
}

// Process incoming message
async function processMessage(msg) {
  const chatId = msg.chat.id;
  const senderId = chatId.toString();
  const safeSenders = getSafeSenders();
  const text = msg.text || '';
  const firstName = msg.from?.first_name || 'User';

  // Check authorization
  if (!safeSenders.includes(senderId)) {
    console.log(`⚠️  Rejected message from: ${senderId}`);
    return;
  }

  // Check session exists - if not, start one!
  if (!sessionExists()) {
    console.log(`💤 No session found - waking up BMO...`);

    // Start typing loop while waking up
    startTypingLoop(chatId);

    // Queue this message
    pendingMessages.push({ text, chatId, firstName });

    // Start session (will process queued messages when ready)
    await startSession();
    return;
  }

  // If session is starting, queue the message
  if (sessionStarting) {
    console.log('⏳ Session starting, queuing message...');
    pendingMessages.push({ text, chatId, firstName });
    return;
  }

  // Start typing loop - keeps going until response is sent
  startTypingLoop(chatId);

  // Inject into session
  injectMessage(text, chatId, firstName);
}

// HTTP Server
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const hasSession = sessionExists();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      mode: 'gateway-v4-tmux',
      session: hasSession ? 'connected' : 'not found'
    }));
    return;
  }

  // Internal endpoint: transcript watcher calls this to stop typing
  if (req.method === 'POST' && req.url === '/typing-done') {
    stopTypingLoop();
    res.writeHead(200);
    res.end('ok');
    return;
  }

  if (req.method === 'POST' && req.url === '/telegram') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      res.writeHead(200);
      res.end('ok');
      try {
        const update = JSON.parse(body);
        const msg = update.message;
        if (!msg) return;

        // Handle text messages
        if (msg.text) {
          processMessage(msg);
        }
        // Handle photos
        else if (msg.photo && msg.photo.length > 0) {
          // Get the largest photo (last in array)
          const photo = msg.photo[msg.photo.length - 1];
          const timestamp = Date.now();
          const filename = `photo_${timestamp}.jpg`;
          const localPath = await downloadTelegramFile(photo.file_id, filename);

          if (localPath) {
            const caption = msg.caption || '';
            const text = caption
              ? `[Sent a photo: ${localPath}] ${caption}`
              : `[Sent a photo: ${localPath}]`;
            processMessage({ ...msg, text });
          }
        }
        // Handle documents
        else if (msg.document) {
          const doc = msg.document;
          const filename = doc.file_name || `document_${Date.now()}`;
          const localPath = await downloadTelegramFile(doc.file_id, filename);

          if (localPath) {
            const caption = msg.caption || '';
            const text = caption
              ? `[Sent a document: ${localPath}] ${caption}`
              : `[Sent a document: ${localPath}]`;
            processMessage({ ...msg, text });
          }
        }
      } catch (e) {
        console.error('Parse error:', e.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🤖 BMO Gateway v5 (wake-on-message) | Port ${PORT} | Ready!`);
  console.log(`📡 Session: ${sessionExists() ? 'connected to ' + SESSION_NAME : 'sleeping (will wake on message)'}`);
});
