#!/bin/bash
# append-state-log.sh — Appends current assistant-state.md to the 24hr cascade log.
#
# Called by: save-state skill, pre-compact hook, restart skill
#
# Throttling: Skips append if the last entry was added less than 15 minutes ago,
# unless force flag is set. This prevents near-identical snapshots from piling up
# when the context watchdog fires frequently.
#
# Usage:
#   source scripts/append-state-log.sh && append_state_log [reason]
#   ./scripts/append-state-log.sh [reason]           # direct invocation
#   ./scripts/append-state-log.sh --force [reason]   # skip throttle check
#
# Examples:
#   ./scripts/append-state-log.sh "Auto-save: context at 72% used"
#   ./scripts/append-state-log.sh --force "Pre-compact backup"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_DIR="$PROJECT_DIR/.claude/state"
STATE_FILE="$STATE_DIR/assistant-state.md"
LOG_FILE="$STATE_DIR/memory/summaries/24hr.md"
THROTTLE_MINUTES=15

append_state_log() {
  local force=false
  local reason=""

  # Parse args
  for arg in "$@"; do
    if [ "$arg" = "--force" ]; then
      force=true
    elif [ -z "$reason" ]; then
      reason="$arg"
    fi
  done

  reason="${reason:-State save}"

  # Check state file exists
  if [ ! -f "$STATE_FILE" ]; then
    return 0
  fi

  # Ensure log directory exists
  mkdir -p "$(dirname "$LOG_FILE")"

  # Throttle check: skip if last append was recent
  if [ "$force" = false ] && [ -f "$LOG_FILE" ]; then
    local last_modified
    last_modified=$(stat -f %m "$LOG_FILE" 2>/dev/null || echo 0)
    local now
    now=$(date +%s)
    local age=$(( now - last_modified ))
    local threshold=$(( THROTTLE_MINUTES * 60 ))

    if [ "$age" -lt "$threshold" ]; then
      return 0
    fi
  fi

  # Read current state
  local state_content
  state_content=$(cat "$STATE_FILE")

  # Build timestamped entry
  local timestamp
  timestamp=$(date "+%Y-%m-%d %H:%M")

  local entry="---
### ${timestamp} — ${reason}

${state_content}

---
"

  # Append to 24hr log
  echo "$entry" >> "$LOG_FILE"
}

# Allow direct invocation
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  append_state_log "$@"
fi
