# CC4Me Setup Guide

Complete setup instructions for CC4Me - the spec-driven workflow for Claude Code.

## Prerequisites

Before you begin, ensure you have:

### Required

1. **Node.js** (v18 or higher)
   - Download: https://nodejs.org
   - Verify: `node --version`

2. **npm** (comes with Node.js)
   - Verify: `npm --version`

3. **Claude Code CLI**
   - Install: Follow instructions at https://github.com/anthropics/claude-code
   - Verify: `claude --version`

### Optional

4. **Git** (for version control)
   - Download: https://git-scm.com
   - Verify: `git --version`

5. **Anthropic API Key**
   - Get from: https://console.anthropic.com
   - Required if using Claude API directly (not just Claude Code)

## Installation

### Option 1: Clone from GitHub (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-org/CC4Me.git my-project

# Navigate to the directory
cd my-project

# Run the initialization script
./scripts/init.sh
```

The `init.sh` script will:
- Check prerequisites
- Install npm dependencies
- Create `.env` file
- Make scripts executable
- Run tests to verify setup
- Display next steps

### Option 2: Manual Setup

If you prefer manual setup or if `init.sh` doesn't work:

```bash
# 1. Clone or download the repository
git clone https://github.com/your-org/CC4Me.git my-project
cd my-project

# 2. Install dependencies
npm install

# 3. Make scripts executable
chmod +x scripts/init.sh
chmod +x .claude/hooks/pre-build.sh

# 4. Create .env file
touch .env
# Edit .env and add your configuration (see Environment Setup below)

# 5. Verify setup
npm test -- --passWithNoTests
```

## Environment Setup

### Creating .env File

Create a `.env` file in the project root:

```bash
# Anthropic API Key (if using Claude API directly)
ANTHROPIC_API_KEY=your_api_key_here

# Future: Telegram Bot Integration
# TELEGRAM_BOT_TOKEN=your_bot_token_here
# TELEGRAM_AUTHORIZED_USERS=123456789,987654321
```

**Note**: The `.env` file is gitignored and won't be committed. This keeps your API keys secure.

### Getting an Anthropic API Key

1. Go to https://console.anthropic.com
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Copy and paste it into `.env`

**Note**: You may not need an API key if you're using Claude Code with its built-in authentication.

## Verification

### Verify Installation

Run these commands to verify everything is set up correctly:

```bash
# Check Node.js
node --version
# Should output v18.x.x or higher

# Check npm
npm --version
# Should output 8.x.x or higher

# Check Claude Code
claude --version
# Should output the Claude Code version

# Check dependencies
npm list --depth=0
# Should show all dependencies installed

# Run tests (empty test suite for now)
npm test
# Should pass with "No tests found"
```

### Verify Claude Code Skills

Start Claude Code and check that skills are available:

```bash
# Start Claude Code
claude

# In Claude Code, try:
> /help

# You should see:
# - /spec - Create specification
# - /plan - Create plan
# - /validate - Validate spec/plan/implementation
# - /build - Build from plan
```

If skills don't appear, verify that `.claude/skills/` directory exists and contains the skill files.

## First Run

### Start Claude Code

```bash
# From your project directory
claude
```

Claude will:
1. Read `.claude/CLAUDE.md` for context
2. Load skills from `.claude/skills/`
3. Be ready to use the workflow

### Create Your First Feature

Try the workflow with a simple test feature:

```bash
# In Claude Code:

# Step 1: Create a spec
> /spec hello-world

# Claude will interview you. Respond with:
# Goal: "Create a simple hello world function"
# Must-have: "Function that returns 'Hello, World!'"
# ... etc

# Step 2: Create a plan
> /plan specs/20260127-hello-world.spec.md

# Claude will create tasks and tests

# Step 3: Build it
> /build plans/20260127-hello-world.plan.md

# Claude will implement and run tests
```

## Troubleshooting

### Issue: "claude: command not found"

**Solution**: Install Claude Code CLI
```bash
# Follow installation instructions at:
# https://github.com/anthropics/claude-code
```

### Issue: npm install fails

**Solution**: Check Node.js version
```bash
node --version
# Must be v18 or higher

# Update Node.js if needed
# Download from https://nodejs.org
```

### Issue: Skills not appearing in Claude Code

**Solution**: Verify skill files exist
```bash
# Check if skill files exist
ls -la .claude/skills/

# Should show:
# - spec.md
# - plan.md
# - validate.md
# - build.md

# If missing, you may need to re-clone or restore from backup
```

### Issue: Permission denied when running scripts

**Solution**: Make scripts executable
```bash
chmod +x scripts/init.sh
chmod +x .claude/hooks/pre-build.sh
```

### Issue: Tests fail during setup

**Solution**: Check dependencies
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Verify TypeScript is installed
npx tsc --version

# Verify Jest is installed
npx jest --version
```

### Issue: Pre-build hook fails

**Solution**: Verify validation scripts work
```bash
# Test spec validator
npm run validate:spec -- templates/spec.template.md

# Test plan validator
npm run validate:plan -- templates/plan.template.md

# If these fail, check that tsx is installed:
npm install -D tsx
```

## Directory Structure After Setup

After successful setup, your project should look like:

```
my-project/
├── .claude/
│   ├── skills/
│   │   ├── spec.md
│   │   ├── plan.md
│   │   ├── validate.md
│   │   └── build.md
│   ├── hooks/
│   │   └── pre-build.sh
│   └── CLAUDE.md
├── templates/
│   ├── spec.template.md
│   ├── plan.template.md
│   └── test.template.ts
├── scripts/
│   ├── init.sh
│   ├── validate-spec.ts
│   └── validate-plan.ts
├── specs/                    # Empty initially
├── plans/                    # Empty initially
├── tests/                    # Empty initially
├── src/                      # Empty initially
├── node_modules/             # Created by npm install
├── .env                      # Created by init.sh
├── .gitignore
├── package.json
├── package-lock.json         # Created by npm install
├── tsconfig.json
├── jest.config.js
├── README.md
└── SETUP.md                  # This file
```

## Customization

### Modify Templates

Edit templates to match your project needs:
- `templates/spec.template.md` - Customize spec structure
- `templates/plan.template.md` - Customize plan structure
- `templates/test.template.ts` - Customize test structure

### Modify Skills

Edit skills to change workflow behavior:
- `.claude/skills/spec.md` - Change spec interview process
- `.claude/skills/plan.md` - Change planning logic
- `.claude/skills/validate.md` - Add/remove validation layers
- `.claude/skills/build.md` - Change build process

### Add Hooks

Add more hooks in `.claude/hooks/`:
- `post-build.sh` - Run after builds complete
- `pre-commit.sh` - Run before git commits
- `pre-plan.sh` - Run before planning

Configure hooks in `.claude/settings.json` (create if doesn't exist).

## Updating CC4Me

If the CC4Me template is updated:

```bash
# Add upstream remote (one time only)
git remote add upstream https://github.com/your-org/CC4Me.git

# Fetch updates
git fetch upstream

# Merge updates (be careful with conflicts)
git merge upstream/main

# Or rebase your changes on top of updates
git rebase upstream/main

# Reinstall dependencies if package.json changed
npm install
```

## Next Steps

Now that setup is complete:

1. **Read README.md** - Understand the workflow
2. **Read .claude/CLAUDE.md** - See what Claude knows about the project
3. **Try the workflow** - Create a simple feature with /spec → /plan → /build
4. **Customize** - Adjust templates and skills to your needs
5. **Build features** - Use the workflow for real projects

## Getting Help

- **Documentation**: See README.md for workflow details
- **Issues**: https://github.com/anthropics/claude-code/issues
- **Claude Code Docs**: https://docs.anthropic.com/claude-code

## Security Notes

### Sensitive Files

Never commit these files:
- `.env` - Contains API keys
- `.claude/settings.local.json` - User-specific settings
- `node_modules/` - Dependencies (reinstall via npm)

These are already in `.gitignore`.

### API Keys

- Store API keys in `.env` only
- Never hardcode API keys in source files
- Use environment variables in code: `process.env.ANTHROPIC_API_KEY`
- Rotate keys if exposed

### Hook Security

- Review hook scripts before making executable
- Hooks run with your permissions
- Only add trusted hooks

---

**Setup Complete!** 🎉

You're ready to start using the spec-driven workflow. Begin with:

```bash
claude
> /spec my-first-feature
```
