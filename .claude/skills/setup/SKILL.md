---
name: setup
description: Interactive setup wizard for configuring the assistant after cloning. Creates state files and configures identity, autonomy, and integrations.
argument-hint: [start | identity | autonomy | integrations | all]
---

# Setup Wizard

Interactive wizard to configure the assistant after cloning the CC4Me template.

## Usage

- `/setup` or `/setup start` - Run full setup wizard
- `/setup identity` - Configure identity only
- `/setup autonomy` - Configure autonomy mode only
- `/setup integrations` - Configure integrations only
- `/setup all` - Run all setup steps

## What Gets Configured

### 1. Identity & System Prompt
- Assistant name
- Personality traits (optional)
- Core directives

Creates:
- `.claude/state/identity.json`
- `.claude/state/system-prompt.txt` (loaded at startup via `--append-system-prompt`)

### 2. Autonomy Mode
- Choose default autonomy level
- Explain each mode
- Set initial mode

Creates: `.claude/state/autonomy.json`

### 3. Safe Senders
- Add Telegram user IDs
- Add email addresses
- Configure trust levels

Creates: `.claude/state/safe-senders.json`

### 4. Integrations

#### Claude Subscription
- Verify the user has Claude Pro or Max (not an API key)
- Claude Code authenticates directly through the subscription
- Max plan recommended for heavy autonomous usage

#### Telegram Bot
1. Guide user to create bot via @BotFather
2. Get bot token
3. Store: `security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "TOKEN" -U`
4. Get user's chat ID (message bot, check getUpdates endpoint)
5. Add to safe-senders.json
6. Set up Cloudflare tunnel:
   - Guide through `cloudflared tunnel create`
   - Or run `node scripts/telegram-setup/setup.js` for interactive setup
7. Register webhook with Telegram API
8. Start transcript watcher for responses

#### Email (choose one or both)

**Option A: Fastmail (simplest)**
1. Guide to Fastmail Settings > Privacy & Security > Integrations > API tokens
2. Get email address and API token
3. Store email: `security add-generic-password -a "assistant" -s "credential-fastmail-email" -w "EMAIL" -U`
4. Store token: `security add-generic-password -a "assistant" -s "credential-fastmail-token" -w "TOKEN" -U`
5. Test: `node scripts/email/jmap.js inbox`

**Option B: Microsoft 365 / Graph API (custom domain)**
1. Guide through Azure AD app registration at portal.azure.com
2. Required permissions: Mail.ReadWrite, Mail.Send, User.Read.All
3. Optional permissions: Calendars.ReadWrite, Contacts.ReadWrite, Tasks.ReadWrite.All
4. Create client secret
5. Store credentials:
   - `credential-azure-client-id`
   - `credential-azure-tenant-id`
   - `credential-azure-secret-value`
   - `credential-graph-user-email`
6. Test: `node scripts/email/graph.js inbox`

See `.claude/knowledge/integrations/microsoft-graph.md` for detailed Azure setup.

#### Persistent Session
1. Explain tmux-based persistent sessions
2. Guide through `./scripts/start-tmux.sh --detach`
3. Show `./scripts/attach.sh` for reattaching
4. Explain that the session survives terminal closes

#### Scheduled Jobs
Present available launchd jobs and offer to install selected ones:
- **Email reminder** - Check inbox every 15 minutes
- **Todo reminder** - Check for overdue/high-priority items every 30 minutes
- **Context watchdog** - Monitor context usage, auto-save before limits
- **Gateway** - Keep Telegram webhook receiver running

For each selected job:
1. Copy template from `launchd/` to `~/Library/LaunchAgents/`
2. Replace `YOUR_USERNAME` with actual username
3. Update project directory paths
4. Load with `launchctl load`

#### Channel Preferences
Ask user's preferred notification channel:
- **telegram** - Responses sent via Telegram (requires bot setup)
- **terminal** - Responses shown in terminal only
- **silent** - No automatic notifications; use telegram-send.sh for explicit sends

Write choice to `.claude/state/channel.txt`

### 5. Memory Initialization
- Create v2 memory directory structure (`memory/memories/`, `memory/summaries/`)
- Add initial facts about user as individual memory files (name, preferences mentioned during setup)
- Each fact gets its own file with YAML frontmatter (date, category, importance, tags)

Creates: `.claude/state/memory/memories/*.md`

### 6. Calendar Initialization
- Copy calendar template
- Ready for use

Creates: `.claude/state/calendar.md`

## Workflow

### Full Setup (`/setup` or `/setup start`)

1. **Welcome**
   - Explain what CC4Me is
   - Overview of setup process

2. **Identity Configuration**
   - Ask: "What would you like to call me?"
   - Ask: "Any personality traits? (optional)"
   - Create identity.json
   - Generate system-prompt.txt from template (replaces {{NAME}} and {{PERSONALITY}})

3. **Autonomy Mode**
   - Explain the four modes
   - Ask: "Which mode would you like to start with?"
   - Recommend `confident` for new users
   - Create autonomy.json with chosen mode

4. **Safe Senders**
   - Ask: "Do you want to configure Telegram integration?"
   - If yes: Get chat ID
   - Ask: "Do you want to configure email integration?"
   - If yes: Get email address
   - Create safe-senders.json

5. **Integrations**
   - If Telegram: Guide through bot token + tunnel setup
   - If Email: Present Fastmail vs M365 options, guide through chosen provider
   - Store all credentials in Keychain

6. **Persistent Session**
   - Explain tmux session benefits
   - Offer to start a persistent session now

7. **Scheduled Jobs**
   - Present available launchd jobs
   - Install selected ones

8. **Channel Preferences**
   - Ask preferred notification channel
   - Write to channel.txt

9. **Initialize State Files**
   - Create v2 memory directory structure and initial memory files
   - Copy calendar.md.template to calendar.md

10. **Summary**
    - Show what was configured
    - List all active integrations
    - Show running services
    - Explain next steps

## Output Format

### Welcome
```
# Welcome to CC4Me Setup

I'll help you configure your personal assistant.

We'll set up:
1. My identity (what to call me)
2. Autonomy mode (how much freedom I have)
3. Safe senders (who I trust)
4. Integrations (Telegram, email — optional)
5. Persistent session (tmux)
6. Scheduled jobs (optional)

Ready? Let's begin...
```

### Completion
```
## Setup Complete!

Here's what I configured:
- Identity: "Jarvis"
- Autonomy: confident
- Safe Senders: Telegram (1 user), Email (1 address)
- Integrations: Telegram bot, Fastmail email
- Session: Running in tmux (detached)
- Scheduled Jobs: email-reminder, context-watchdog

Your assistant is ready. Try:
- Send a Telegram message to test the bot
- `/todo add "My first to-do"`
- `/email check`
- `/memory add "Important fact"`
```

## State File Templates

The setup process copies from `.template` files:

- `autonomy.json.template` > `autonomy.json`
- `identity.json.template` > `identity.json`
- `safe-senders.json.template` > `safe-senders.json`
- `memory/` > v2 memory directory structure (memories/, summaries/)
- `calendar.md.template` > `calendar.md`
- `system-prompt.txt.template` > `system-prompt.txt` (with {{NAME}} and {{PERSONALITY}} replaced)

## System Prompt

The system prompt file (`.claude/state/system-prompt.txt`) is loaded at startup via `--append-system-prompt`. This provides:

- **Identity**: Name and personality at the system level
- **Core Directives**: Always-on behaviors like checking memory, respecting autonomy
- **Communication Style**: How to interact with the user

To use the system prompt, start Claude with:
```bash
./scripts/start.sh
```

## Notes

- Setup can be re-run anytime to update configuration
- Individual sections can be configured separately
- Credentials never stored in plain text (always Keychain)
- User can edit state files directly after setup
