#!/bin/bash
#
# Email Reminder - Prompts BMO to check email inbox if there are unread messages
# Run via launchd every hour

BASE_DIR="/Users/bmo/CC4Me-BMO"
STATE_DIR="$BASE_DIR/.claude/state"
PENDING_FILE="$STATE_DIR/telegram-pending.json"
LOG_FILE="$BASE_DIR/logs/email-reminder.log"
JMAP_SCRIPT="$BASE_DIR/scripts/email/jmap.js"
GRAPH_SCRIPT="$BASE_DIR/scripts/email/graph.js"
NODE="/opt/homebrew/bin/node"
TMUX="/opt/homebrew/bin/tmux"
TMUX_SOCKET="/private/tmp/tmux-502/default"
SESSION_NAME="bmo"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if session exists
if ! $TMUX -S "$TMUX_SOCKET" has-session -t $SESSION_NAME 2>/dev/null; then
  log "No session - BMO is sleeping, skipping"
  exit 0
fi

# Check if already working (pending telegram message less than 5 min old)
if [ -f "$PENDING_FILE" ]; then
  PENDING_AGE=$(( $(date +%s) - $(stat -f %m "$PENDING_FILE") ))
  if [ "$PENDING_AGE" -lt 300 ]; then
    log "BMO is busy (pending message ${PENDING_AGE}s old), skipping"
    exit 0
  fi
fi

# Check for unread emails on both accounts
GRAPH_UNREAD=0
JMAP_UNREAD=0

# Check M365 (primary)
GRAPH_OUTPUT=$($NODE "$GRAPH_SCRIPT" unread 2>&1)
GRAPH_UNREAD=$(echo "$GRAPH_OUTPUT" | grep "^## Unread" | sed 's/.*(\([0-9]*\) messages).*/\1/')
[ -z "$GRAPH_UNREAD" ] && GRAPH_UNREAD=0

# Check Fastmail (secondary)
JMAP_OUTPUT=$($NODE "$JMAP_SCRIPT" unread 2>&1)
JMAP_UNREAD=$(echo "$JMAP_OUTPUT" | grep "^## Unread" | sed 's/.*(\([0-9]*\) messages).*/\1/')
[ -z "$JMAP_UNREAD" ] && JMAP_UNREAD=0

TOTAL_UNREAD=$((GRAPH_UNREAD + JMAP_UNREAD))

if [ "$TOTAL_UNREAD" -eq 0 ]; then
  log "No unread emails (M365: $GRAPH_UNREAD, Fastmail: $JMAP_UNREAD), skipping"
  exit 0
fi

# Build reminder message
DETAILS=""
[ "$GRAPH_UNREAD" -gt 0 ] && DETAILS="$GRAPH_UNREAD on bmo@bmobot.ai"
[ "$JMAP_UNREAD" -gt 0 ] && { [ -n "$DETAILS" ] && DETAILS="$DETAILS, "; DETAILS="${DETAILS}$JMAP_UNREAD on Fastmail"; }

log "Reminding BMO about $TOTAL_UNREAD unread email(s) ($DETAILS)"
REMINDER="[System] You have $TOTAL_UNREAD unread email(s) ($DETAILS). Run /email check"

$TMUX -S "$TMUX_SOCKET" send-keys -t $SESSION_NAME -l "$REMINDER"
$TMUX -S "$TMUX_SOCKET" send-keys -t $SESSION_NAME Enter

log "Reminder sent"
