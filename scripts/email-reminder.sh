#!/bin/bash
#
# Email Reminder - Prompts the assistant to check email inbox if there are unread messages
# Run via launchd every hour
#
# Prerequisites:
#   - scripts/email/graph.js and/or scripts/email/jmap.js configured with credentials
#   - tmux session running the assistant
#   - NODE and TMUX binaries available (adjust paths below if needed)

# Resolve BASE_DIR relative to this script's location
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$BASE_DIR/.claude/state"
PENDING_FILE="$STATE_DIR/telegram-pending.json"
LOG_FILE="$BASE_DIR/logs/email-reminder.log"
JMAP_SCRIPT="$BASE_DIR/scripts/email/jmap.js"
GRAPH_SCRIPT="$BASE_DIR/scripts/email/graph.js"

# Auto-detect binaries (prefer Homebrew, fall back to PATH)
NODE="${NODE:-$(command -v node || echo /opt/homebrew/bin/node)}"
TMUX="${TMUX_BIN:-$(command -v tmux || echo /opt/homebrew/bin/tmux)}"

# Session name - override via environment variable if needed
SESSION_NAME="${CC4ME_SESSION_NAME:-assistant}"

# Auto-detect tmux socket
if [ -n "$TMUX_TMPDIR" ]; then
  TMUX_SOCKET="$TMUX_TMPDIR/default"
elif [ -d "/private/tmp/tmux-$(id -u)" ]; then
  TMUX_SOCKET="/private/tmp/tmux-$(id -u)/default"
else
  TMUX_SOCKET=""
fi

# Build tmux command with or without socket
tmux_cmd() {
  if [ -n "$TMUX_SOCKET" ]; then
    "$TMUX" -S "$TMUX_SOCKET" "$@"
  else
    "$TMUX" "$@"
  fi
}

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if session exists
if ! tmux_cmd has-session -t "$SESSION_NAME" 2>/dev/null; then
  log "No session - assistant is not running, skipping"
  exit 0
fi

# Check if already working (pending telegram message less than 5 min old)
if [ -f "$PENDING_FILE" ]; then
  PENDING_AGE=$(( $(date +%s) - $(stat -f %m "$PENDING_FILE") ))
  if [ "$PENDING_AGE" -lt 300 ]; then
    log "Assistant is busy (pending message ${PENDING_AGE}s old), skipping"
    exit 0
  fi
fi

# Check for unread emails on configured accounts
GRAPH_UNREAD=0
JMAP_UNREAD=0

# Check Microsoft Graph (if script exists and credentials are configured)
if [ -f "$GRAPH_SCRIPT" ]; then
  GRAPH_OUTPUT=$("$NODE" "$GRAPH_SCRIPT" unread 2>&1)
  GRAPH_UNREAD=$(echo "$GRAPH_OUTPUT" | grep "^## Unread" | sed 's/.*(\([0-9]*\) messages).*/\1/')
  [ -z "$GRAPH_UNREAD" ] && GRAPH_UNREAD=0
fi

# Check Fastmail JMAP (if script exists and credentials are configured)
if [ -f "$JMAP_SCRIPT" ]; then
  JMAP_OUTPUT=$("$NODE" "$JMAP_SCRIPT" unread 2>&1)
  JMAP_UNREAD=$(echo "$JMAP_OUTPUT" | grep "^## Unread" | sed 's/.*(\([0-9]*\) messages).*/\1/')
  [ -z "$JMAP_UNREAD" ] && JMAP_UNREAD=0
fi

TOTAL_UNREAD=$((GRAPH_UNREAD + JMAP_UNREAD))

if [ "$TOTAL_UNREAD" -eq 0 ]; then
  log "No unread emails (Graph: $GRAPH_UNREAD, JMAP: $JMAP_UNREAD), skipping"
  exit 0
fi

# Build reminder message
DETAILS=""
[ "$GRAPH_UNREAD" -gt 0 ] && DETAILS="$GRAPH_UNREAD on Graph"
[ "$JMAP_UNREAD" -gt 0 ] && { [ -n "$DETAILS" ] && DETAILS="$DETAILS, "; DETAILS="${DETAILS}$JMAP_UNREAD on Fastmail"; }

log "Reminding assistant about $TOTAL_UNREAD unread email(s) ($DETAILS)"
REMINDER="[System] You have $TOTAL_UNREAD unread email(s) ($DETAILS). Run /email check"

tmux_cmd send-keys -t "$SESSION_NAME" -l "$REMINDER"
tmux_cmd send-keys -t "$SESSION_NAME" Enter

log "Reminder sent"
