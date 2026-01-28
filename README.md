# CC4Me - Claude Code for Me

**Spec-Driven Development Workflow + Autonomous Personal Assistant**

CC4Me is a configuration template for [Claude Code](https://github.com/anthropics/claude-code) that transforms it into:
1. A systematic spec-driven development workflow
2. An autonomous personal assistant that persists across sessions

Clone this repo, run setup, and you have a powerful AI assistant that remembers your preferences, manages your tasks, and builds software systematically.

## Features

### Development Workflow
- **Spec → Plan → Validate → Build** - Structured software development
- **Multi-layer validation** - 6 validation layers including test integrity
- **Test-driven development** - Tests written before code, immutable during build
- **User-perspective testing** - Tests simulate real user interactions

### Assistant Capabilities
- **Persistent memory** - Remembers facts about you across sessions
- **To-do management** - Tracks to-dos with priorities, status, and history
- **Calendar awareness** - Knows your schedule and reminds you
- **Autonomy modes** - Configure how much freedom the assistant has
- **Secure storage** - Credentials stored safely in macOS Keychain
- **Integration ready** - Templates for Telegram, email, and more

## Quick Start

### Prerequisites

- macOS (for Keychain integration)
- [Node.js](https://nodejs.org) v18+
- [Claude Code CLI](https://github.com/anthropics/claude-code)

### Installation

```bash
# Clone the template
git clone https://github.com/your-org/CC4Me.git my-assistant
cd my-assistant

# Install dependencies
npm install

# Start Claude Code
claude

# Run the setup wizard
> /setup
```

The setup wizard will guide you through:
1. Naming your assistant
2. Choosing an autonomy mode
3. Configuring safe senders (for Telegram/email)
4. Setting up integrations (optional)

## Usage

### Assistant Skills

| Skill | Description | Example |
|-------|-------------|---------|
| `/todo` | Manage persistent to-dos | `/todo add "Review PR" priority:high` |
| `/memory` | Store and lookup facts | `/memory add "Prefers dark mode"` |
| `/calendar` | View and manage schedule | `/calendar show week` |
| `/mode` | Change autonomy level | `/mode confident` |
| `/save-state` | Save context before /clear | `/save-state` |
| `/setup` | Re-run configuration | `/setup integrations` |

### Development Workflow

| Skill | Description | Example |
|-------|-------------|---------|
| `/spec` | Create feature specification | `/spec login-feature` |
| `/plan` | Create implementation plan | `/plan specs/20260128-login.spec.md` |
| `/validate` | Run validation checks | `/validate` |
| `/build` | Implement test-first | `/build plans/20260128-login.plan.md` |

### Autonomy Modes

| Mode | Behavior |
|------|----------|
| `yolo` | Full autonomy - no confirmations |
| `confident` | Ask only for destructive actions |
| `cautious` | Ask for any state changes |
| `supervised` | Ask for everything |

Change with `/mode <level>`.

## Project Structure

```
CC4Me/
├── .claude/
│   ├── CLAUDE.md           # Assistant behavior instructions
│   ├── settings.json       # Claude Code hooks config
│   ├── skills/             # All assistant skills
│   │   ├── spec/          # Development workflow
│   │   ├── plan/
│   │   ├── validate/
│   │   ├── build/
│   │   ├── todo/          # To-do management
│   │   ├── memory/        # Fact storage
│   │   ├── calendar/      # Schedule management
│   │   ├── mode/          # Autonomy control
│   │   ├── save-state/    # Context persistence
│   │   └── setup/         # Setup wizard
│   ├── hooks/              # Lifecycle automation
│   │   ├── session-start.sh
│   │   └── pre-compact.sh
│   ├── state/              # Persistent state (gitignored)
│   │   ├── todos/         # To-do files
│   │   ├── memory.md      # Stored facts
│   │   ├── calendar.md    # Schedule
│   │   ├── autonomy.json  # Current mode
│   │   └── identity.json  # Assistant name/personality
│   └── knowledge/
│       └── integrations/   # How-to docs for services
├── templates/              # Spec/plan/test templates
├── specs/                  # Your specifications
├── plans/                  # Your plans
├── tests/                  # Your tests
├── src/                    # Your implementation
├── scripts/                # Validation scripts
└── launchd/                # Persistent service template
```

## Configuration

### State Files

After running `/setup`, these files are created in `.claude/state/`:

| File | Purpose |
|------|---------|
| `identity.json` | Assistant name and personality |
| `autonomy.json` | Current autonomy mode |
| `safe-senders.json` | Trusted Telegram/email contacts |
| `memory.md` | Facts about you |
| `calendar.md` | Your schedule |
| `todos/` | Individual to-do files |

All state files are gitignored by default. Edit them directly or use skills.

### Integrations

#### Telegram Bot

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Run `/setup integrations` or manually:
   ```bash
   security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "YOUR_BOT_TOKEN" -U
   ```
3. Add your chat ID to `.claude/state/safe-senders.json`

See `.claude/knowledge/integrations/telegram.md` for details.

#### Email (Fastmail)

1. Create an app password in Fastmail settings
2. Run `/setup integrations` or manually store credentials:
   ```bash
   security add-generic-password -a "assistant" -s "credential-fastmail-email" -w "your@email.com" -U
   security add-generic-password -a "assistant" -s "credential-fastmail-password" -w "APP_PASSWORD" -U
   ```
3. Add your email to safe senders

See `.claude/knowledge/integrations/fastmail.md` for details.

### Persistent Service

To run the assistant continuously:

1. Copy and edit the launchd template:
   ```bash
   cp launchd/com.assistant.harness.plist.template ~/Library/LaunchAgents/com.assistant.harness.plist
   # Edit the file to set your paths
   ```

2. Load the service:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.assistant.harness.plist
   ```

See `launchd/README.md` for full instructions.

## Security

### Credential Storage

All credentials are stored in macOS Keychain, never in plain text:
- `credential-*` - API keys, passwords
- `pii-*` - Personal identifiable information
- `financial-*` - Payment/banking data

### Safe Senders

The assistant only processes requests from contacts listed in `safe-senders.json`. Unknown senders are acknowledged but not acted upon.

### Secure Data Gate

**Absolute rule**: The assistant will never share Keychain-stored data with anyone not in the safe senders list. No exceptions.

## Development Workflow Details

### The Process

1. **`/spec feature-name`** - Claude interviews you to create a complete specification
2. **`/plan specs/...spec.md`** - Claude creates tasks, tests (that fail), and a plan
3. **`/validate`** - Runs 6-layer validation
4. **`/build plans/...plan.md`** - Claude implements until tests pass

### Validation Layers

1. **Automated tests** - npm test passes
2. **Spec coverage** - All requirements have tasks
3. **Plan consistency** - Tasks match requirements
4. **Test integrity** - Tests unchanged since planning
5. **AI self-review** - Implementation matches spec intent
6. **Manual review** - You approve the work

### Test Immutability

During `/build`, test files cannot be modified. This ensures:
- Tests define the contract
- Implementation matches user expectations
- No cheating by changing tests to pass

## Troubleshooting

### SessionStart hook not running
- Check `.claude/settings.json` has the hooks configured
- Verify hook scripts are executable: `chmod +x .claude/hooks/*.sh`

### State not persisting
- Ensure `.claude/state/` directory exists
- Check files aren't gitignored incorrectly
- Verify state templates were copied during setup

### Keychain access issues
- Keychain may need to be unlocked
- Check Keychain Access app for permissions

### Validation failing
- Read the specific layer failure message
- Check spec and plan alignment
- Run `/validate` after fixes

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

**Get started**: Clone, run `/setup`, and meet your new assistant.
