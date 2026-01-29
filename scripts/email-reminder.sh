#!/bin/bash
#
# Email Reminder - Prompts BMO to check email inbox if there are unread messages
# Run via launchd every hour

BASE_DIR="/Users/bmo/CC4Me-BMO"
STATE_DIR="$BASE_DIR/.claude/state"
PENDING_FILE="$STATE_DIR/telegram-pending.json"
LOG_FILE="$BASE_DIR/logs/email-reminder.log"
JMAP_SCRIPT="$BASE_DIR/scripts/email/jmap.js"
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

# Check for unread emails
UNREAD_OUTPUT=$(node "$JMAP_SCRIPT" unread 2>&1)
UNREAD_COUNT=$(echo "$UNREAD_OUTPUT" | grep -c "^\d\+\. \[UNREAD\]" || echo "0")

# Parse the count from the header line
UNREAD_COUNT=$(echo "$UNREAD_OUTPUT" | grep "^## Unread" | sed 's/.*(\([0-9]*\) messages).*/\1/')

if [ -z "$UNREAD_COUNT" ] || [ "$UNREAD_COUNT" -eq 0 ]; then
  log "No unread emails, skipping"
  exit 0
fi

# Inject reminder into session
log "Reminding BMO about $UNREAD_COUNT unread email(s)"
REMINDER="[System] You have $UNREAD_COUNT unread email(s). Run: node scripts/email/jmap.js unread"

$TMUX -S "$TMUX_SOCKET" send-keys -t $SESSION_NAME -l "$REMINDER"
$TMUX -S "$TMUX_SOCKET" send-keys -t $SESSION_NAME Enter

log "Reminder sent"
