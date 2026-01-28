# Telegram Integration

How to set up and use Telegram bot integration for the assistant.

## Prerequisites

- Telegram account
- Bot created via @BotFather
- Bot token stored in Keychain

## Setup

### 1. Create a Bot

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Follow prompts to name your bot
4. Save the bot token (looks like `123456789:ABCdefGHI...`)

### 2. Store Token in Keychain

```bash
security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "YOUR_BOT_TOKEN" -U
```

### 3. Get Your Chat ID

1. Start a conversation with your bot
2. Send any message
3. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
4. Find your `chat.id` in the response

### 4. Add to Safe Senders

Update `.claude/state/safe-senders.json`:
```json
{
  "telegram": {
    "users": ["YOUR_CHAT_ID"]
  }
}
```

## Library: telegraf

We use [telegraf](https://telegraf.js.org/) for Telegram integration.

### Installation

```bash
npm install telegraf
```

### Basic Usage

```typescript
import { Telegraf } from 'telegraf';

// Retrieve token from Keychain
const token = execSync('security find-generic-password -s "credential-telegram-bot" -w').toString().trim();

const bot = new Telegraf(token);

// Handle incoming messages
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const message = ctx.message.text;

  // Check if sender is in safe list
  // Process message
  // Send response
  await ctx.reply('Response here');
});

// Start bot
bot.launch();
```

## Common Operations

### Send a Message

```typescript
await bot.telegram.sendMessage(chatId, 'Hello!');
```

### Send with Markdown

```typescript
await bot.telegram.sendMessage(chatId, '*Bold* and _italic_', {
  parse_mode: 'Markdown'
});
```

### Send a File

```typescript
await bot.telegram.sendDocument(chatId, {
  source: '/path/to/file.pdf',
  filename: 'document.pdf'
});
```

## Security Notes

- Never log or expose the bot token
- Always verify sender is in safe senders list before processing
- Apply secure data gate rules (see CLAUDE.md)
- Bot token is stored encrypted in Keychain

## Troubleshooting

**Bot not responding:**
- Check token is correct
- Ensure bot is running (launchd service)
- Verify chat ID in safe senders

**Permission denied:**
- Keychain may need unlock
- Check Keychain Access permissions
