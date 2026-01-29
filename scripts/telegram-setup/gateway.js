#!/usr/bin/env node
/**
 * BMO Telegram Gateway v5 (wake-on-message)
 * Receives webhooks and injects messages into the real Claude Code session via tmux.
 * If no session exists, starts one automatically!
 * The Stop hook handles sending responses back to Telegram.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const TELEGRAM_SEND = '/Users/bmo/CC4Me-BMO/scripts/telegram-send.sh';

// Configuration
const PORT = 3847;
const BASE_DIR = '/Users/bmo/CC4Me-BMO';
const STATE_DIR = path.join(BASE_DIR, '.claude/state');
const SAFE_SENDERS_FILE = path.join(STATE_DIR, 'safe-senders.json');
const PENDING_FILE = path.join(STATE_DIR, 'telegram-pending.json');
const START_SCRIPT = path.join(BASE_DIR, 'scripts/start-tmux.sh');
const TMUX = '/opt/homebrew/bin/tmux';
const SESSION_NAME = 'bmo';

// Track if we're currently starting a session
let sessionStarting = false;
let pendingMessages = [];

// Send typing indicator
function sendTypingIndicator(chatId) {
  try {
    execSync(`TELEGRAM_CHAT_ID=${chatId} "${TELEGRAM_SEND}" typing`, { stdio: 'ignore' });
    console.log('⌨️  Sent typing indicator');
  } catch (e) {
    console.error('⚠️  Failed to send typing indicator');
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
  // Save pending info for the Stop hook
  const pending = {
    chatId: chatId,
    firstName: firstName,
    timestamp: Date.now(),
    message: text
  };
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));

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

    // Send typing indicator while waking up
    sendTypingIndicator(chatId);

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

  // Send typing indicator - BMO is about to work on this
  sendTypingIndicator(chatId);

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

  if (req.method === 'POST' && req.url === '/telegram') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(200);
      res.end('ok');
      try {
        const update = JSON.parse(body);
        if (update.message?.text) {
          processMessage(update.message);
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
