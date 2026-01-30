---
name: telegram
description: Reference for Telegram integration - sending messages, receiving media, gateway architecture, and API patterns. Use when working with Telegram features.
user-invocable: false
---

# Telegram Integration

Everything the assistant knows about working with Telegram.

**See also**: `.claude/knowledge/integrations/telegram.md` for setup instructions and API basics.

## Architecture Overview

```
Telegram Cloud -> Webhook -> Cloudflare Tunnel -> Gateway (port 3847) -> tmux injection
                                                     |
                                              channel.txt = "telegram"
                                                     |
                                              Transcript Watcher -> sends responses to Telegram
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Gateway | `scripts/telegram-setup/gateway.js` | Receives webhooks, downloads media, injects to tmux, sets channel |
| Transcript Watcher | `scripts/transcript-watcher.sh` | Tails transcript, sends assistant text to active channel |
| Channel Flag | `.claude/state/channel.txt` | Current output channel: `terminal`, `telegram`, or `silent` |
| Channel Hook | `.claude/hooks/set-channel.sh` | UserPromptSubmit hook - auto-detects channel from message source |
| Send Utility | `scripts/telegram-send.sh` | Manual message/typing indicator sending |
| Media Storage | `.claude/state/telegram-media/` | Downloaded photos and documents |

### How It Works

1. **Incoming**: Telegram message -> Gateway -> sets `channel.txt` to `telegram` -> injects message into tmux session
2. **Outgoing**: Assistant writes response -> transcript entry added -> watcher detects new assistant text -> reads `channel.txt` -> sends to Telegram
3. **Channel switching**: UserPromptSubmit hook detects `[Telegram]` prefix -> sets channel to `telegram`. Direct terminal input -> sets channel to `terminal`.

### Channel Modes

| Channel | Behavior |
|---------|----------|
| `terminal` | Responses stay in terminal only (default) |
| `telegram` | Text responses sent to user via Telegram (no thinking blocks) |
| `telegram-verbose` | Text + thinking blocks sent to Telegram |
| `silent` | No messages sent anywhere - assistant works quietly |

**To change channel manually**: Write to `.claude/state/channel.txt` or ask the user (e.g., "switch to verbose", "go silent").

**Auto-detection**: The `set-channel.sh` hook runs on every prompt and sets the channel based on whether the message has a `[Telegram]` prefix. It preserves `-verbose` suffix if already in verbose mode.

## Proactive Communication

**IMPORTANT**: The assistant should switch to `telegram` channel proactively when:
- Something goes wrong and you need the user's input
- You're blocked and need a decision to proceed
- Something important or urgent needs the user's attention
- You believe the user should know about something immediately

To do this:
```bash
echo "telegram" > "$PROJECT_DIR/.claude/state/channel.txt"
```
Then write your message as normal text - the watcher will send it.

## Sending Messages

### Via Utility Script
```bash
# With explicit chat ID
TELEGRAM_CHAT_ID=YOUR_CHAT_ID "$PROJECT_DIR/scripts/telegram-send.sh" "Your message"

# Typing indicator
TELEGRAM_CHAT_ID=YOUR_CHAT_ID "$PROJECT_DIR/scripts/telegram-send.sh" typing
```

### Via API (curl)
```bash
BOT_TOKEN=$(security find-generic-password -s "credential-telegram-bot" -w)
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "CHAT_ID", "text": "Message"}'
```

## Receiving Messages

Messages arrive as `[Telegram] Name: content` in the conversation.

### Text Messages
```
[Telegram] User: Hello!
```

### Photos
```
[Telegram] User: [Sent a photo: /path/to/photo.jpg]
[Telegram] User: [Sent a photo: /path/to/photo.jpg] Optional caption
```

### Documents
```
[Telegram] User: [Sent a document: /path/to/file.pdf]
```

**To view media**: Use the Read tool on the file path.

## Gateway Details

### How Wake-on-Message Works
1. Gateway checks if tmux session exists
2. If not, runs `start-tmux.sh --detach`
3. Waits 12 seconds for Claude to initialize
4. Processes queued messages

### Media Download Process
1. Get `file_id` from message (photo/document)
2. Call `getFile` API to get `file_path`
3. Download from `https://api.telegram.org/file/bot{token}/{file_path}`
4. Save to `.claude/state/telegram-media/`

## Transcript Watcher Details

### How It Works
1. Started by SessionStart hook with current transcript path
2. Uses polling to watch for new lines (only new, not existing)
3. Parses each new line as JSON
4. If `type == "assistant"` and contains text content -> send to active channel
5. Reads `channel.txt` on each message to get current channel

### Starting Manually
```bash
nohup "$PROJECT_DIR/scripts/transcript-watcher.sh" /path/to/transcript.jsonl > /dev/null 2>&1 &
```

### Check Watcher Status
```bash
pgrep -f transcript-watcher
tail -f "$PROJECT_DIR/logs/watcher.log"
```

## Gotchas & Learnings

### Transcript Structure
- Entries are JSONL (one JSON object per line)
- Types: `assistant`, `user`, `progress`, `system`
- Assistant text is in `.message.content[]` where `.type == "text"`
- Each entry has a unique `uuid` and `timestamp`

### tmux Socket Path
- Scripts running from launchd need explicit socket path
- Use: `/opt/homebrew/bin/tmux -S /private/tmp/tmux-$(id -u)/default`

### Message Escaping
- Single quotes in messages need escaping for tmux: `'\\''`
- JSON in curl needs proper quoting

### Telegram Message Limits
- Max message length: 4096 characters
- Watcher truncates at 4000 chars with "..." suffix

## Telegram API Reference

### Useful Endpoints
| Endpoint | Purpose |
|----------|---------|
| `sendMessage` | Send text message |
| `sendChatAction` | Send typing indicator |
| `getFile` | Get file path for download |
| `getMe` | Verify bot token |

### Chat Actions
- `typing` - Text typing indicator
- `upload_photo` - Photo upload indicator
- `upload_document` - Document upload indicator

### Bot Token
Stored in Keychain as `credential-telegram-bot`

```bash
security find-generic-password -s "credential-telegram-bot" -w
```

## User Chat ID
Store in `.claude/state/safe-senders.json` and `.claude/state/memory.md`.

## Testing

### Verify Gateway Running
```bash
curl http://localhost:3847/health
```

### Check Gateway Logs
```bash
tail -f "$PROJECT_DIR/logs/gateway.log"
```

### Check Watcher Logs
```bash
tail -f "$PROJECT_DIR/logs/watcher.log"
```

### Restart Gateway
```bash
pkill -f "gateway.js"
cd "$PROJECT_DIR/scripts/telegram-setup"
nohup node gateway.js >> "$PROJECT_DIR/logs/gateway.log" 2>&1 &
```

## Future Enhancements

- [ ] Voice message transcription
- [ ] Location handling
- [ ] Reply context (know what message is being replied to)
- [ ] Inline keyboards for quick responses
- [ ] Edit previous messages instead of sending new ones
