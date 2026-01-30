# CC4Me Deployment Plan: Will's Setup & Upstream Contribution

**Prepared by BMO** | January 29, 2026 | For Dave's review and discussion

---

## Table of Contents
1. [Current State Assessment](#1-current-state-assessment)
2. [Contributing Back to Upstream CC4Me](#2-contributing-back-to-upstream-cc4me)
3. [Will's Homework — Prerequisites](#3-wills-homework--prerequisites)
4. [Will's Deployment Walkthrough](#4-wills-deployment-walkthrough)
5. [README & Documentation Updates](#5-readme--documentation-updates)
6. [Open Questions for Discussion](#6-open-questions-for-discussion)

---

## 1. Current State Assessment

### BMO's Fork vs Upstream

| | Upstream (CC4Me) | BMO Fork (CC4Me-BMO) |
|---|---|---|
| **Repo** | github.com/RockaRhyme/CC4Me | github.com/RockaRhyme/CC4Me-BMO |
| **Commits** | 12 (base framework) | 27 (12 base + 15 enhancements) |
| **Skills** | 10 (spec, plan, build, validate, todo, memory, calendar, mode, save-state, setup) | 16 (+email, telegram, restart, skill-create, hooks, keybindings-help) |
| **Hooks** | 1 (pre-build) | 4 (+session-start, pre-compact, set-channel) |
| **Scripts** | init.sh, start.sh | +18 scripts (tmux, email, telegram, watchers, reminders, app bundle) |
| **Integrations** | Conceptual (templates only) | Working (Telegram webhook, Fastmail JMAP, M365 Graph, Cloudflare tunnel) |
| **State** | Templates only | Fully populated (BMO-specific) |

### What's Generic (Can Go Upstream)

These are platform features, not BMO-specific:

- **Session persistence**: tmux scripts (start-tmux.sh, attach.sh, restart.sh, restart-watcher.sh)
- **Lifecycle hooks**: session-start.sh, pre-compact.sh, set-channel.sh
- **Email skill & scripts**: SKILL.md, jmap.js (Fastmail), graph.js (M365) — all parameterized via Keychain
- **Telegram skill & scripts**: SKILL.md, gateway.js, setup.js, cloudflare-setup.js, transcript-watcher.sh, telegram-send.sh
- **Scheduled jobs**: email-reminder.sh, todo-reminder.sh, context-watchdog.sh, context-monitor-statusline.sh
- **Restart skill**: SKILL.md, restart.sh
- **Skill-create skill**: For creating new skills
- **Hooks skill**: For managing hooks
- **macOS automation knowledge**: automation.md
- **Integration knowledge**: telegram.md, fastmail.md, keychain.md, microsoft-graph.md
- **Launchd template improvements** (if any)
- **Updated CLAUDE.md** with assistant behaviors, security policy, autonomy modes
- **Updated settings.json** with hook configuration

### What's BMO-Specific (Should NOT Go Upstream)

- `.claude/state/*` — All state files (identity, memory, calendar, todos, safe-senders, etc.)
- `scripts/OpenBMO.app/` — BMO-branded macOS app bundle
- `logs/*` — Runtime logs
- `.claude/state/research/*` — BMO's research documents
- Any hardcoded references to "BMO", bmobot.ai, Dave Hurley, etc.

---

## 2. Contributing Back to Upstream CC4Me

### Strategy: Feature Branch PR

Rather than dumping 15 commits, create a clean PR with logical groupings:

#### PR 1: Session Persistence & Lifecycle Hooks
**Files:**
- scripts/start-tmux.sh
- scripts/attach.sh
- scripts/restart.sh
- scripts/restart-watcher.sh
- .claude/hooks/session-start.sh
- .claude/hooks/pre-compact.sh
- .claude/hooks/set-channel.sh
- .claude/settings.json (hook configuration)
- .claude/skills/restart/SKILL.md
- scripts/start.sh (updates)

**What to do:**
- Remove any BMO-specific references
- Ensure start.sh is generic (it already uses `--append-system-prompt` from state)
- Test that hooks work with a fresh state directory

#### PR 2: Email Integration
**Files:**
- .claude/skills/email/SKILL.md
- scripts/email/jmap.js (Fastmail)
- scripts/email/graph.js (M365)
- scripts/email-reminder.sh
- .claude/knowledge/integrations/fastmail.md
- .claude/knowledge/integrations/microsoft-graph.md
- .claude/knowledge/integrations/keychain.md

**What to do:**
- Genericize SKILL.md — remove bmo@bmobot.ai and bmo_hurley@fastmail.com references
- Make email addresses configurable via Keychain lookup (they already are)
- Add setup instructions for both providers
- Document the `credential-*` naming convention

#### PR 3: Telegram Integration
**Files:**
- .claude/skills/telegram/SKILL.md
- scripts/telegram-send.sh
- scripts/transcript-watcher.sh
- scripts/telegram-setup/* (entire directory)
- .claude/knowledge/integrations/telegram.md
- .claude/hooks/set-channel.sh (if not in PR 1)

**What to do:**
- Remove BMO-specific bot username, webhook URL
- Parameterize gateway.js to read bot token and safe-senders from standard locations
- Ensure setup.js guides through full bot creation
- Document Cloudflare tunnel setup as optional (could use ngrok or other alternatives)

#### PR 4: Scheduled Jobs & Monitoring
**Files:**
- scripts/todo-reminder.sh
- scripts/context-watchdog.sh
- scripts/context-monitor-statusline.sh
- launchd/ (updated templates for all jobs)

**What to do:**
- Create launchd plist templates for each job
- Add setup instructions for enabling/disabling each job
- Document the monitoring architecture

#### PR 5: Updated Documentation & CLAUDE.md
**Files:**
- .claude/CLAUDE.md (rewritten for generic assistant)
- README.md (comprehensive update)
- SETUP.md (updated with integration steps)
- .claude/skills/setup/SKILL.md (updated to cover new integrations)

**What to do:**
- Rewrite CLAUDE.md to be a template (no BMO-specific content)
- Update README with full feature list and setup guide
- Add integration section to SETUP.md
- Update /setup wizard to handle all new integrations

### Before Any PRs: Cleanup Tasks

1. **Audit for hardcoded values**: Search all files for "BMO", "bmo", "bmobot.ai", "Dave", "daveh", "7629737488", and replace with template variables or Keychain lookups
2. **Create template state files**: Ensure `.claude/state/*.template` files exist for all state files
3. **Update .gitignore**: Ensure all state files, logs, and personal data are excluded
4. **Test fresh clone**: Clone upstream, apply changes, run /setup, verify everything works from scratch
5. **Add graph.js to tracked files**: Currently `scripts/email/graph.js` is untracked

### Update Setup Scripts & Wizard

The current `init.sh`, `start.sh`, and `/setup` skill were written for the original spec-driven workflow and don't account for the assistant enhancements. These must be updated before Will can use the repo.

#### init.sh Updates
- **Add prerequisite checks**: Verify `tmux`, `jq`, `node` (v18+), `cloudflared`, and `python3` are installed (not just `claude`)
- **Offer to install missing tools**: Prompt to `brew install` anything missing
- **chmod all scripts**: Currently only covers `scripts/` and `.claude/hooks/` — must also cover `scripts/telegram-setup/`, `scripts/email/`
- **Create logs/ directory**: Needed by transcript watcher, email reminder, and other jobs
- **Run npm install**: For `scripts/telegram-setup/` (gateway dependencies)
- **Update skills list**: Add email, telegram, restart, skill-create, hooks, keybindings-help to the printed summary
- **Remove hardcoded claude path**: `start.sh` has `/Users/bmo/.local/bin/claude` — should use `which claude` or `command -v claude` with fallback

#### /setup Skill Updates
- **Add Claude subscription step**: Verify the user has Claude Pro or Max (not an API key). Add guidance on authenticating Claude Code with the subscription.
- **Expand email integration section**:
  - Add M365/Graph API as Option B (Azure app registration, client credentials, permissions)
  - Fix Fastmail credential name: `credential-fastmail-token` not `credential-fastmail-password`
  - Add option for both providers (like BMO's setup)
- **Expand Telegram integration section**:
  - Add Cloudflare tunnel setup (or ngrok alternative)
  - Add webhook registration step
  - Add transcript watcher configuration
  - Guide through `node scripts/telegram-setup/setup.js`
- **Add persistent session step**: Guide through tmux setup (`start-tmux.sh`), explain detached mode
- **Add scheduled jobs step**: Present available launchd jobs (email reminder, context watchdog, todo reminder), offer to install selected ones
- **Add calendar integration step**: Offer icalBuddy installation (`brew install ical-buddy`), explain macOS Calendar permissions needed, guide through adding accounts in System Settings > Internet Accounts
- **Add channel/notification preferences**: Ask user's preference for silent vs. Telegram vs. terminal notifications
- **Update completion summary**: Show all configured integrations, running services, and next steps

### Merge Considerations

- Upstream has 12 commits; BMO fork has 27
- No conflicts expected since all BMO changes are additive (new files)
- The only modified existing file is `scripts/start.sh` (minor changes)
- Could also contribute via `git format-patch` if PRs are too complex

---

## 3. Will's Homework — Prerequisites

This is what Will needs to do BEFORE running the setup. Send this as a checklist.

### Hardware
- [x] Mac computer (any recent macOS — Ventura 13+ recommended)
- [ ] Stable internet connection

### Software to Install

| Step | What | How | Time |
|------|------|-----|------|
| 1 | **Homebrew** | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` | 5 min |
| 2 | **Node.js** (v18+) | `brew install node` | 2 min |
| 3 | **Git** | `brew install git` (may already be installed) | 1 min |
| 4 | **Claude Code** | `npm install -g @anthropic-ai/claude-code` | 1 min |
| 5 | **tmux** | `brew install tmux` | 1 min |
| 6 | **jq** | `brew install jq` | 1 min |
| 7 | **Cloudflared** (for Telegram) | `brew install cloudflare/cloudflare/cloudflared` | 1 min |
| 8 | **Python 3** (for doc generation) | Usually pre-installed; verify with `python3 --version` | — |

### Accounts to Create

| Step | Account | URL | What You Get | Notes |
|------|---------|-----|-------------|-------|
| 1 | **Claude Max Subscription** | claude.ai | Claude Code access via subscription | Required. Max plan ($100/month) recommended for heavy assistant usage. Pro ($20/month) works but with lower limits. No API key needed — Claude Code authenticates directly through the subscription. |
| 2 | **GitHub** | github.com | Repo access | Probably already has one |
| 3 | **Telegram Bot** | t.me/BotFather | Bot token + username | Message @BotFather, `/newbot`, choose a name and username |
| 4 | **Cloudflare** | dash.cloudflare.com | Tunnel for webhooks | Free tier is fine. Needs a domain (or can use Cloudflare's free tunnel subdomain) |
| 5 | **Email Provider** (choose one) | — | Email sending/receiving | See options below |

### Email Provider Options

Will needs to decide which email setup he wants:

**Option A: Fastmail (Simplest)**
- Sign up at fastmail.com ($3-5/month)
- Create API token: Settings → Privacy & Security → Integrations → API tokens
- Works immediately, JMAP API is reliable
- Easiest path to working email

**Option B: Microsoft 365 via GoDaddy (Custom Domain)**
- Register a domain (GoDaddy, Namecheap, Cloudflare, etc.)
- Get M365 Business Basic ($6/month via GoDaddy, or $6/user/month direct)
- Set up Azure AD app registration with Graph API permissions
- More complex but gives a professional custom email (assistant@willsdomain.com)
- Requires: Azure portal access, app registration, client secret, SPF/DKIM setup

**Option C: Both (Like BMO)**
- M365 for primary (custom domain)
- Fastmail for secondary/fallback
- Most capable but most setup work

**Recommendation for Will**: Start with **Option A (Fastmail only)**. He can add M365 later if he wants a custom domain. Fastmail is 15 minutes to set up; M365 is 2+ hours.

### Credentials Will Needs to Gather

After creating accounts, Will should have these ready:

| Credential | Where to Get It |
|------------|----------------|
| Claude Max subscription | claude.ai → Subscribe to Max plan (Claude Code authenticates directly, no API key needed) |
| Telegram bot token | @BotFather will provide it when creating the bot |
| Telegram chat ID | Message his bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| Fastmail email | His Fastmail email address |
| Fastmail API token | Fastmail → Settings → Privacy & Security → Integrations → API tokens → New |
| Cloudflare API token (optional) | Cloudflare dashboard → API Tokens |

### Domain (Optional but Recommended for Telegram)

Will needs a way to receive Telegram webhooks. Options:
- **Buy a cheap domain** ($10-12/year) and use Cloudflare tunnel
- **Use Cloudflare's free tunnel** with a `.cfargotunnel.com` subdomain (may have limitations)
- **Use ngrok** as an alternative tunnel (free tier available)

### macOS Setup

Will should also:
- Enable **Terminal** access in System Settings → Privacy & Security → App Management
- Have his **Mac admin password** ready (for Keychain operations)
- Optionally create a dedicated macOS user account for the assistant (like Dave did with "bmo")

---

## 4. Will's Deployment Walkthrough

Once prerequisites are done, this is the actual setup process:

### Step 1: Clone the Repo
```bash
git clone https://github.com/RockaRhyme/CC4Me.git my-assistant
cd my-assistant
```

### Step 2: Initialize
```bash
./scripts/init.sh
```
This checks prerequisites, makes scripts executable, creates directories.

### Step 3: Start Claude Code and Run Setup
```bash
./scripts/start.sh
# Inside Claude Code:
> /setup
```
The setup wizard walks through:
1. Name the assistant
2. Choose personality
3. Set autonomy mode (recommend `confident` for new users)
4. Configure safe senders
5. Set up integrations (Telegram, email)

### Step 4: Store Credentials in Keychain
```bash
# Telegram bot token
security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "BOT_TOKEN" -U

# Fastmail
security add-generic-password -a "assistant" -s "credential-fastmail-email" -w "email@fastmail.com" -U
security add-generic-password -a "assistant" -s "credential-fastmail-token" -w "API_TOKEN" -U
```

### Step 5: Set Up Telegram Webhook
```bash
cd scripts/telegram-setup
npm install  # Install gateway dependencies (pino, etc.)
node setup.js  # Interactive Telegram setup
```
This handles:
- Bot token verification
- Cloudflare tunnel creation
- Webhook registration with Telegram

### Step 6: Start Persistent Session
```bash
./scripts/start-tmux.sh --detach
```
This starts the assistant in a detached tmux session.

### Step 7: Set Up Scheduled Jobs
```bash
# Copy and customize launchd plists
cp launchd/com.assistant.harness.plist.template ~/Library/LaunchAgents/com.assistant.plist
# Edit paths, then:
launchctl load ~/Library/LaunchAgents/com.assistant.plist
```

### Step 8: Test Everything
- Send a Telegram message to the bot
- Check that the assistant responds
- Try `/todo add "Test todo"`
- Try `/email check`

---

## 5. README & Documentation Updates

### Current State

The README and SETUP.md are written for the original spec-driven workflow only. They don't cover:
- Telegram integration
- Email integration
- Persistent tmux sessions
- Scheduled jobs (launchd)
- The full assistant experience
- Actual deployment steps

### Proposed README Structure

```
# CC4Me — Claude Code for Me

## What Is CC4Me?
[Brief intro — template that turns Claude Code into a persistent personal assistant]

## Features
### Personal Assistant
- Persistent memory, todos, calendar
- Telegram bot integration
- Email integration (Fastmail / M365)
- Autonomy modes
- Secure credential storage (macOS Keychain)
- Scheduled jobs and monitoring

### Development Workflow
- Spec → Plan → Validate → Build
- [Existing content, condensed]

## Quick Start
### Prerequisites
- macOS (Ventura 13+)
- Node.js 18+
- Claude Code CLI
- Claude Pro or Max subscription

### Installation
[Step-by-step clone, init, /setup]

### Optional: Integrations
#### Telegram Bot
[Condensed setup steps]

#### Email
[Condensed setup steps for Fastmail and M365]

#### Persistent Service
[tmux and launchd setup]

## Architecture
[Diagram of message flow, hook lifecycle, state management]

## Project Structure
[Updated tree showing all new directories and files]

## Configuration Reference
[All state files, credential naming, launchd templates]

## Skills Reference
[Table of all 16 skills with descriptions]

## Security
[Safe senders, Keychain, Secure Data Gate]

## Troubleshooting
[Updated with integration-specific issues]

## Contributing
[How to submit PRs, use the workflow]
```

### SETUP.md Updates

- Add integration prerequisites (Telegram, email, Cloudflare)
- Add Keychain credential setup instructions
- Add tmux session setup
- Add launchd job configuration
- Add verification steps for each integration
- Remove outdated npm/Jest references (zero-dependency now)

### New Documentation to Create

- `INTEGRATIONS.md` — Detailed integration guide (could be extracted from README)
- `launchd/README.md` — Updated with all job templates
- State template files (`.template` versions of all state files)

---

## 6. Open Questions for Discussion

### For Dave

1. **Repo strategy**: Push enhancements to upstream CC4Me as PRs, or have Will clone CC4Me-BMO and reconfigure?
   - **PRs to upstream** = cleaner, Will gets a fresh start, community benefit
   - **Clone BMO fork** = faster for Will, but inherits BMO-specific cruft
   - **Recommendation**: PRs to upstream. Cleaner for everyone.

2. **Should Will get his own fork?** e.g., `github.com/RockaRhyme/CC4Me-Will` or `github.com/WillsAccount/CC4Me-[AssistantName]`
   - If Will has his own GitHub, he should fork CC4Me directly
   - If not, Dave could create one under RockaRhyme

3. **Email approach for Will**: Fastmail only (simple) vs M365 with custom domain (complex)?
   - Recommend starting with Fastmail

4. **Dedicated Mac user account?** Dave created a "bmo" user. Should Will do the same?
   - Pro: Clean separation, dedicated home directory, can run as a service
   - Con: More setup, switching users, resource overhead
   - Recommendation: Yes, if Will wants autonomous operation. No, if he just wants a chatbot.

5. **What autonomy level for Will?** Dave uses `yolo`. First-time users might prefer `confident` or `cautious`.

6. **OpenBMO.app equivalent?** Should we create a generic launcher app, or skip the macOS app bundle?

7. **What name will Will's assistant have?** (Needed for branding the app bundle, system prompt, etc.)

### For Will (Via Dave)

1. Does he have a Mac he can dedicate to this, or will it share his personal machine?
2. Does he want Telegram, email, or both?
3. Does he have a domain name, or should he get one?
4. What's his comfort level with Terminal? (Affects how much hand-holding the setup needs)
5. What does he want the assistant to DO primarily? (Tasks? Research? Chat? Software dev?)

---

## Timeline Estimate

### Phase 1: Upstream Contribution (Dave + BMO)
- Audit and genericize BMO-specific code
- Create 5 PRs to upstream CC4Me
- Update README and SETUP.md
- Test fresh clone + setup flow

### Phase 2: Will's Homework
- Send Will the prerequisites checklist
- Will creates accounts, installs software, gathers credentials

### Phase 3: Will's Deployment
- Will (or Dave assists) clones repo, runs setup
- Configure integrations
- Test and troubleshoot

### Phase 4: Polish
- Address any issues from Will's setup
- Update docs based on real user experience
- Will customizes his assistant

---

## Summary of Deliverables

| # | Deliverable | Status |
|---|------------|--------|
| 1 | Genericize BMO code for upstream PRs | Not started |
| 2 | Create 5 PRs to CC4Me upstream | Not started |
| 3 | Will's homework checklist (sendable) | In this doc |
| 4 | Updated README.md | Not started |
| 5 | Updated SETUP.md | Not started |
| 6 | Fresh-clone test of setup flow | Not started |
| 7 | Will's deployment guide | In this doc |

---

*This plan is for review and discussion. No implementation until Dave approves the approach.*
