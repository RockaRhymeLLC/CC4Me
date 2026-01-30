# CC4Me - Claude Code for Me

**Autonomous Personal Assistant + Spec-Driven Development Workflow**

CC4Me is a configuration template for [Claude Code](https://github.com/anthropics/claude-code) that transforms it into a persistent, autonomous personal assistant. It runs in a tmux session, communicates via Telegram and email, remembers your preferences, manages your tasks, and builds software systematically.

Clone this repo, run setup, and you have an AI assistant that survives terminal closes, wakes on messages, and works independently.

## Features

### Personal Assistant
- **Persistent sessions** - Runs in tmux, survives terminal closes, auto-restarts
- **Telegram bot** - Chat with your assistant from your phone
- **Email integration** - Send and read email via Fastmail (JMAP) or Microsoft 365 (Graph API)
- **Memory** - Remembers facts about you across sessions
- **To-do management** - Tracks tasks with priorities, status, and audit history
- **Calendar awareness** - Knows your schedule and reminds you
- **Autonomy modes** - Configure how much freedom the assistant has
- **Secure storage** - All credentials in macOS Keychain, never plain text
- **Scheduled jobs** - Automatic inbox checks, todo reminders, context monitoring
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

### Message Flow (Telegram)

```
You (phone) --> Telegram --> Cloudflare Tunnel --> gateway.js
                                                      |
                                                      v
                                              tmux session (Claude Code)
                                                      |
                                                      v
                                            transcript-watcher.sh
                                                      |
                                                      v
                                            telegram-send.sh --> Telegram --> You
```

The gateway receives webhooks from Telegram, downloads any photos or documents, and injects formatted messages into the Claude Code tmux session. The transcript watcher monitors Claude's output and sends responses back to Telegram.

If no session exists when a message arrives, the gateway automatically starts one (wake-on-message).

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

### Development Workflow Skills

| Skill | Description | Example |
|-------|-------------|---------|
| `/spec` | Create feature specification | `/spec login-feature` |
| `/plan` | Create implementation plan | `/plan specs/20260128-login.spec.md` |
| `/validate` | Run validation checks | `/validate` |
| `/build` | Implement test-first | `/build plans/20260128-login.plan.md` |

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

Full bidirectional Telegram integration with media support.

**Setup:**
1. Create a bot via [@BotFather](https://t.me/botfather) - get a bot token
2. Store the token: `security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "YOUR_TOKEN" -U`
3. Get your chat ID (message the bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
4. Add your chat ID to `.claude/state/safe-senders.json`
5. Set up a Cloudflare tunnel for webhooks:
   ```bash
   cd scripts/telegram-setup
   npm install
   node setup.js
   ```

**Features:** Text messages, photos, documents, typing indicators, wake-on-message, safe sender enforcement.

See `.claude/knowledge/integrations/telegram.md` for architecture details.

### Email

Two provider options with identical CLI interface.

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

Run the assistant and supporting services as macOS background jobs:

```bash
# Copy templates
cp launchd/com.assistant.harness.plist.template ~/Library/LaunchAgents/com.assistant.harness.plist

# Edit paths (replace YOUR_USERNAME)
# Then load:
launchctl load ~/Library/LaunchAgents/com.assistant.harness.plist
```

Additional launchd templates are available for:
- Telegram gateway
- Email reminders
- Todo reminders
- Context monitoring

See `launchd/README.md` for all templates and configuration.

## Project Structure

```
CC4Me/
├── .claude/
│   ├── CLAUDE.md                    # Assistant behavior instructions
│   ├── settings.json                # Claude Code hooks config
│   ├── skills/
│   │   ├── spec/                    # Development workflow
│   │   ├── plan/
│   │   ├── validate/
│   │   ├── build/
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
│   │   └── upstream/                # Upstream contribution workflow
│   ├── hooks/
│   │   ├── session-start.sh         # Loads state and todos on boot
│   │   ├── set-channel.sh           # Routes notifications
│   │   └── pre-compact.sh           # Saves state before context clear
│   ├── state/                       # Persistent state (gitignored)
│   │   ├── todos/                   # Individual to-do files
│   │   ├── memory.md                # Stored facts
│   │   ├── calendar.md              # Schedule
│   │   ├── autonomy.json            # Current mode
│   │   ├── identity.json            # Assistant name/personality
│   │   ├── safe-senders.json        # Trusted contacts
│   │   ├── system-prompt.txt        # Loaded at startup
│   │   ├── channel.txt              # Current notification channel
│   │   └── assistant-state.md       # Saved work context
│   └── knowledge/
│       └── integrations/
│           ├── telegram.md           # Telegram architecture guide
│           ├── fastmail.md           # Fastmail JMAP setup
│           ├── microsoft-graph.md    # Azure/Graph API setup
│           └── keychain.md           # Credential storage guide
├── scripts/
│   ├── start.sh                     # Start Claude Code with system prompt
│   ├── start-tmux.sh                # Launch in detached tmux session
│   ├── attach.sh                    # Reattach to tmux session
│   ├── restart.sh                   # Graceful restart
│   ├── restart-watcher.sh           # Watch for restart triggers
│   ├── transcript-watcher.sh        # Send responses to Telegram
│   ├── telegram-send.sh             # CLI: send to Telegram
│   ├── email-reminder.sh            # Scheduled inbox check
│   ├── todo-reminder.sh             # Scheduled todo check
│   ├── context-watchdog.sh          # Monitor context usage
│   ├── context-monitor-statusline.sh # Parse Claude status output
│   ├── email/
│   │   ├── jmap.js                  # Fastmail client
│   │   └── graph.js                 # Microsoft Graph client
│   └── telegram-setup/
│       ├── gateway.js               # Telegram webhook receiver
│       ├── setup.js                 # Interactive bot setup
│       ├── cloudflare-setup.js      # Domain setup via Cloudflare
│       ├── start-tunnel.sh          # Start cloudflared tunnel
│       ├── package.json             # Gateway dependencies
│       └── ...                      # Other setup utilities
├── templates/                       # Spec/plan templates
├── specs/                           # Your specifications
├── plans/                           # Your plans
├── launchd/                         # Service templates
│   ├── README.md                    # launchd setup guide
│   ├── com.assistant.harness.plist.template
│   ├── com.assistant.gateway.plist.template
│   ├── com.assistant.email-reminder.plist.template
│   ├── com.assistant.todo-reminder.plist.template
│   └── com.assistant.context-watchdog.plist.template
└── logs/                            # Runtime logs (gitignored)
```

## Security

### Credential Storage

All credentials are stored in macOS Keychain, never in plain text:
- `credential-*` - API keys, tokens, passwords
- `pii-*` - Personal identifiable information
- `financial-*` - Payment/banking data

### Safe Senders

The assistant only processes requests from contacts listed in `safe-senders.json`. Messages from unknown Telegram users or email addresses are acknowledged but not acted upon.

### Secure Data Gate

**Absolute rule**: The assistant will never share Keychain-stored data with anyone not in the safe senders list. No exceptions.

## Troubleshooting

### tmux session won't start
- Verify tmux is installed: `which tmux`
- Check if a session already exists: `tmux ls`
- Try manual start: `tmux new-session -d -s assistant`

### Telegram messages not arriving
- Check gateway is running: `curl http://localhost:3847/health`
- Verify tunnel is active: `cloudflared tunnel list`
- Check bot token: `security find-generic-password -s "credential-telegram-bot" -w`
- Review gateway logs in `logs/`

### Email sending fails
- Verify credentials: `security find-generic-password -s "credential-fastmail-token" -w`
- For M365: check Azure app permissions in portal.azure.com
- Test manually: `node scripts/email/jmap.js inbox`

### SessionStart hook not running
- Check `.claude/settings.json` has hooks configured
- Verify hook scripts are executable: `chmod +x .claude/hooks/*.sh`

### Context getting full
- The context watchdog auto-saves when approaching limits
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

**Get started**: Clone, run `./scripts/init.sh`, then `./scripts/start.sh` and `/setup`.
