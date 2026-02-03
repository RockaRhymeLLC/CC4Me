# CC4Me Setup Guide

Complete setup instructions for CC4Me - your autonomous personal assistant powered by Claude Code.

## Prerequisites

### Required

1. **macOS** (Ventura 13+ recommended)

2. **Homebrew** (package manager)
   - Install: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

3. **Node.js** (v18 or higher)
   - Install: `brew install node`
   - Verify: `node --version`

4. **Claude Code CLI**
   - Install: `npm install -g @anthropic-ai/claude-code`
   - Verify: `claude --version`

5. **Claude Pro or Max subscription**
   - Subscribe at [claude.ai](https://claude.ai)
   - Claude Code authenticates directly through the subscription (no API key needed)
   - Max plan ($100/month) recommended for heavy usage; Pro ($20/month) works with lower limits

6. **tmux** (terminal multiplexer)
   - Install: `brew install tmux`
   - Verify: `tmux -V`

7. **jq** (JSON processor)
   - Install: `brew install jq`
   - Verify: `jq --version`

8. **Git**
   - Install: `brew install git`
   - Verify: `git --version`

### Optional (for integrations)

9. **cloudflared** (for Telegram webhooks)
   - Install: `brew install cloudflare/cloudflare/cloudflared`
   - Only needed if you want Telegram bot integration

10. **A domain name** (for Telegram webhooks)
    - Any registrar works; Cloudflare recommended for tunnel integration
    - Alternative: use Cloudflare's free tunnel subdomain

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/RockaRhyme/CC4Me.git my-assistant
cd my-assistant
```

### Step 2: Run Initialization

```bash
./scripts/init.sh
```

This will:
- Check all prerequisites and report missing tools
- Offer to install missing tools via Homebrew
- Make all scripts executable
- Create required directories (`logs/`, `.claude/state/todos/`, etc.)
- Install Telegram gateway dependencies (if present)

### Step 3: Configure the Daemon

Copy and customize the daemon config:

```bash
cp cc4me.config.yaml.template cc4me.config.yaml
```

Edit `cc4me.config.yaml` and set:
- `agent.name` — Your assistant's name (e.g., "buddy")
- `tmux.session` — tmux session name (default: "cc4me")
- `channels.telegram.enabled` — Set `true` if using Telegram
- `channels.email.enabled` — Set `true` if using email
- Other settings can use defaults

Install and start the daemon:

```bash
# Copy plist template
cp launchd/com.assistant.daemon.plist.template ~/Library/LaunchAgents/com.assistant.daemon.plist

# Edit the plist: replace __PROJECT_DIR__ and __HOME_DIR__ with actual paths
# Then load it:
launchctl load ~/Library/LaunchAgents/com.assistant.daemon.plist
```

Verify the daemon started:

```bash
curl http://localhost:3847/health
```

### Step 4: Start Claude Code

```bash
./scripts/start.sh
```

This starts Claude Code with the custom system prompt loaded.

### Step 5: Run the Setup Wizard

Inside Claude Code:
```
> /setup
```

The wizard configures:
1. **Identity** - Name your assistant, set personality traits
2. **Autonomy mode** - How much freedom the assistant gets
3. **Safe senders** - Trusted Telegram/email contacts
4. **Integrations** - Telegram bot, email providers
5. **State files** - Memory, calendar, todos initialized

### Step 6: Start Persistent Session

```bash
# Start in background
./scripts/start-tmux.sh --detach

# Reattach anytime
./scripts/attach.sh
```

## Integration Setup

### Telegram Bot

1. **Create a bot**: Message [@BotFather](https://t.me/botfather) on Telegram, send `/newbot`, choose a name and username

2. **Store bot token in Keychain**:
   ```bash
   security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "YOUR_BOT_TOKEN" -U
   ```

3. **Get your chat ID**: Message your new bot, then visit:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Find the `chat.id` field in the response.

4. **Add to safe senders**: Edit `.claude/state/safe-senders.json`:
   ```json
   {
     "telegram": {
       "users": ["YOUR_CHAT_ID"]
     }
   }
   ```

5. **Set up Cloudflare tunnel** (for receiving messages):
   ```bash
   cd scripts/telegram-setup
   npm install
   node setup.js
   ```
   This guides you through tunnel creation and webhook registration.

6. **Test**: Send a message to your bot on Telegram. The daemon handles message forwarding automatically.

### Email (Fastmail)

1. **Create API token**: Fastmail Settings > Privacy & Security > Integrations > API tokens > New

2. **Store credentials**:
   ```bash
   security add-generic-password -a "assistant" -s "credential-fastmail-email" -w "you@fastmail.com" -U
   security add-generic-password -a "assistant" -s "credential-fastmail-token" -w "YOUR_API_TOKEN" -U
   ```

3. **Test**: `node scripts/email/jmap.js inbox`

### Email (Microsoft 365 / Graph API)

1. **Register an Azure AD app** at [portal.azure.com](https://portal.azure.com):
   - App registrations > New registration
   - Name: "My Assistant Mail Client"
   - Supported account types: Single tenant
   - Add a client secret

2. **Grant API permissions**:
   - Required: `Mail.ReadWrite`, `Mail.Send`, `User.Read.All`
   - Optional: `Calendars.ReadWrite`, `Contacts.ReadWrite`, `Tasks.ReadWrite.All`
   - Grant admin consent

3. **Store credentials**:
   ```bash
   security add-generic-password -a "assistant" -s "credential-azure-client-id" -w "YOUR_CLIENT_ID" -U
   security add-generic-password -a "assistant" -s "credential-azure-tenant-id" -w "YOUR_TENANT_ID" -U
   security add-generic-password -a "assistant" -s "credential-azure-secret-value" -w "YOUR_SECRET" -U
   security add-generic-password -a "assistant" -s "credential-graph-user-email" -w "you@yourdomain.com" -U
   ```

4. **Test**: `node scripts/email/graph.js inbox`

See `.claude/knowledge/integrations/microsoft-graph.md` for detailed Azure setup instructions.

### Background Daemon

The v2 daemon handles all background services in a single process. If you set it up in Step 3, it's already running. It manages:

- **Telegram** — webhook receiver, message forwarding, typing indicators
- **Email checks** — periodic inbox monitoring (every 15 minutes)
- **Todo reminders** — nudge to work on open tasks (every 30 minutes)
- **Context watchdog** — auto-save when context window is filling up (every 3 minutes)
- **Memory consolidation** — nightly cascade summarization (5am daily)
- **Health checks** — system status monitoring (weekly)

All task schedules are configured in `cc4me.config.yaml` under `scheduler.tasks`.

```bash
# Check daemon status
curl http://localhost:3847/health

# Restart daemon after config changes
launchctl unload ~/Library/LaunchAgents/com.assistant.daemon.plist
launchctl load ~/Library/LaunchAgents/com.assistant.daemon.plist
```

## Verification

After setup, verify everything works:

```bash
# Check tmux session is running
tmux ls

# Check Telegram gateway (if configured)
curl http://localhost:3847/health

# Check email (if configured)
node scripts/email/jmap.js inbox     # Fastmail
node scripts/email/graph.js inbox    # M365

# Inside Claude Code:
> /todo list           # Should show empty list
> /memory              # Should show empty memory
> /mode                # Should show current autonomy mode
```

## Troubleshooting

### "claude: command not found"
Install Claude Code: `npm install -g @anthropic-ai/claude-code`

### Scripts not executable
Run: `chmod +x scripts/*.sh .claude/hooks/*.sh`

### Keychain permission denied
- Unlock Keychain: open Keychain Access app
- Check "Always allow" for security tool access

### tmux session won't start
- Check if session exists: `tmux ls`
- Kill stuck session: `tmux kill-session -t assistant`
- Try again: `./scripts/start-tmux.sh --detach`

### Telegram webhook not receiving messages
- Verify tunnel: `cloudflared tunnel list`
- Check gateway health: `curl http://localhost:3847/health`
- Re-register webhook: `./scripts/telegram-setup/start-tunnel.sh`

### "Node.js v18+ required"
Update Node.js: `brew upgrade node`

## Customization

### Modify Your Assistant

- **Personality**: Edit `.claude/state/system-prompt.txt`
- **Behavior rules**: Edit `.claude/CLAUDE.md`
- **Autonomy**: `/mode <level>` or edit `.claude/state/autonomy.json`
- **Skills**: Add new skills in `.claude/skills/` or use `/skill-create`

### Add Hooks

Configure hooks in `.claude/settings.json`. See `.claude/skills/hooks/SKILL.md` for details.

## Updating CC4Me

```bash
# Add upstream remote (one time)
git remote add upstream https://github.com/RockaRhyme/CC4Me.git

# Fetch and merge updates
git fetch upstream
git merge upstream/main

# Re-run init if scripts changed
./scripts/init.sh
```

---

**Setup complete!** Start with `./scripts/start-tmux.sh --detach` and message your assistant.
