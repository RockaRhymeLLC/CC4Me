#!/bin/bash

# CC4Me Initialization Script
#
# Sets up the project for first-time use.
# Run this after cloning the repository.

set -e

echo "CC4Me Setup - Personal Assistant + Spec-Driven Workflow"
echo "========================================================"
echo ""

# Track missing tools
MISSING=()
OPTIONAL_MISSING=()

# Check required tools
echo "Checking prerequisites..."
echo ""

# Claude Code CLI
if command -v claude &> /dev/null; then
  echo "  [ok] Claude Code CLI"
else
  echo "  [!!] Claude Code CLI - not found"
  MISSING+=("claude")
fi

# Node.js (v18+)
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ] 2>/dev/null; then
    echo "  [ok] Node.js $(node --version)"
  else
    echo "  [!!] Node.js $(node --version) - v18+ required"
    MISSING+=("node")
  fi
else
  echo "  [!!] Node.js - not found"
  MISSING+=("node")
fi

# tmux
if command -v tmux &> /dev/null; then
  echo "  [ok] tmux $(tmux -V 2>/dev/null || echo '')"
else
  echo "  [!!] tmux - not found"
  MISSING+=("tmux")
fi

# jq
if command -v jq &> /dev/null; then
  echo "  [ok] jq"
else
  echo "  [!!] jq - not found"
  MISSING+=("jq")
fi

# Git
if command -v git &> /dev/null; then
  echo "  [ok] Git $(git --version | sed 's/git version //')"
else
  echo "  [!!] Git - not found"
  MISSING+=("git")
fi

# Optional: cloudflared (for Telegram)
if command -v cloudflared &> /dev/null; then
  echo "  [ok] cloudflared (for Telegram webhooks)"
else
  echo "  [--] cloudflared - not found (optional, needed for Telegram)"
  OPTIONAL_MISSING+=("cloudflared")
fi

# Optional: python3 (for doc generation)
if command -v python3 &> /dev/null; then
  echo "  [ok] Python 3"
else
  echo "  [--] Python 3 - not found (optional)"
  OPTIONAL_MISSING+=("python3")
fi

echo ""

# Offer to install missing required tools
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Missing required tools: ${MISSING[*]}"
  echo ""

  if command -v brew &> /dev/null; then
    echo "Install with Homebrew? (y/n)"
    read -r INSTALL_CHOICE
    if [ "$INSTALL_CHOICE" = "y" ] || [ "$INSTALL_CHOICE" = "Y" ]; then
      for tool in "${MISSING[@]}"; do
        case "$tool" in
          claude)
            echo "Installing Claude Code..."
            npm install -g @anthropic-ai/claude-code
            ;;
          node)
            echo "Installing Node.js..."
            brew install node
            ;;
          tmux)
            echo "Installing tmux..."
            brew install tmux
            ;;
          jq)
            echo "Installing jq..."
            brew install jq
            ;;
          git)
            echo "Installing Git..."
            brew install git
            ;;
        esac
      done
      echo ""
    fi
  else
    echo "Homebrew not found. Install tools manually:"
    echo "  Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    for tool in "${MISSING[@]}"; do
      case "$tool" in
        claude) echo "  Claude Code: npm install -g @anthropic-ai/claude-code" ;;
        node)   echo "  Node.js: brew install node" ;;
        tmux)   echo "  tmux: brew install tmux" ;;
        jq)     echo "  jq: brew install jq" ;;
        git)    echo "  Git: brew install git" ;;
      esac
    done
    echo ""
  fi
fi

# Offer to install optional tools
if [ ${#OPTIONAL_MISSING[@]} -gt 0 ]; then
  echo "Optional tools not found: ${OPTIONAL_MISSING[*]}"
  if command -v brew &> /dev/null; then
    echo "Install optional tools? (y/n)"
    read -r OPT_CHOICE
    if [ "$OPT_CHOICE" = "y" ] || [ "$OPT_CHOICE" = "Y" ]; then
      # Portable timeout: macOS lacks `timeout`, so use background process + kill
      brew_install_with_timeout() {
        local tool_name="$1"
        shift
        local timeout_secs=120

        echo "Installing $tool_name (${timeout_secs}s timeout, Ctrl+C to skip)..."
        brew "$@" &
        local pid=$!
        ( sleep "$timeout_secs" && kill "$pid" 2>/dev/null ) &
        local timer_pid=$!
        if wait "$pid" 2>/dev/null; then
          kill "$timer_pid" 2>/dev/null
          wait "$timer_pid" 2>/dev/null
          echo "  Done"
          return 0
        else
          kill "$timer_pid" 2>/dev/null
          wait "$timer_pid" 2>/dev/null
          echo "  Skipped ($tool_name install timed out or failed)"
          echo "  Retry later: brew $*"
          return 1
        fi
      }

      for tool in "${OPTIONAL_MISSING[@]}"; do
        case "$tool" in
          cloudflared)
            brew_install_with_timeout "cloudflared" install cloudflare/cloudflare/cloudflared
            ;;
          python3)
            brew_install_with_timeout "Python 3" install python3
            ;;
        esac
      done
      echo ""
    fi
  fi
fi

# Make scripts executable
echo "Making scripts executable..."
chmod +x scripts/*.sh 2>/dev/null || true
chmod +x scripts/init.sh
chmod +x scripts/start.sh
chmod +x scripts/email/*.js 2>/dev/null || true
chmod +x scripts/telegram-setup/*.sh 2>/dev/null || true
chmod +x .claude/hooks/*.sh 2>/dev/null || true
echo "  Done"
echo ""

# Create directories
echo "Creating directories..."
mkdir -p logs
mkdir -p .claude/state/todos
mkdir -p .claude/state/telegram-media
echo "  Done"
echo ""

# Install gateway dependencies (if telegram-setup exists)
if [ -f "scripts/telegram-setup/package.json" ]; then
  echo "Installing Telegram gateway dependencies..."
  (cd scripts/telegram-setup && npm install --silent 2>/dev/null) && echo "  Done" || echo "  Skipped (npm install failed - can retry later)"
  echo ""
fi

echo "========================================================"
echo "Initialization Complete!"
echo "========================================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start Claude Code with custom system prompt:"
echo "   $ ./scripts/start.sh"
echo ""
echo "2. Run the setup wizard:"
echo "   > /setup"
echo ""
echo "3. Or start a persistent tmux session:"
echo "   $ ./scripts/start-tmux.sh --detach"
echo ""
echo "Skills available:"
echo "  /setup       - Configure your assistant"
echo "  /todo        - Manage persistent to-dos"
echo "  /memory      - Store and lookup facts"
echo "  /calendar    - Manage schedule"
echo "  /mode        - Set autonomy level"
echo "  /email       - Send and read email"
echo "  /telegram    - Telegram integration"
echo "  /restart     - Restart session"
echo "  /spec        - Create specifications"
echo "  /plan        - Create implementation plans"
echo "  /validate    - Validate alignment"
echo "  /build       - Implement test-first"
echo "  /save-state  - Save context before /clear"
echo ""
