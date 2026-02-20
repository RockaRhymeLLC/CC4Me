# CC4Me - Claude Code for Me

**Autonomous Personal Assistant + Spec-Driven Development Workflow**

CC4Me is a configuration template for [Claude Code](https://github.com/anthropics/claude-code) that transforms it into a persistent, autonomous personal assistant. It runs in a tmux session, communicates via Telegram and email, remembers your preferences, manages your tasks, and builds software systematically.

Clone this repo, run setup, and you have an AI assistant that survives terminal closes, wakes on messages, and works independently.

## Features

### Personal Assistant
- **Persistent sessions** - Runs in tmux, survives terminal closes, auto-restarts
- **Telegram bot** - Chat with your assistant from your phone
- **Email integration** - Send and read email via Fastmail (JMAP) or Microsoft 365 (Graph API)
- **Memory system** - Remembers facts across sessions with auto-consolidation
- **To-do management** - Tracks tasks with priorities, status, and audit history
- **Calendar awareness** - Knows your schedule and reminds you
- **Autonomy modes** - Configure how much freedom the assistant has (yolo / confident / cautious / supervised)
- **Secure storage** - All credentials in macOS Keychain, never plain text
- **3rd party access control** - Approved external contacts with capability boundaries
- **Scheduled automation** - Context monitoring, inbox checks, todo reminders, memory consolidation

### Development Workflow
- **Spec > Plan > Review > Build** - Structured software development with test-driven implementation
- **Bob** - Devil's advocate sub-agent that reviews designs before you build
- **Peer review** - Multi-agent review for shared work
- **Multi-layer validation** - 7 validation layers including doc freshness

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

# If using CC4Me Network (P2P agent messaging), build the SDK first
# Skip this if you don't have cc4me-network cloned
cd ../cc4me-network/packages/sdk && npm run build && cd -

# Build the daemon
cd daemon && npm install && npm run build && cd ..

# Copy and customize config
cp cc4me.config.yaml.template cc4me.config.yaml

# Start Claude Code with system prompt
./scripts/start.sh

# Run the setup wizard (inside Claude Code)
> /setup
```

The setup wizard walks you through naming your assistant, choosing an autonomy mode, configuring safe senders, and setting up integrations (Telegram, email).

### Start a Persistent Session

```bash
# Start detached (runs in background)
./scripts/start-tmux.sh --detach

# Reattach to see what it's doing
./scripts/attach.sh
```

For detailed setup instructions including Telegram bot creation, email provider configuration, and daemon management, run `/setup` inside Claude Code — it's the canonical setup guide.

## How It Works

CC4Me runs a **Node.js daemon** alongside Claude Code. The daemon handles Telegram webhooks, email polling, scheduled tasks (context watchdog, todo reminders, memory consolidation), and routes messages between you and the assistant via a tmux session bridge.

All behavior is configured in `cc4me.config.yaml`. All assistant knowledge lives in `.claude/CLAUDE.md` and `.claude/skills/`.

## Security

- All credentials stored in macOS Keychain (never plain text)
- Safe sender enforcement on all incoming messages
- 3rd party contacts get limited capabilities with private info gates
- Rate limiting on incoming and outgoing messages

## Contributing

This project uses its own workflow for development:

1. `/spec my-enhancement` - Specify what you want to add
2. `/plan specs/...` - Plan the implementation
3. `/review` - Bob reviews it before you build
4. `/build plans/...` - Build it test-first
5. Submit a PR

## License

MIT License - see LICENSE file for details.

## Acknowledgments

Built with [Claude Code](https://github.com/anthropics/claude-code) by Anthropic.

---

**Get started**: Clone, run `./scripts/init.sh`, build the daemon (`cd daemon && npm install && npm run build`), then `./scripts/start.sh` and `/setup`.

Upgrading from v1? See [UPGRADE.md](UPGRADE.md).
