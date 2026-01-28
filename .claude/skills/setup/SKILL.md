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

### 1. Identity
- Assistant name
- Personality traits (optional)
- Custom greeting (optional)

Creates: `.claude/state/identity.json`

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

### 4. Integrations (Optional)
- Telegram bot token (stored in Keychain)
- Email credentials (stored in Keychain)
- Other API keys

Uses: macOS Keychain

### 5. Memory Initialization
- Copy memory template
- Add initial facts about user

Creates: `.claude/state/memory.md`

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

3. **Autonomy Mode**
   - Explain the four modes
   - Ask: "Which mode would you like to start with?"
   - Create autonomy.json with chosen mode

4. **Safe Senders**
   - Ask: "Do you want to configure Telegram integration?"
   - If yes: Get chat ID
   - Ask: "Do you want to configure email integration?"
   - If yes: Get email address
   - Create safe-senders.json

5. **Integrations**
   - If Telegram: Guide through bot token setup
   - If Email: Guide through app password setup
   - Store credentials in Keychain

6. **Initialize State Files**
   - Copy memory.md.template to memory.md
   - Copy calendar.md.template to calendar.md

7. **Summary**
   - Show what was configured
   - Explain next steps
   - Offer to run `/todo list` or other commands

## Output Format

### Welcome
```
# Welcome to CC4Me Setup

I'll help you configure your personal assistant. This will take about 5 minutes.

We'll set up:
1. My identity (what to call me)
2. Autonomy mode (how much freedom I have)
3. Safe senders (who I trust)
4. Integrations (optional - Telegram, email)

Ready to start? Let's begin with identity...
```

### Identity Step
```
## Identity Configuration

What would you like to call me?
(This is how I'll refer to myself and how you'll greet me)

Examples: "Claude", "Jarvis", "Assistant", or a custom name
```

### Completion
```
## Setup Complete!

Here's what I configured:
- Identity: "Jarvis"
- Autonomy: confident (ask on destructive actions)
- Safe Senders: Telegram (1 user), Email (1 address)
- Integrations: Telegram bot configured

Your assistant is ready to use. Try:
- `/todo add "My first to-do"` - Add a to-do
- `/memory add "Important fact"` - Store something
- `/calendar show` - View your schedule

Happy to help!
```

## State File Templates

The setup process copies from `.template` files:

- `autonomy.json.template` → `autonomy.json`
- `identity.json.template` → `identity.json`
- `safe-senders.json.template` → `safe-senders.json`
- `memory.md.template` → `memory.md`
- `calendar.md.template` → `calendar.md`

## Integration Setup Details

### Telegram
1. Guide user to create bot via @BotFather
2. Get bot token
3. Store: `security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "TOKEN" -U`
4. Get user's chat ID
5. Add to safe-senders.json

### Email (Fastmail)
1. Guide to create app password
2. Get email address and app password
3. Store email: `security add-generic-password -a "assistant" -s "credential-fastmail-email" -w "EMAIL" -U`
4. Store password: `security add-generic-password -a "assistant" -s "credential-fastmail-password" -w "PASSWORD" -U`
5. Add to safe-senders.json

## Notes

- Setup can be re-run anytime to update configuration
- Individual sections can be configured separately
- Credentials never stored in plain text (always Keychain)
- User can edit state files directly after setup
