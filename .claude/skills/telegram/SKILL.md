---
name: telegram
description: Reference for Telegram integration - sending messages, receiving media, gateway architecture, and API patterns. Use when working with Telegram features.
user-invocable: false
---

# Telegram Integration

Everything BMO knows about working with Telegram.

## Architecture Overview

```
Telegram Cloud → Webhook → Cloudflare Tunnel → Gateway (port 3847) → tmux injection
                                                     ↓
                                              telegram-pending.json
                                                     ↓
                                              Stop Hook → Reply to Telegram
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Gateway | `scripts/telegram-setup/gateway.js` | Receives webhooks, downloads media, injects to tmux |
| Reply Hook | `.claude/hooks/telegram-reply.sh` | Extracts response from transcript, sends to Telegram |
| Send Utility | `scripts/telegram-send.sh` | Manual message/typing indicator sending |
| Media Storage | `.claude/state/telegram-media/` | Downloaded photos and documents |
| Pending File | `.claude/state/telegram-pending.json` | Tracks message awaiting response |

## Sending Messages

### Via Utility Script
```bash
# With pending file (after receiving Telegram message)
/Users/bmo/CC4Me-BMO/scripts/telegram-send.sh "Your message"

# With explicit chat ID
TELEGRAM_CHAT_ID=7629737488 /Users/bmo/CC4Me-BMO/scripts/telegram-send.sh "Your message"

# Typing indicator
TELEGRAM_CHAT_ID=7629737488 /Users/bmo/CC4Me-BMO/scripts/telegram-send.sh typing
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
[Telegram] Dave: Hello BMO!
```

### Photos
```
[Telegram] Dave: [Sent a photo: /path/to/photo.jpg]
[Telegram] Dave: [Sent a photo: /path/to/photo.jpg] Optional caption
```

### Documents
```
[Telegram] Dave: [Sent a document: /path/to/file.pdf]
```

**To view media**: Use the Read tool on the file path.

## Gateway Details

### Version History
- v5: Wake-on-message (start session if none exists)
- v6: Photo and document support

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

## Reply Hook Details

### How It Works
1. Stop hook fires when assistant finishes responding
2. Checks for `telegram-pending.json`
3. Reads transcript JSONL file
4. Finds last assistant message with text content
5. Sends text to Telegram via API
6. Deletes pending file

### Critical: Finding Text in Transcript
The transcript contains various entry types: `thinking`, `tool_use`, `text`.
Must find the last assistant entry that **contains** text, not just the last entry:

```bash
jq -s '
  [.[] | select(.type == "assistant") |
   select(.message.content | map(select(.type == "text")) | length > 0)] |
  last |
  [.message.content[] | select(.type == "text") | .text] | join("\n")
' "$TRANSCRIPT_PATH"
```

## Gotchas & Learnings

### Transcript Parsing
- **Problem**: Last assistant message might be `tool_use` with no text
- **Solution**: Filter to entries that contain text blocks before taking last

### tmux Socket Path
- Scripts running from launchd need explicit socket path
- Use: `/opt/homebrew/bin/tmux -S /private/tmp/tmux-502/default`

### Pending File Timing
- Pending file is created when message injected
- Cleared after hook sends reply (or times out at 5 min)
- If responding to terminal input (not Telegram), no pending file exists

### Message Escaping
- Single quotes in messages need escaping for tmux: `'\\''`
- JSON in curl needs proper quoting

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

## Dave's Chat ID
`7629737488` (also in memory.md and safe-senders.json)

## Testing

### Verify Gateway Running
```bash
curl http://localhost:3847/health
```

### Check Gateway Logs
```bash
tail -f /Users/bmo/CC4Me-BMO/logs/gateway.log
```

### Check Hook Logs
```bash
tail -f /Users/bmo/CC4Me-BMO/logs/telegram-hook.log
```

### Restart Gateway
```bash
pkill -f "gateway.js"
cd /Users/bmo/CC4Me-BMO/scripts/telegram-setup
nohup node gateway.js >> /Users/bmo/CC4Me-BMO/logs/gateway.log 2>&1 &
```

## Future Enhancements

- [ ] Voice message transcription
- [ ] Location handling
- [ ] Reply context (know what message is being replied to)
- [ ] Inline keyboards for quick responses
- [ ] Edit previous messages instead of sending new ones
