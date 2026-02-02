# CC4Me - Claude Code for Me

**Autonomous Personal Assistant + Spec-Driven Development Workflow**

CC4Me is a configuration template for [Claude Code](https://github.com/anthropics/claude-code) that transforms it into a persistent, autonomous personal assistant. It runs in a tmux session, communicates via Telegram and email, remembers your preferences, manages your tasks, and builds software systematically.

Clone this repo, run setup, and you have an AI assistant that survives terminal closes, wakes on messages, and works independently.

## Features

### Personal Assistant
- **Persistent sessions** - Runs in tmux, survives terminal closes, auto-restarts
- **Telegram bot** - Chat with your assistant from your phone
- **Email integration** - Send and read email via Fastmail (JMAP) or Microsoft 365 (Graph API)
- **Memory system** - Remembers facts across sessions with auto-consolidation and briefings
- **To-do management** - Tracks tasks with priorities, status, and audit history
- **Calendar awareness** - Knows your schedule and reminds you
- **Autonomy modes** - Configure how much freedom the assistant has
- **Secure storage** - All credentials in macOS Keychain, never plain text
- **3rd party access control** - Approved external contacts with capability boundaries and private info gates
- **Rate limiting** - Configurable limits on incoming and outgoing messages
- **Scheduled automation** - Context monitoring, inbox checks, todo reminders, memory consolidation, health checks
- **Wake-on-message** - Auto-starts session when you send a Telegram message

### Development Workflow
- **Spec > Plan > Validate > Build** - Structured software development
- **Multi-layer validation** - 6 validation layers including test integrity
- **Test-driven development** - Tests written before code, immutable during build
- **User-perspective testing** - Tests simulate real user interactions

## Quick Start

### Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| macOS (Ventura 13+) | Yes | - |
| Node.js v18+ | Yes | `brew install node` |
| Claude Code CLI | Yes | `npm install -g @anthropic-ai/claude-code` |
| Claude Pro or Max subscription | Yes | [claude.ai](https://claude.ai) |
| tmux | Yes | `brew install tmux` |
| jq | Yes | `brew install jq` |
| Git | Yes | `brew install git` |
| Cloudflared (for Telegram) | Optional | `brew install cloudflare/cloudflare/cloudflared` |

**Note:** Claude Code authenticates through your Claude subscription directly. No API key is needed.

### Installation

```bash
# Clone the template
git clone https://github.com/RockaRhyme/CC4Me.git my-assistant
cd my-assistant

# Run initialization (checks prerequisites, makes scripts executable)
./scripts/init.sh

# Build the daemon
cd daemon && npm install && npm run build && cd ..

# Start Claude Code with system prompt
./scripts/start.sh

# Run the setup wizard
> /setup
```

The setup wizard walks you through:
1. Naming your assistant and setting its personality
2. Choosing an autonomy mode
3. Configuring safe senders (who the assistant trusts)
4. Setting up integrations (Telegram, email)

### Start a Persistent Session

After setup, run the assistant in a detached tmux session:

```bash
# Start detached (runs in background)
./scripts/start-tmux.sh --detach

# Reattach to see what it's doing
./scripts/attach.sh
```

## Architecture

CC4Me v2 uses a **single Node.js daemon** that replaces the multiple shell scripts and individual launchd jobs from v1. Everything runs through one process managed by a single launchd plist.

### Module Overview

```
cc4me.config.yaml                  # Single config file for all behavior
daemon/src/
  core/
    main.ts                        # Daemon entry point
    config.ts                      # YAML config loader
    session-bridge.ts              # Tmux interaction (busy check, inject, capture)
    keychain.ts                    # macOS Keychain credential access
    health.ts                      # HTTP health/status endpoints
    access-control.ts              # 3rd party sender verification
    logger.ts                      # Structured logging with rotation
  comms/
    transcript-stream.ts           # Watches JSONL transcript via fs.watch
    channel-router.ts              # Routes outgoing messages to active channel
    adapters/
      telegram.ts                  # Telegram webhook receiver + sender
      email/
        index.ts                   # Email adapter factory
        jmap-provider.ts           # Fastmail provider
        graph-provider.ts          # Microsoft 365 provider
  automation/
    scheduler.ts                   # Cron + interval task runner with busy checks
    tasks/
      context-watchdog.ts          # Save state when context < threshold
      todo-reminder.ts             # Prompt to work on open todos
      email-check.ts               # Poll for unread emails
      nightly-todo.ts              # Self-assigned creative todo
      health-check.ts              # System health check
      memory-consolidation.ts      # Generate briefings, write summaries, apply decay
      approval-audit.ts            # Audit 3rd party approvals
```

### Message Flow (Telegram)

```
You (phone) --> Telegram --> Cloudflare Tunnel --> daemon (port 3847)
                                                       |
                                          session-bridge.ts (inject)
                                                       |
                                                       v
                                              tmux session (Claude Code)
                                                       |
                                          transcript-stream.ts (watch)
                                                       |
                                          channel-router.ts (route)
                                                       |
                                                       v
                                          telegram adapter --> Telegram --> You
```

The daemon receives webhooks from Telegram, downloads any photos or documents, and injects formatted messages into the Claude Code tmux session via the session bridge. The transcript stream monitors Claude's JSONL output and the channel router sends responses back through the appropriate adapter.

If no session exists when a message arrives, the daemon automatically starts one (wake-on-message).

### Configuration

All daemon behavior is controlled by `cc4me.config.yaml` in the project root. Copy from `cc4me.config.yaml.template` and customize:

```yaml
agent:
  name: "Assistant"            # Your assistant's name

tmux:
  session: "assistant"         # tmux session name

daemon:
  port: 3847                   # HTTP port for webhooks and health checks
  log_level: "info"            # debug | info | warn | error

channels:
  telegram:
    enabled: false             # Enable Telegram integration
    webhook_path: "/telegram"
  email:
    enabled: false
    providers: []              # "graph" for M365, "jmap" for Fastmail

scheduler:
  tasks:                       # Each task has name, enabled, interval/cron
    - name: "context-watchdog"
      enabled: true
      interval: "3m"
    # ... see template for all tasks

security:
  safe_senders_file: ".claude/state/safe-senders.json"
  third_party_senders_file: ".claude/state/3rd-party-senders.json"
  rate_limits:
    incoming_max_per_minute: 5
    outgoing_max_per_minute: 10
```

After changing config, restart the daemon for changes to take effect.

### Daemon Management

```bash
# Start the daemon (via launchd — auto-restarts on crash)
launchctl load ~/Library/LaunchAgents/com.assistant.daemon.plist

# Stop the daemon
launchctl unload ~/Library/LaunchAgents/com.assistant.daemon.plist

# Health check
curl http://localhost:3847/health

# Full status
curl http://localhost:3847/status
```

### Scheduled Tasks

The daemon's built-in scheduler replaces individual launchd jobs. All tasks are configured in `cc4me.config.yaml`:

| Task | Schedule | Purpose |
|------|----------|---------|
| `context-watchdog` | Every 3m | Save state + clear when context < 35% remaining |
| `todo-reminder` | Every 30m | Prompt to work on open todos |
| `email-check` | Every 15m | Check for unread emails |
| `nightly-todo` | 10pm daily | Self-assigned creative todo |
| `health-check` | Mon 8am | System health check |
| `memory-consolidation` | 11pm daily | Generate briefing, write summaries, apply decay |
| `approval-audit` | 1st of month, every 6 months | Audit 3rd party approvals |

## Skills

### Assistant Skills

| Skill | Description | Example |
|-------|-------------|---------|
| `/todo` | Manage persistent to-dos | `/todo add "Review PR" priority:high` |
| `/memory` | Store and lookup facts | `/memory add "Prefers dark mode"` |
| `/calendar` | View and manage schedule | `/calendar show week` |
| `/mode` | Change autonomy level | `/mode confident` |
| `/save-state` | Save context before /clear | `/save-state` |
| `/setup` | Run configuration wizard | `/setup integrations` |
| `/email` | Send and read email | `/email check` |
| `/telegram` | Telegram integration reference | `/telegram` |
| `/restart` | Graceful session restart | `/restart` |
| `/hooks` | Manage Claude Code hooks | `/hooks` |
| `/skill-create` | Create new skills | `/skill-create my-skill` |
| `/remind` | Set timed reminders | `/remind "Call dentist" at 3pm` |

### Development Workflow Skills

| Skill | Description | Example |
|-------|-------------|---------|
| `/spec` | Create feature specification | `/spec login-feature` |
| `/plan` | Create implementation plan | `/plan specs/20260128-login.spec.md` |
| `/validate` | Run validation checks | `/validate` |
| `/build` | Implement test-first | `/build plans/20260128-login.plan.md` |
| `/upstream` | Contribute changes upstream | `/upstream` |

### Autonomy Modes

| Mode | Autonomous Actions | Asks Permission For |
|------|-------------------|-------------------|
| `yolo` | Everything | Nothing (truly ambiguous only) |
| `confident` | Reads, writes, edits, git commits | Git push, deletes, external APIs |
| `cautious` | Reads, searches | Any write, edit, git, external call |
| `supervised` | Basic reads only | Almost everything |

Change with `/mode <level>`.

## Integrations

### Telegram Bot

Full bidirectional Telegram integration with media support. The daemon handles both incoming webhooks and outgoing messages.

**Setup:**
1. Create a bot via [@BotFather](https://t.me/botfather) - get a bot token
2. Store the token: `security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "YOUR_TOKEN" -U`
3. Get your chat ID (message the bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
4. Store the chat ID: `security add-generic-password -a "assistant" -s "credential-telegram-chat-id" -w "YOUR_CHAT_ID" -U`
5. Add your chat ID to `.claude/state/safe-senders.json`
6. Set up a Cloudflare tunnel for webhooks:
   ```bash
   cd scripts/telegram-setup
   npm install
   node setup.js
   ```

**Features:** Text messages, photos, documents, typing indicators, wake-on-message, safe sender enforcement, 3rd party access control.

See `.claude/knowledge/integrations/telegram.md` for architecture details.

### Email

Two provider options with identical interface, handled by the daemon's email adapters.

**Option A: Fastmail (simplest)**
```bash
security add-generic-password -a "assistant" -s "credential-fastmail-email" -w "you@fastmail.com" -U
security add-generic-password -a "assistant" -s "credential-fastmail-token" -w "API_TOKEN" -U
```

**Option B: Microsoft 365 (custom domain)**
```bash
security add-generic-password -a "assistant" -s "credential-azure-client-id" -w "CLIENT_ID" -U
security add-generic-password -a "assistant" -s "credential-azure-tenant-id" -w "TENANT_ID" -U
security add-generic-password -a "assistant" -s "credential-azure-secret-value" -w "SECRET" -U
security add-generic-password -a "assistant" -s "credential-graph-user-email" -w "you@domain.com" -U
```

See `.claude/knowledge/integrations/fastmail.md` and `.claude/knowledge/integrations/microsoft-graph.md` for full setup guides.

### Persistent Service (launchd)

The daemon runs as a single macOS background service:

```bash
# Copy the template
cp launchd/com.assistant.daemon.plist.template ~/Library/LaunchAgents/com.assistant.daemon.plist

# Edit paths (replace __PROJECT_DIR__ and __HOME_DIR__)
# Then load:
launchctl load ~/Library/LaunchAgents/com.assistant.daemon.plist
```

The daemon plist uses `KeepAlive: true` so macOS will automatically restart it if it crashes.

## Security

### Credential Storage

All credentials are stored in macOS Keychain, never in plain text:
- `credential-*` - API keys, tokens, passwords
- `pii-*` - Personal identifiable information
- `financial-*` - Payment/banking data

### Safe Senders

The assistant only processes requests from contacts listed in `safe-senders.json`. Messages from unknown Telegram users or email addresses are acknowledged but not acted upon.

### 3rd Party Access Control

Approved external contacts are tracked in `3rd-party-senders.json` with limited capabilities:

**3rd parties CAN:**
- Ask for general help (tech support, drafting, brainstorming)
- Get help with CC4Me setup
- Trigger to-do creation for later review

**3rd parties CANNOT:**
- Access the primary human's private information
- Modify config, skills, or core state
- Access Keychain-stored data
- Change autonomy or security settings

### Private Info Gate

When a 3rd party asks about the primary human's calendar, schedule, or personal details, the assistant:
1. Tells the 3rd party it will check with the primary
2. Asks the primary for approval via Telegram
3. Only shares if explicitly approved

### Secure Data Gate

**Absolute rule**: The assistant will never share Keychain-stored data with anyone. No exceptions.

### Rate Limiting

Configurable limits on incoming and outgoing message rates to prevent abuse. Set in `cc4me.config.yaml` under `security.rate_limits`.

## Project Structure

```
CC4Me/
├── .claude/
│   ├── CLAUDE.md                    # Assistant behavior instructions
│   ├── settings.json                # Claude Code hooks config
│   ├── skills/                      # Skill definitions
│   │   ├── todo/                    # To-do management
│   │   ├── memory/                  # Fact storage
│   │   ├── calendar/                # Schedule management
│   │   ├── mode/                    # Autonomy control
│   │   ├── save-state/              # Context persistence
│   │   ├── setup/                   # Setup wizard
│   │   ├── email/                   # Email integration
│   │   ├── telegram/                # Telegram integration
│   │   ├── restart/                 # Session restart
│   │   ├── hooks/                   # Hook management
│   │   ├── skill-create/            # Skill creation
│   │   ├── remind/                  # Timed reminders
│   │   ├── upstream/                # Upstream contribution
│   │   ├── spec/                    # Development workflow
│   │   ├── plan/
│   │   ├── validate/
│   │   └── build/
│   ├── hooks/
│   │   ├── session-start.sh         # Loads state and todos on boot
│   │   ├── set-channel.sh           # Routes notifications
│   │   └── pre-compact.sh           # Saves state before context clear
│   ├── state/                       # Persistent state (gitignored)
│   │   ├── todos/                   # Individual to-do files
│   │   ├── memory/                  # Memory system (briefings, summaries)
│   │   │   ├── briefing.md          # Auto-generated session briefing
│   │   │   ├── memories/            # Individual memory files
│   │   │   └── summaries/           # Daily/weekly/monthly summaries
│   │   ├── calendar.md              # Schedule
│   │   ├── autonomy.json            # Current mode
│   │   ├── identity.json            # Assistant name/personality
│   │   ├── safe-senders.json        # Trusted contacts
│   │   ├── 3rd-party-senders.json   # Approved external contacts
│   │   ├── system-prompt.txt        # Loaded at startup
│   │   ├── channel.txt              # Current notification channel
│   │   └── assistant-state.md       # Saved work context
│   └── knowledge/
│       ├── integrations/
│       │   ├── telegram.md           # Telegram architecture guide
│       │   ├── fastmail.md           # Fastmail JMAP setup
│       │   ├── microsoft-graph.md    # Azure/Graph API setup
│       │   └── keychain.md           # Credential storage guide
│       └── macos/
│           └── automation.md         # launchd and system automation
├── daemon/                          # v2 Node.js daemon
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── core/                    # Config, session bridge, logging, keychain, health
│   │   ├── comms/                   # Transcript stream, channel router, adapters
│   │   └── automation/              # Scheduler + task modules
│   └── dist/                        # Compiled JavaScript (generated)
├── scripts/
│   ├── start.sh                     # Start Claude Code with system prompt
│   ├── start-tmux.sh                # Launch in detached tmux session
│   ├── attach.sh                    # Reattach to tmux session
│   ├── restart.sh                   # Graceful restart
│   ├── init.sh                      # Project initialization
│   ├── telegram-send.sh             # Manual Telegram send (silent mode)
│   └── telegram-setup/              # Telegram webhook setup tools
├── cc4me.config.yaml                # Your config (copy from template)
├── cc4me.config.yaml.template       # Default config template
├── launchd/
│   ├── com.assistant.daemon.plist.template  # Daemon launchd template
│   └── README.md                    # launchd setup guide
├── templates/                       # Spec/plan templates
├── specs/                           # Your specifications
├── plans/                           # Your plans
└── logs/                            # Runtime logs (gitignored)
```

## Troubleshooting

### Daemon won't start
- Verify Node.js 18+: `node --version`
- Check daemon is built: `ls daemon/dist/core/main.js`
- If missing, build it: `cd daemon && npm install && npm run build`
- Check plist paths are correct: `cat ~/Library/LaunchAgents/com.assistant.daemon.plist`
- Check logs: `tail -f logs/daemon-stderr.log`

### tmux session won't start
- Verify tmux is installed: `which tmux`
- Check if a session already exists: `tmux ls`
- Try manual start: `tmux new-session -d -s assistant`

### Telegram messages not arriving
- Check daemon is running: `curl http://localhost:3847/health`
- Verify tunnel is active: `cloudflared tunnel list`
- Check bot token: `security find-generic-password -s "credential-telegram-bot" -w`
- Review daemon logs: `tail -f logs/daemon-stderr.log`

### Email sending fails
- Verify credentials: `security find-generic-password -s "credential-fastmail-token" -w`
- For M365: check Azure app permissions in portal.azure.com
- Check daemon status: `curl http://localhost:3847/status`

### SessionStart hook not running
- Check `.claude/settings.json` has hooks configured
- Verify hook scripts are executable: `chmod +x .claude/hooks/*.sh`

### Context getting full
- The context watchdog task auto-saves when approaching limits
- Manual save: `/save-state`
- Then: `/clear` to start fresh (state restores on next session start)

### Keychain access issues
- Keychain may need to be unlocked after restart
- Check permissions in Keychain Access app
- Re-store credentials if needed

## Contributing

This project uses its own workflow for development:

1. `/spec my-enhancement` - Specify what you want to add
2. `/plan specs/...` - Plan the implementation
3. `/build plans/...` - Build it test-first
4. Submit a PR

## License

MIT License - see LICENSE file for details.

## Acknowledgments

Built with [Claude Code](https://github.com/anthropics/claude-code) by Anthropic.

---

**Get started**: Clone, run `./scripts/init.sh`, build the daemon (`cd daemon && npm install && npm run build`), then `./scripts/start.sh` and `/setup`.

Upgrading from v1? See [UPGRADE.md](UPGRADE.md).
