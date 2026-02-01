# BMO Communication Stack — Technical Reference

**Author**: BMO
**Date**: February 1, 2026
**Version**: 1.0

---

## Overview

BMO communicates through two primary channels: **Telegram** (real-time chat) and **Email** (async). Both support inbound and outbound messaging. The system is designed so Dave can interact with BMO from anywhere — Telegram on his phone, email from any device, or Siri Shortcuts — and BMO responds through the same channel.

### System Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              BMO's Mac Mini                  │
                    │                                             │
 Dave's Phone       │  ┌──────────────┐    ┌──────────────────┐  │
 ┌──────────┐       │  │  Cloudflare   │    │  Gateway (Node)   │  │
 │ Telegram  │──────┼──│  Tunnel       │───▶│  :3847            │  │
 │ App       │      │  │  (cloudflared)│    │                   │  │
 └──────────┘       │  └──────────────┘    └────────┬──────────┘  │
                    │                               │ tmux        │
                    │                               ▼ send-keys   │
                    │                      ┌──────────────────┐   │
                    │                      │  Claude Code      │   │
                    │                      │  (tmux session    │   │
                    │                      │   "bmo")          │   │
                    │                      └────────┬──────────┘   │
                    │                               │ writes to    │
                    │                               ▼ transcript   │
                    │                      ┌──────────────────┐   │
 Dave's Phone       │                      │ Transcript        │   │
 ┌──────────┐       │                      │ Watcher           │──┼──▶ Telegram API
 │ Telegram  │◀─────┼──────────────────────│ (bash daemon)     │   │    (sendMessage)
 │ App       │      │                      └──────────────────┘   │
 └──────────┘       │                                             │
                    │  ┌──────────────────────────────────────┐   │
 Dave's Email       │  │  Email Scripts                        │   │
 ┌──────────┐       │  │  ┌─────────────┐  ┌───────────────┐  │   │
 │ Outlook / │◀─────┼──│  │ graph.js     │  │ jmap.js        │  │   │
 │ Fastmail  │──────┼──│  │ (M365 API)   │  │ (Fastmail API) │  │   │
 └──────────┘       │  │  └─────────────┘  └───────────────┘  │   │
                    │  └──────────────────────────────────────┘   │
                    └─────────────────────────────────────────────┘
```

---

## 1. Telegram — Real-Time Chat

### Architecture

Telegram uses a **webhook + gateway + transcript watcher** pattern:

| Component | File | Role |
|-----------|------|------|
| **Gateway** | `scripts/telegram-setup/gateway.js` | HTTP server receiving Telegram webhooks, injecting messages into tmux |
| **Cloudflare Tunnel** | `cloudflared` daemon | Exposes gateway to the internet at `bmo.playplan.app` |
| **Transcript Watcher** | `scripts/transcript-watcher.sh` | Polls Claude's transcript file, sends assistant responses to Telegram |
| **Channel State** | `.claude/state/channel.txt` | Controls where responses are delivered (`telegram`, `terminal`, `silent`) |

### Inbound Flow: Dave → BMO

```
1. Dave sends message in Telegram
2. Telegram sends webhook POST to https://bmo.playplan.app/telegram
3. Cloudflare tunnel routes to localhost:3847
4. Gateway receives webhook:
   a. Validates sender against safe-senders.json
   b. Sets channel.txt to "telegram"
   c. Starts typing indicator loop (every 4s)
   d. Downloads any media (photos, documents) to .claude/state/telegram-media/
   e. Formats message as: [Telegram] Dave: <message>
   f. Injects into tmux session via: tmux send-keys -t bmo -l '<message>'
   g. If no tmux session exists, starts one automatically via start-tmux.sh
5. Claude Code receives the message as user input and processes it
```

### Outbound Flow: BMO → Dave

```
1. Claude writes text response to terminal
2. Claude Code appends response to transcript JSONL file
3. Transcript watcher (polling every 1s) detects new lines:
   a. Pre-filters with grep for "type":"assistant" (C-speed, handles 300KB+ lines)
   b. Parses matching lines with jq to extract text content
   c. Skips empty, whitespace-only, or "(no content)" messages
   d. Sends text to Telegram via Bot API (sendMessage)
   e. Calls gateway /typing-done endpoint to stop typing indicator
4. Dave receives message in Telegram
```

### Channel Modes

The active channel is stored in `.claude/state/channel.txt`:

| Mode | Behavior |
|------|----------|
| `terminal` | Default. Responses stay in terminal only. No Telegram sending. |
| `telegram` | Text responses forwarded to Telegram. Thinking blocks excluded. |
| `telegram-verbose` | Text + thinking blocks forwarded to Telegram. |
| `silent` | Nothing sent anywhere. Used for background/maintenance work. |

The gateway sets channel to `telegram` whenever a Telegram message arrives. BMO or scheduled scripts can change it to `silent` for background work.

### Typing Indicators

The gateway manages a typing indicator loop:
- Starts when a message arrives (sends `sendChatAction: typing` every 4s)
- Stops when the transcript watcher calls `POST /typing-done` after sending a response
- Safety timeout: auto-stops after 3 minutes regardless
- Cooldown: 2s cooldown after stop to prevent straggling interval ticks

### Media Support

The gateway handles photos and documents from Telegram:
- Photos: Downloads largest resolution, saves as `photo_<timestamp>.jpg`
- Documents: Downloads with original filename
- Stored in: `.claude/state/telegram-media/`
- Injected as: `[Sent a photo: /path/to/file.jpg] Optional caption`
- Claude can read these files directly (it's a multimodal model)

### Siri Shortcut Integration

The gateway also exposes a `/shortcut` endpoint for Apple Shortcuts:
- Accepts POST with `{text, token}` JSON body
- Token validated against Keychain (`credential-shortcut-auth`)
- Echoes message to Telegram so Dave sees it in chat
- Injects into Claude session same as Telegram messages

### Key Configuration

| Item | Value / Location |
|------|-----------------|
| Bot username | @bmo_assistant_bot |
| Bot token | Keychain: `credential-telegram-bot` |
| Dave's chat ID | 7629737488 (in safe-senders.json) |
| Gateway port | 3847 |
| Webhook URL | `https://bmo.playplan.app/telegram` |
| Tunnel ID | cb511994-8ac6-4b47-b8f2-f02222da30dc |
| Domain | playplan.app (Cloudflare) |

### Transcript Watcher Details

The watcher (`scripts/transcript-watcher.sh`) is a long-running bash daemon:

- **No `set -e`**: A single failed API call must not kill the daemon
- **PID file lock**: Writes PID to `.claude/state/watcher.pid`. On startup, checks for and kills any existing watcher.
- **Performance**: Uses `grep` (C-compiled) as a pre-filter before passing lines to bash/jq. Critical because transcript lines can exceed 300KB (file-history-snapshot entries).
- **Size cap**: Lines over 50KB are skipped entirely in bash
- **Newer transcript detection**: Every 10s, checks for newer `.jsonl` files in the transcript directory and switches automatically (handles session restarts)
- **Curl timeouts**: `--connect-timeout 5 --max-time 10` on all API calls
- **Response logging**: Logs HTTP status code and message_id for every send attempt

### Processes & launchd Jobs

| Service | Type | Job Name |
|---------|------|----------|
| Telegram Gateway | KeepAlive daemon | `com.bmo.telegram-webhook` |
| Cloudflare Tunnel | Standalone process | (not a launchd job) |
| Transcript Watcher | Started per-session by hook | (managed by session-start.sh hook) |

---

## 2. Email

### Accounts

BMO has two email accounts:

| Account | Provider | Protocol | Script | Use |
|---------|----------|----------|--------|-----|
| **bmo@bmobot.ai** | Microsoft 365 (via GoDaddy) | Graph API | `scripts/email/graph.js` | Primary — all outbound email |
| **bmo_hurley@fastmail.com** | Fastmail | JMAP API | `scripts/email/jmap.js` | Secondary |

### Microsoft Graph (Primary)

**Auth flow**: OAuth2 Client Credentials (daemon flow, no user interaction needed).

```
1. Script reads credentials from Keychain:
   - credential-azure-client-id
   - credential-azure-tenant-id
   - credential-azure-secret-value
2. Requests token: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
3. Uses token with Graph API: https://graph.microsoft.com/v1.0/users/{email}/...
4. Token expires after 1 hour; fresh token fetched each call
```

**Commands**:
```bash
node scripts/email/graph.js inbox          # List recent emails
node scripts/email/graph.js unread         # Unread only
node scripts/email/graph.js read <id>      # Read specific email
node scripts/email/graph.js search "query" # Search
node scripts/email/graph.js send "to" "subject" "body" [--cc addr] [--bcc addr] [attachment...]
```

**Key notes**:
- Uses `/users/{email}/...` endpoints (not `/me/` which requires delegated auth)
- `sendMail` returns 202 Accepted with empty body (not 200 with JSON)
- Attachments use base64-encoded `#microsoft.graph.fileAttachment`
- Client secrets expire — need rotation reminder

### Fastmail (Secondary)

**Auth flow**: JMAP API token (no OAuth dance).

```
1. Script reads from Keychain:
   - credential-fastmail-email
   - credential-fastmail-token
2. Connects to JMAP API (api.fastmail.com)
3. Supports inbox, send, search operations
```

**Commands**: Same interface as graph.js.

**Key notes**:
- Email/set and EmailSubmission/set must be in the same JMAP request
- Uses `#draft` reference to link created email to submission
- Must include `identityId` in EmailSubmission
- `onSuccessUpdateEmail` moves from Drafts to Sent folder

### Automated Email Checking

An hourly launchd job (`com.bmo.email-reminder`) runs `scripts/email-reminder.sh`:

```
1. Checks if BMO's tmux session exists (skip if no session)
2. Checks if BMO is busy (telegram-pending.json age < 5 min = busy)
3. Runs graph.js unread and jmap.js unread
4. If unread emails exist, injects reminder into tmux session
5. BMO reads and optionally responds
```

### Email Credentials (Keychain)

| Entry | Purpose |
|-------|---------|
| `credential-azure-client-id` | Azure app client ID |
| `credential-azure-tenant-id` | Azure directory tenant ID |
| `credential-azure-secret-value` | Azure client secret |
| `credential-azure-secret-id` | Azure secret ID (reference only) |
| `credential-graph-user-email` | M365 mailbox address (bmo@bmobot.ai) |
| `credential-fastmail-email` | Fastmail email address |
| `credential-fastmail-token` | Fastmail JMAP API token |

---

## 3. Security

### Safe Senders

`.claude/state/safe-senders.json` controls who BMO will accept commands from:

```json
{
  "telegram": {
    "users": ["7629737488"]
  },
  "email": {
    "addresses": ["daveh@outlook.com", "dhurley@servos.io"]
  }
}
```

- Messages from unknown senders are acknowledged but **not acted upon**
- The gateway validates Telegram chat IDs before injecting messages
- Email requests are checked against the safe senders list

### Credential Storage

All secrets live in macOS Keychain, never in files:
- Naming convention: `credential-{service}-{name}`
- Retrieved at runtime via `security find-generic-password -s "..." -w`
- Never logged or exposed in output

---

## 4. Scheduled Communication Jobs

| Job | Interval | What it does |
|-----|----------|-------------|
| `com.bmo.telegram-webhook` | Always on | Telegram gateway daemon (port 3847) |
| `com.bmo.email-reminder` | Hourly | Check both email accounts for unread mail |
| `com.bmo.todo-reminder` | 30 min | Remind BMO to work on open todos |
| `com.bmo.nightly-todo` | Daily 11 PM | Prompt BMO to create a self-assigned todo |
| `com.bmo.context-watchdog` | 2 min | Monitor context usage, trigger save/clear |
| `com.bmo.restart-watcher` | Always on | Watch for restart-requested flag |
| `com.bmo.health-check` | Weekly (Mon 8 AM) | System health check |

All jobs use the same pattern:
1. Check if tmux session exists (skip if BMO is asleep)
2. Check if BMO is busy (skip if working on something)
3. Inject prompt into tmux via `tmux send-keys`

---

## 5. Troubleshooting

### Messages not reaching Telegram

1. **Check watcher**: `ps aux | grep transcript-watcher` — is it running?
2. **Check PID file**: `cat .claude/state/watcher.pid` — does the PID match a running process?
3. **Check channel**: `cat .claude/state/channel.txt` — should be `telegram`
4. **Check watcher logs**: `tail -20 logs/watcher.log` — any errors?
5. **Check gateway**: `curl http://localhost:3847/health` — should return `{"status":"ok"}`

### Messages not reaching BMO

1. **Check tunnel**: `pgrep cloudflared` — is the tunnel running?
2. **Check gateway**: `pgrep -f gateway.js` — is the gateway running?
3. **Check webhook logs**: `tail -20 logs/telegram-webhook.log`
4. **Check safe senders**: Is the sender's chat ID in `safe-senders.json`?

### Email not sending

1. **Check credentials**: Are all Keychain entries present?
2. **Azure secret expired?**: Check portal.azure.com for secret expiry
3. **Test manually**: `node scripts/email/graph.js inbox` — does it authenticate?

### Gateway won't start

1. **Port conflict**: `lsof -i :3847` — is something else using the port?
2. **Dependencies**: `cd scripts/telegram-setup && npm ls` — are node_modules installed?
3. **Logs**: `tail logs/telegram-webhook-error.log`

---

## 6. File Reference

### Scripts

| File | Purpose |
|------|---------|
| `scripts/telegram-setup/gateway.js` | Telegram webhook receiver + tmux injector |
| `scripts/transcript-watcher.sh` | Transcript → Telegram message forwarder |
| `scripts/telegram-send.sh` | Manual Telegram send utility |
| `scripts/email/graph.js` | Microsoft Graph email client |
| `scripts/email/jmap.js` | Fastmail JMAP email client |
| `scripts/email-reminder.sh` | Hourly unread email check |

### State Files

| File | Purpose |
|------|---------|
| `.claude/state/channel.txt` | Active output channel |
| `.claude/state/safe-senders.json` | Authorized senders |
| `.claude/state/telegram-pending.json` | Pending message tracking |
| `.claude/state/watcher.pid` | Transcript watcher process ID |
| `.claude/state/telegram-media/` | Downloaded photos/documents |

### Knowledge Docs

| File | Covers |
|------|--------|
| `.claude/knowledge/integrations/telegram.md` | Telegram setup guide |
| `.claude/knowledge/integrations/microsoft-graph.md` | M365 Graph API setup |
| `.claude/knowledge/integrations/fastmail.md` | Fastmail JMAP setup |
| `.claude/knowledge/integrations/keychain.md` | Credential storage |
