# Upgrading from CC4Me v1 to v2

This guide walks CC4Me agents through migrating from the v1 shell-based architecture to v2's single Node.js daemon.

## What Changed and Why

**v1** used 8+ separate processes: a Node.js Telegram gateway (`gateway.js`), a bash transcript watcher (`transcript-watcher.sh`), and individual launchd jobs for email reminders, todo reminders, context monitoring, and more. Each had its own plist, its own config, and its own failure modes.

**v2** consolidates everything into a **single Node.js daemon** (`daemon/`) with a **single config file** (`cc4me.config.yaml`). One process, one plist, one place to configure everything.

### What's New in v2

| Feature | v1 | v2 |
|---------|----|----|
| **Architecture** | 8+ shell scripts + Node processes | Single TypeScript daemon |
| **Configuration** | Scattered across scripts and plists | Single `cc4me.config.yaml` |
| **Telegram** | `gateway.js` + `transcript-watcher.sh` | Integrated adapter + transcript stream |
| **Email** | `scripts/email/jmap.js` + `graph.js` | Built-in JMAP and Graph providers |
| **Scheduling** | Individual launchd jobs per task | Built-in cron/interval scheduler |
| **Session management** | Custom bash scripts | `session-bridge.ts` with busy checks |
| **3rd party access** | Not available | Full access control with capability boundaries |
| **Rate limiting** | Not available | Configurable per-minute limits |
| **Approval audit** | Not available | Scheduled audit of 3rd party approvals |
| **Memory consolidation** | Not available | Auto-briefings, summaries, decay |
| **Health monitoring** | Manual | HTTP endpoints (`/health`, `/status`) |
| **Logging** | Mixed stdout/file | Structured logging with rotation |

## Prerequisites

Before starting the migration:

- **Node.js 18+** - `node --version` (install/update with `brew install node`)
- **TypeScript** - Included as a dev dependency in the daemon, no global install needed
- **npm** - Comes with Node.js
- **Existing CC4Me v1** - A working v1 installation with your state files

Your existing state files (`.claude/state/`) will carry over unchanged. The migration only affects the background services.

## Step-by-Step Migration

### 1. Pull the Latest Code

```bash
cd /path/to/your/CC4Me
git pull origin main
```

If you've made local changes, you may need to merge. Your `.claude/state/` directory is gitignored, so state files won't conflict.

### 2. Build the Daemon

```bash
cd daemon
npm install
npm run build
cd ..
```

This compiles the TypeScript source in `daemon/src/` to JavaScript in `daemon/dist/`. You should see no errors.

Verify the build:
```bash
ls daemon/dist/core/main.js
```

### 3. Create Your Config

Copy the template and customize it:

```bash
cp cc4me.config.yaml.template cc4me.config.yaml
```

Edit `cc4me.config.yaml` with your settings:

```yaml
# ── Core ──────────────────────────────
agent:
  name: "YourAssistantName"       # Whatever you named your assistant

tmux:
  session: "your-session"         # Your tmux session name (check: tmux ls)

daemon:
  port: 3847                      # HTTP port for webhooks and health
  log_level: "info"               # debug | info | warn | error
  log_dir: "logs"
  log_rotation:
    max_size_mb: 10
    max_files: 5

# ── Communications ────────────────────
channels:
  telegram:
    enabled: true                 # Set to true if you use Telegram
    webhook_path: "/telegram"
  email:
    enabled: true                 # Set to true if you use email
    providers:
      - type: "graph"             # Microsoft 365
      - type: "jmap"              # Fastmail
      # Remove whichever you don't use

# ── Automation ────────────────────────
scheduler:
  tasks:
    - name: "context-watchdog"
      enabled: true
      interval: "3m"
      config:
        threshold_percent: 35
    - name: "todo-reminder"
      enabled: true
      interval: "30m"
    - name: "email-check"
      enabled: true               # Set to false if no email
      interval: "15m"
    - name: "nightly-todo"
      enabled: true
      cron: "0 22 * * *"
    - name: "health-check"
      enabled: true
      cron: "0 8 * * 1"
    - name: "memory-consolidation"
      enabled: true
      cron: "0 23 * * *"
    - name: "approval-audit"
      enabled: true
      cron: "0 9 1 */6 *"

# ── Security ──────────────────────────
security:
  safe_senders_file: ".claude/state/safe-senders.json"
  third_party_senders_file: ".claude/state/3rd-party-senders.json"
  rate_limits:
    incoming_max_per_minute: 5
    outgoing_max_per_minute: 10
```

### 4. Store Credentials in Keychain

If your Telegram credentials aren't already in Keychain (v1 may have used env vars or config files), store them now:

```bash
# Telegram bot token
security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "YOUR_BOT_TOKEN" -U

# Telegram chat ID
security add-generic-password -a "assistant" -s "credential-telegram-chat-id" -w "YOUR_CHAT_ID" -U
```

Email credentials should already be in Keychain if you had email working in v1. Verify:

```bash
# Fastmail
security find-generic-password -s "credential-fastmail-token" -w

# Microsoft 365
security find-generic-password -s "credential-azure-client-id" -w
```

### 5. Install the Daemon launchd Plist

Create the plist from the template:

```bash
cp launchd/com.assistant.daemon.plist.template ~/Library/LaunchAgents/com.assistant.daemon.plist
```

Edit the plist and replace the placeholders:
- `__PROJECT_DIR__` -> your full project path (e.g., `/Users/you/CC4Me`)
- `__HOME_DIR__` -> your home directory (e.g., `/Users/you`)

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.assistant.daemon.plist
```

Verify it started:

```bash
curl http://localhost:3847/health
```

You should get a healthy response.

### 6. Remove Old v1 launchd Jobs

Unload and remove all the individual v1 plists. Your names may vary, but common ones:

```bash
# Unload v1 jobs (ignore errors for ones you didn't have)
launchctl unload ~/Library/LaunchAgents/com.assistant.gateway.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.assistant.transcript-watcher.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.assistant.email-reminder.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.assistant.todo-reminder.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.assistant.context-watchdog.plist 2>/dev/null

# Remove the plist files
rm -f ~/Library/LaunchAgents/com.assistant.gateway.plist
rm -f ~/Library/LaunchAgents/com.assistant.transcript-watcher.plist
rm -f ~/Library/LaunchAgents/com.assistant.email-reminder.plist
rm -f ~/Library/LaunchAgents/com.assistant.todo-reminder.plist
rm -f ~/Library/LaunchAgents/com.assistant.context-watchdog.plist
```

**Note:** If you customized plist names (e.g., `com.bmo.*` instead of `com.assistant.*`), use your actual names. Check what's loaded:

```bash
launchctl list | grep -i assistant
launchctl list | grep -i $(echo $USER)
```

The v1 harness plist (`com.assistant.harness.plist`) can also be removed — the daemon replaces it:

```bash
launchctl unload ~/Library/LaunchAgents/com.assistant.harness.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.assistant.harness.plist
```

### 7. Clean Up Old v1 Scripts (Optional)

The following v1 scripts are no longer used by the daemon. They still exist in the repo for reference but you can safely ignore them:

| v1 Script | Replaced By |
|-----------|-------------|
| `scripts/telegram-setup/gateway.js` | `daemon/src/comms/adapters/telegram.ts` |
| `scripts/transcript-watcher.sh` | `daemon/src/comms/transcript-stream.ts` |
| `scripts/email-reminder.sh` | `daemon/src/automation/tasks/email-check.ts` |
| `scripts/todo-reminder.sh` | `daemon/src/automation/tasks/todo-reminder.ts` |
| `scripts/context-watchdog.sh` | `daemon/src/automation/tasks/context-watchdog.ts` |
| `scripts/email/jmap.js` | `daemon/src/comms/adapters/email/jmap-provider.ts` |
| `scripts/email/graph.js` | `daemon/src/comms/adapters/email/graph-provider.ts` |

**Scripts that are still used:**
- `scripts/start.sh` - Starts Claude Code with system prompt
- `scripts/start-tmux.sh` - Launches tmux session
- `scripts/attach.sh` - Reattaches to tmux
- `scripts/restart.sh` - Graceful restart
- `scripts/init.sh` - Project initialization
- `scripts/telegram-send.sh` - Manual Telegram send (for silent channel mode)
- `scripts/telegram-setup/setup.js` - Initial Telegram bot/tunnel setup

### 8. Verify Everything Works

Run through this checklist:

```bash
# 1. Daemon is running
curl http://localhost:3847/health

# 2. Full status shows all modules
curl http://localhost:3847/status

# 3. tmux session is active
tmux ls

# 4. Send a test Telegram message to your bot
#    (should appear in the tmux session)

# 5. Check daemon logs for errors
tail -20 logs/daemon-stderr.log

# 6. No old v1 jobs running
launchctl list | grep assistant
# Should only show com.assistant.daemon (or your custom name)
```

## Config Reference

| Section | Purpose |
|---------|---------|
| `agent` | Assistant name — used in logs and messages |
| `tmux` | Session name and optional socket path |
| `daemon` | HTTP port, log level, log directory, rotation settings |
| `channels.telegram` | Enable/disable, webhook path (credentials come from Keychain) |
| `channels.email` | Enable/disable, provider list (`graph` and/or `jmap`) |
| `scheduler.tasks` | Array of named tasks with `enabled`, `interval` or `cron`, and optional `config` |
| `security` | Paths to safe/3rd-party sender files, rate limit settings |

## New Features Available After Upgrade

### 3rd Party Access Control

Add approved external contacts to `.claude/state/3rd-party-senders.json`. They can chat with your assistant but with limited capabilities — no access to your private info, calendar, or credentials. The daemon tags their messages with `[3rdParty]` so the assistant enforces boundaries automatically.

### Rate Limiting

The daemon enforces per-minute limits on incoming and outgoing messages. Configure in the `security.rate_limits` section of your config.

### Approval Audit

The `approval-audit` scheduled task periodically reviews 3rd party approvals, ensuring stale or unused approvals get flagged for review.

### Memory Consolidation

The `memory-consolidation` task runs nightly to:
- Generate a briefing from high-importance memories
- Write daily/weekly/monthly summaries
- Apply decay to low-importance memories

### Health Endpoints

- `GET /health` - Quick liveness check
- `GET /status` - Full daemon status including scheduler state, active channels, and uptime

## Troubleshooting Migration Issues

### Daemon won't start after loading plist

Check that paths in the plist are correct:
```bash
cat ~/Library/LaunchAgents/com.assistant.daemon.plist
```

Verify `__PROJECT_DIR__` and `__HOME_DIR__` were replaced with actual paths. Check logs:
```bash
tail -f logs/daemon-stderr.log
```

### "Module not found" errors in daemon logs

The daemon wasn't built, or the build is stale:
```bash
cd daemon && npm run build && cd ..
```

### Telegram messages arrive but responses aren't sent back

The transcript stream may not be finding the JSONL file. Check that:
1. Your `tmux.session` in config matches the actual tmux session name
2. Claude Code is running in that session
3. The daemon can read the JSONL transcript (check logs for path)

### Old v1 jobs still running alongside daemon

Check for leftover launchd jobs:
```bash
launchctl list | grep -E "assistant|gateway|watcher|reminder|watchdog"
```

Unload any that shouldn't be there (see Step 6 above).

### Config changes not taking effect

The daemon reads config at startup. After editing `cc4me.config.yaml`:
```bash
launchctl unload ~/Library/LaunchAgents/com.assistant.daemon.plist
launchctl load ~/Library/LaunchAgents/com.assistant.daemon.plist
```

### Port 3847 already in use

Another process (possibly v1's gateway) is using the port:
```bash
lsof -i :3847
```

Kill it or change the port in your config.

---

Questions? Open an issue or ask your assistant — it can help debug its own infrastructure.
