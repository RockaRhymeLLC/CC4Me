#!/bin/bash
#
# Todo Reminder - Prompts BMO to check for pending todos if idle
# Run via launchd every 30 minutes

BASE_DIR="/Users/bmo/CC4Me-BMO"
STATE_DIR="$BASE_DIR/.claude/state"
TODOS_DIR="$STATE_DIR/todos"
PENDING_FILE="$STATE_DIR/telegram-pending.json"
LOG_FILE="$BASE_DIR/logs/todo-reminder.log"
TMUX="/opt/homebrew/bin/tmux"
TMUX_SOCKET="/private/tmp/tmux-502/default"
SESSION_NAME="bmo"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if session exists
# Check if session exists (use explicit socket for launchd compatibility)
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

# Count open todos
OPEN_COUNT=$(ls -1 "$TODOS_DIR"/*-open-*.json "$TODOS_DIR"/*-in-progress-*.json 2>/dev/null | wc -l | tr -d ' ')

if [ "$OPEN_COUNT" -eq 0 ]; then
  log "No open todos, skipping"
  exit 0
fi

# Inject reminder into session
log "Reminding BMO about $OPEN_COUNT open todo(s)"
REMINDER="[System] You have $OPEN_COUNT open todo(s). Run /todo list to see them, or continue what you're working on."

$TMUX -S "$TMUX_SOCKET" send-keys -t $SESSION_NAME -l "$REMINDER"
$TMUX -S "$TMUX_SOCKET" send-keys -t $SESSION_NAME Enter

log "Reminder sent"
