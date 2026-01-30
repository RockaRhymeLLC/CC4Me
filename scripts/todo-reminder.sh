#!/bin/bash
#
# Todo Reminder - Prompts the assistant to check for pending todos if idle
# Run via launchd every 30 minutes
#
# Requires: tmux session running the assistant

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$BASE_DIR/.claude/state"
TODOS_DIR="$STATE_DIR/todos"
PENDING_FILE="$STATE_DIR/telegram-pending.json"
LOG_FILE="$BASE_DIR/logs/todo-reminder.log"

# tmux configuration - auto-detect or override via environment
TMUX_BIN="${TMUX_BIN:-$(command -v tmux)}"
TMUX_SESSION="${TMUX_SESSION:-assistant}"

# Detect tmux socket for launchd compatibility
if [ -z "$TMUX_SOCKET" ]; then
  TMUX_SOCKET="/private/tmp/tmux-$(id -u)/default"
fi

TMUX_CMD="$TMUX_BIN -S $TMUX_SOCKET"

log() {
  mkdir -p "$(dirname "$LOG_FILE")"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if session exists (use explicit socket for launchd compatibility)
if ! $TMUX_CMD has-session -t "$TMUX_SESSION" 2>/dev/null; then
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

$TMUX_CMD send-keys -t "$TMUX_SESSION" -l "$REMINDER"
$TMUX_CMD send-keys -t "$TMUX_SESSION" Enter

log "Reminder sent"
