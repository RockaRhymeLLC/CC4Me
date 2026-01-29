const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3847;
const MESSAGES_FILE = path.join(__dirname, 'incoming-messages.json');
const SAFE_SENDERS_FILE = '/Users/bmo/CC4Me-BMO/.claude/state/safe-senders.json';

// Get bot token from Keychain
const BOT_TOKEN = execSync('security find-generic-password -s "credential-telegram-bot" -w').toString().trim();

// Initialize messages file
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, '[]');
}

// Load safe senders
function getSafeSenders() {
  try {
    const data = JSON.parse(fs.readFileSync(SAFE_SENDERS_FILE, 'utf8'));
    return data.telegram?.users || [];
  } catch (error) {
    console.error('Error loading safe senders:', error);
    return [];
  }
}

// Send Telegram message
function sendTelegramMessage(chatId, text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ chat_id: chatId, text: text });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Telegram webhook endpoint
  if (req.method === 'POST' && req.url === '/telegram') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const update = JSON.parse(body);
        const timestamp = new Date().toISOString();

        if (update.message) {
          const msg = update.message;
          const senderId = msg.chat.id.toString();
          const safeSenders = getSafeSenders();

          // Security check: only process messages from safe senders
          if (!safeSenders.includes(senderId)) {
            console.log(`⚠️  [${timestamp}] Rejected message from unknown sender: ${senderId}`);

            // Politely decline
            await sendTelegramMessage(msg.chat.id,
              "Hi! I'm BMO, Dave's assistant. I can only respond to my authorized user. " +
              "If you're Dave and this is a new account, please update my safe senders list."
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, processed: false, reason: 'not_safe_sender' }));
            return;
          }

          // Process message from safe sender
          const messageData = {
            timestamp,
            update_id: update.update_id,
            message_id: msg.message_id,
            chat_id: msg.chat.id,
            from: {
              id: msg.from.id,
              first_name: msg.from.first_name,
              last_name: msg.from.last_name,
              username: msg.from.username
            },
            text: msg.text || '',
            date: new Date(msg.date * 1000).toISOString(),
            processed: false
          };

          // Append to messages file
          const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
          messages.push(messageData);
          fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

          console.log(`✅ [${timestamp}] Message from ${msg.from.first_name}: "${msg.text}"`);

          // Send acknowledgment
          await sendTelegramMessage(msg.chat.id,
            `Got it! 🎮 Your message has been received and queued for BMO.`
          );
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));

      } catch (error) {
        console.error('Error processing webhook:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    return;
  }

  // Default response
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  const safeSenders = getSafeSenders();
  console.log(`🤖 BMO Telegram Webhook Server running on port ${PORT}`);
  console.log(`   Safe senders: ${safeSenders.length > 0 ? safeSenders.join(', ') : 'none configured!'}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Webhook endpoint: http://localhost:${PORT}/telegram`);
  console.log(`   Messages stored in: ${MESSAGES_FILE}`);
  console.log('\n🔒 Only processing messages from safe senders.\n');
});
