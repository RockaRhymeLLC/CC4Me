#!/bin/bash
#
# Todo Reminder - Prompts the assistant to check for pending todos if idle
# Run via launchd every 30 minutes
#
# Requires: tmux session running the assistant

# Load shared config (provides BASE_DIR, SESSION_NAME, TMUX_CMD, STATE_DIR, etc.)
source "$(cd "$(dirname "$0")" && pwd)/lib/config.sh"

TODOS_DIR="$STATE_DIR/todos"
PENDING_FILE="$STATE_DIR/telegram-pending.json"
LOG_FILE="$LOG_DIR/todo-reminder.log"

log() {
  cc4me_log "$1"
}

# Check if session exists (use explicit socket for launchd compatibility)
if ! session_exists; then
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

# Check todos directory exists
if [ ! -d "$TODOS_DIR" ]; then
  log "No todos directory, skipping"
  exit 0
fi

# Count open todos
OPEN_COUNT=$(ls -1 "$TODOS_DIR"/*-open-*.json "$TODOS_DIR"/*-in-progress-*.json 2>/dev/null | wc -l | tr -d ' ')

if [ "$OPEN_COUNT" -eq 0 ]; then
  log "No open todos, skipping"
  exit 0
fi

# Inject reminder into session
log "Reminding assistant about $OPEN_COUNT open todo(s)"
REMINDER="[System] You have $OPEN_COUNT open todo(s). Run /todo list to see them, or continue what you're working on."

$TMUX_CMD send-keys -t "$SESSION_NAME" -l "$REMINDER"
$TMUX_CMD send-keys -t "$SESSION_NAME" Enter

log "Reminder sent"
