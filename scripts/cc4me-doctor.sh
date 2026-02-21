#!/usr/bin/env bash
# cc4me-doctor.sh — Setup diagnostic for CC4Me agents
# Checks prerequisites, build status, credentials, and connectivity.
# Run this when setting up a new agent or debugging startup issues.

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; }
info() { echo -e "  ${DIM}INFO${NC}  $1"; }

PASSES=0
WARNS=0
FAILS=0

check_pass() { pass "$1"; ((PASSES++)) || true; }
check_warn() { warn "$1"; ((WARNS++)) || true; }
check_fail() { fail "$1"; ((FAILS++)) || true; }

# ── Detect project root ──────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${BOLD}CC4Me Doctor${NC} — Setup Diagnostic"
echo -e "${DIM}Project: ${PROJECT_DIR}${NC}"
echo ""

# ── 1. Prerequisites ─────────────────────────────────────────
echo -e "${BOLD}Prerequisites${NC}"

# Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v)
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        check_pass "Node.js $NODE_VERSION"
    else
        check_warn "Node.js $NODE_VERSION (v18+ recommended)"
    fi
else
    check_fail "Node.js not found — install with: brew install node"
fi

# tmux
if command -v tmux &>/dev/null; then
    check_pass "tmux $(tmux -V 2>/dev/null | awk '{print $2}')"
else
    check_fail "tmux not found — install with: brew install tmux"
fi

# jq
if command -v jq &>/dev/null; then
    check_pass "jq installed"
else
    check_warn "jq not found — install with: brew install jq"
fi

# git
if command -v git &>/dev/null; then
    check_pass "git $(git --version | awk '{print $3}')"
else
    check_fail "git not found — install with: brew install git"
fi

# Claude Code
if command -v claude &>/dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    check_pass "Claude Code $CLAUDE_VERSION"
else
    check_warn "Claude Code CLI not found — install with: npm install -g @anthropic-ai/claude-code"
fi

echo ""

# ── 2. Config ─────────────────────────────────────────────────
echo -e "${BOLD}Configuration${NC}"

CONFIG_FILE="$PROJECT_DIR/cc4me.config.yaml"
if [ -f "$CONFIG_FILE" ]; then
    check_pass "cc4me.config.yaml exists"
else
    check_fail "cc4me.config.yaml missing — copy from cc4me.config.yaml.template"
fi

# State files
STATE_DIR="$PROJECT_DIR/.claude/state"
for file in autonomy.json identity.json channel.txt safe-senders.json; do
    if [ -f "$STATE_DIR/$file" ]; then
        check_pass "$file"
    else
        check_warn "$file missing — run /setup inside Claude Code"
    fi
done

echo ""

# ── 3. Daemon Build ──────────────────────────────────────────
echo -e "${BOLD}Daemon${NC}"

DAEMON_DIR="$PROJECT_DIR/daemon"
if [ -d "$DAEMON_DIR/node_modules" ]; then
    check_pass "daemon/node_modules installed"
else
    check_fail "daemon/node_modules missing — run: cd daemon && npm install"
fi

if [ -d "$DAEMON_DIR/dist" ] && [ -f "$DAEMON_DIR/dist/core/main.js" ]; then
    check_pass "daemon built (dist/core/main.js exists)"
else
    check_fail "daemon not built — run: cd daemon && npm run build"
fi

# Check if daemon is running
if curl -s --connect-timeout 2 http://localhost:3847/health &>/dev/null; then
    HEALTH=$(curl -s http://localhost:3847/health 2>/dev/null)
    OK_COUNT=$(echo "$HEALTH" | jq -r '.summary.ok // 0' 2>/dev/null)
    WARN_COUNT=$(echo "$HEALTH" | jq -r '.summary.warnings // 0' 2>/dev/null)
    ERR_COUNT=$(echo "$HEALTH" | jq -r '.summary.errors // 0' 2>/dev/null)
    check_pass "daemon running — ${OK_COUNT} ok, ${WARN_COUNT} warn, ${ERR_COUNT} err"
else
    check_warn "daemon not running — start with: launchctl load ~/Library/LaunchAgents/com.assistant.daemon.plist"
fi

echo ""

# ── 4. CC4Me Network SDK ─────────────────────────────────────
echo -e "${BOLD}CC4Me Network SDK${NC}"

# Check if cc4me-network is a dependency
if [ -f "$DAEMON_DIR/package.json" ] && grep -q '"cc4me-network"' "$DAEMON_DIR/package.json" 2>/dev/null; then
    # Find the SDK path from package.json
    SDK_REF=$(node -e "const p=require('$DAEMON_DIR/package.json'); console.log(p.dependencies?.['cc4me-network'] || 'none')" 2>/dev/null)

    if [[ "$SDK_REF" == file:* ]]; then
        SDK_REL="${SDK_REF#file:}"
        SDK_PATH="$(cd "$DAEMON_DIR" && cd "$SDK_REL" 2>/dev/null && pwd)" || SDK_PATH=""

        if [ -n "$SDK_PATH" ] && [ -d "$SDK_PATH" ]; then
            check_pass "SDK source found at $SDK_PATH"

            if [ -d "$SDK_PATH/dist" ]; then
                check_pass "SDK built (dist/ exists)"
            else
                check_fail "SDK not built — run: cd $SDK_PATH && npm run build"
            fi
        else
            check_fail "SDK path not found: $SDK_REL (relative to daemon/)"
            info "Clone cc4me-network and build: cd packages/sdk && npm run build"
        fi
    elif [[ "$SDK_REF" == none ]]; then
        info "cc4me-network not in dependencies — network features disabled"
    else
        # npm registry dependency
        if [ -d "$DAEMON_DIR/node_modules/cc4me-network" ]; then
            check_pass "cc4me-network installed from npm ($SDK_REF)"
        else
            check_fail "cc4me-network not installed — run: cd daemon && npm install"
        fi
    fi
else
    info "cc4me-network not configured — network features disabled"
fi

echo ""

# ── 5. tmux Session ───────────────────────────────────────────
echo -e "${BOLD}tmux Session${NC}"

# Try to get session name from config
if [ -f "$CONFIG_FILE" ] && command -v node &>/dev/null; then
    SESSION_NAME=$(node -e "
        const fs = require('fs');
        const yaml = require('$DAEMON_DIR/node_modules/js-yaml/dist/js-yaml.mjs' === '' ? 'js-yaml' : 'js-yaml');
        try {
            const y = require('js-yaml');
            const c = y.load(fs.readFileSync('$CONFIG_FILE','utf8'));
            console.log(c?.tmux?.session || 'assistant');
        } catch { console.log('assistant'); }
    " 2>/dev/null || echo "assistant")
else
    SESSION_NAME="assistant"
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    check_pass "tmux session '$SESSION_NAME' active"
else
    check_warn "tmux session '$SESSION_NAME' not found — start with: ./scripts/start-tmux.sh"
fi

echo ""

# ── 6. Keychain Credentials ──────────────────────────────────
echo -e "${BOLD}Keychain Credentials${NC}"

check_keychain() {
    local name="$1"
    local label="$2"
    local required="${3:-optional}"

    if security find-generic-password -s "$name" -w &>/dev/null 2>&1; then
        check_pass "$label"
    elif [ "$required" = "required" ]; then
        check_fail "$label missing"
    else
        info "$label not set (optional)"
    fi
}

# Core credentials
check_keychain "credential-agent-comms-secret" "Agent comms secret" "optional"
check_keychain "credential-cc4me-agent-key" "CC4Me Network agent key" "optional"

# Telegram
check_keychain "credential-telegram-bot-token" "Telegram bot token" "optional"

# Email - Azure
check_keychain "credential-azure-client-id" "Azure client ID" "optional"
check_keychain "credential-azure-tenant-id" "Azure tenant ID" "optional"
check_keychain "credential-azure-secret-value" "Azure client secret" "optional"

# Email - Fastmail
check_keychain "credential-fastmail-token" "Fastmail JMAP token" "optional"

echo ""

# ── 7. Network Connectivity ──────────────────────────────────
echo -e "${BOLD}Network Connectivity${NC}"

# Relay
if [ -f "$CONFIG_FILE" ]; then
    RELAY_URL=$(node -e "
        try {
            const y = require('js-yaml');
            const fs = require('fs');
            const c = y.load(fs.readFileSync('$CONFIG_FILE','utf8'));
            console.log(c?.network?.relay_url || '');
        } catch { console.log(''); }
    " 2>/dev/null || echo "")

    if [ -n "$RELAY_URL" ]; then
        if curl -s --connect-timeout 5 "${RELAY_URL}/health" &>/dev/null; then
            check_pass "Relay reachable: $RELAY_URL"
        else
            check_warn "Relay unreachable: $RELAY_URL"
        fi
    else
        info "No relay URL configured"
    fi
fi

# Telegram API
if curl -s --connect-timeout 5 https://api.telegram.org &>/dev/null; then
    check_pass "Telegram API reachable"
else
    check_warn "Telegram API unreachable"
fi

# Cloudflare tunnel
if pgrep -f cloudflared &>/dev/null; then
    check_pass "Cloudflare tunnel running"
else
    info "Cloudflare tunnel not running (needed for Telegram webhooks)"
fi

echo ""

# ── Summary ───────────────────────────────────────────────────
echo -e "${BOLD}────────────────────────────────────────${NC}"
TOTAL=$((PASSES + WARNS + FAILS))
echo -e "${BOLD}Summary:${NC} ${GREEN}${PASSES} passed${NC}, ${YELLOW}${WARNS} warnings${NC}, ${RED}${FAILS} failed${NC} (${TOTAL} checks)"

if [ "$FAILS" -gt 0 ]; then
    echo -e "${RED}Fix the failures above before starting the daemon.${NC}"
    exit 1
elif [ "$WARNS" -gt 0 ]; then
    echo -e "${YELLOW}Some optional features may not work. Fix warnings if needed.${NC}"
    exit 0
else
    echo -e "${GREEN}All checks passed! Your CC4Me setup looks good.${NC}"
    exit 0
fi
