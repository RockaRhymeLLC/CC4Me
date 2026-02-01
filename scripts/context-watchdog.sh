#!/bin/bash
#
# Context Watchdog
#
# Checks available context and triggers save-state + clear if under threshold.
# Only acts if Claude is idle (not actively working).
# Run via launchd every 2-3 minutes.
#
# Requires: context-monitor-statusline.sh writing context-usage.json via statusLine.

set -e

# Load shared config (provides BASE_DIR, SESSION_NAME, TMUX_CMD, STATE_DIR, etc.)
source "$(cd "$(dirname "$0")" && pwd)/lib/config.sh"

STATE_FILE="$STATE_DIR/context-usage.json"
LOG_FILE="$LOG_DIR/context-watchdog.log"
THRESHOLD=35  # Trigger when remaining_percentage < this value
STALE_SECONDS=300  # Ignore data older than 5 minutes

log() {
  cc4me_log "$1"
}

# 1. Check if context data file exists
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# 2. Check if data is fresh (not stale)
TIMESTAMP=$(/usr/bin/jq -r '.timestamp // 0' "$STATE_FILE" 2>/dev/null)
NOW=$(date +%s)
AGE=$((NOW - TIMESTAMP))

if [ "$AGE" -gt "$STALE_SECONDS" ]; then
  exit 0  # Data too old, Claude might be idle/stopped
fi

# 3. Check context usage
REMAINING=$(/usr/bin/jq -r '.remaining_percentage // 100' "$STATE_FILE" 2>/dev/null)
USED=$(/usr/bin/jq -r '.used_percentage // 0' "$STATE_FILE" 2>/dev/null)

# Compare using awk (bash can't do float comparison natively)
NEEDS_CLEAR=$(awk "BEGIN { print ($REMAINING < $THRESHOLD) ? 1 : 0 }")

if [ "$NEEDS_CLEAR" -ne 1 ]; then
  exit 0  # Plenty of context remaining
fi

log "Context low: ${USED}% used, ${REMAINING}% remaining (threshold: ${THRESHOLD}%)"

# 4. Check if Claude is actively working (not safe to clear)
PANE=$($TMUX_CMD capture-pane -t "$SESSION_NAME" -p 2>/dev/null || echo "")

if echo "$PANE" | grep -q "esc to interrupt"; then
  log "Skipping: Claude is actively working (esc to interrupt visible)"
  exit 0
fi

# Check for spinner characters (unicode spinners = generating)
if echo "$PANE" | grep -qE '[✶✷✸✹✺✻✼✽✾✿❀❁❂❃]'; then
  log "Skipping: Claude is generating (spinner visible)"
  exit 0
fi

# Check if transcript was modified very recently (within 10s = likely mid-response)
# Claude Code stores transcripts in ~/.claude/projects/ using a mangled path
PROJECT_DIR_MANGLED=$(echo "$BASE_DIR" | sed 's|/|-|g')
JSONL=$(ls -t "$HOME/.claude/projects/${PROJECT_DIR_MANGLED}"/*.jsonl 2>/dev/null | head -1)
if [ -n "$JSONL" ]; then
  MOD_TIME=$(stat -f '%m' "$JSONL" 2>/dev/null || echo 0)
  MOD_AGE=$((NOW - MOD_TIME))
  if [ "$MOD_AGE" -lt 10 ]; then
    log "Skipping: Transcript modified ${MOD_AGE}s ago (likely mid-response)"
    exit 0
  fi
fi

# 5. All clear - trigger save-state + clear
log "Triggering save-state + clear (${REMAINING}% remaining)"

# Send save-state command
$TMUX_CMD send-keys -t "$SESSION_NAME" "/save-state \"Auto-save: context at ${USED}% used\"" Enter
log "Sent /save-state"

# Wait for save-state to complete (poll transcript for new lines)
sleep 15

# Verify Claude isn't now busy from the save-state
PANE=$($TMUX_CMD capture-pane -t "$SESSION_NAME" -p 2>/dev/null || echo "")
if echo "$PANE" | grep -q "esc to interrupt"; then
  log "Waiting: save-state still running"
  sleep 15
fi

# Send /clear
$TMUX_CMD send-keys -t "$SESSION_NAME" "/clear" Enter
log "Sent /clear - context reset complete"
