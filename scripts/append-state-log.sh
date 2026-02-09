#!/bin/bash
# append-state-log.sh — Appends current assistant-state.md to the 24hr cascade log.
#
# Called by: save-state skill, pre-compact hook, restart skill
#
# Three layers of protection against bloat:
# 1. Time throttle: Skips if last entry was < 15 minutes ago (unless --force)
# 2. Condensing: Extracts key sections, limits each to a few lines
# 3. Content dedup: Skips if condensed content matches last entry (even with --force)
#
# Usage:
#   source scripts/append-state-log.sh && append_state_log [reason]
#   ./scripts/append-state-log.sh [reason]           # direct invocation
#   ./scripts/append-state-log.sh --force [reason]   # skip throttle (still checks content)
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
    # Note: stat -f %m is macOS-specific. GNU/Linux equivalent: stat -c %Y
    last_modified=$(stat -f %m "$LOG_FILE" 2>/dev/null || stat -c %Y "$LOG_FILE" 2>/dev/null || echo 0)
    local now
    now=$(date +%s)
    local age=$(( now - last_modified ))
    local threshold=$(( THROTTLE_MINUTES * 60 ))

    if [ "$age" -lt "$threshold" ]; then
      return 0
    fi
  fi

  # Read and condense current state.
  # Full state stays in assistant-state.md — the 24hr log gets a slim version.
  # Keeps: current task (1 line), completed (5 items), next steps (3),
  # context (3 lines), blockers (2). Drops: open todos (in todo files),
  # notes, follow-ups, verbose metadata.
  local state_content condensed
  state_content=$(cat "$STATE_FILE")
  condensed=$(awk '
    BEGIN { section=""; count=0; limit=3 }
    /^## Current Task/           { section="task";  count=0; limit=1; print; next }
    /^## Completed/              { section="done";  count=0; limit=5; print; next }
    /^## Next Step/              { section="next";  count=0; limit=3; print; next }
    /^## Blocker/                { section="block"; count=0; limit=2; print; next }
    /^## Context/                { section="ctx";   count=0; limit=3; print; next }
    /^## /                       { section="skip";  next }
    /^# /                        { next }
    /^\*\*(Saved|Reason|Session)\*\*/ { next }
    section == "skip"            { next }
    section != "" && /^$/        { next }
    section != "" && count < limit  { print; count++ }
    section != "" && count == limit { section="skip" }
  ' <<< "$state_content")

  # Content dedup: skip if condensed content matches last entry (even with --force).
  # Compares md5 of the condensed "Completed" section (most likely to change).
  if [ -f "$LOG_FILE" ]; then
    local new_hash last_hash
    local new_section
    new_section=$(echo "$condensed" | sed -n '/^## Completed/,/^## /p' | head -10)
    if [ -z "$new_section" ]; then
      new_section="$condensed"
    fi
    new_hash=$(echo "$new_section" | md5 -q 2>/dev/null || echo "$new_section" | md5sum | cut -d' ' -f1)

    # Extract last entry from log: find last ### header, take content after it
    local last_entry
    last_entry=$(awk '
      /^### / { last_start = NR }
      { lines[NR] = $0 }
      END {
        if (last_start) {
          for (i = last_start+1; i <= NR; i++) {
            if (lines[i] != "---") print lines[i]
          }
        }
      }
    ' "$LOG_FILE")

    if [ -n "$last_entry" ]; then
      local last_section
      last_section=$(echo "$last_entry" | sed -n '/^## Completed/,/^## /p' | head -10)
      if [ -z "$last_section" ]; then
        last_section="$last_entry"
      fi
      last_hash=$(echo "$last_section" | md5 -q 2>/dev/null || echo "$last_section" | md5sum | cut -d' ' -f1)

      if [ "$new_hash" = "$last_hash" ]; then
        return 0  # Content unchanged — skip duplicate
      fi
    fi
  fi

  # Build timestamped entry
  local timestamp
  timestamp=$(date "+%Y-%m-%d %H:%M")

  local entry="---
### ${timestamp} — ${reason}

${condensed}

---
"

  # Append to 24hr log
  echo "$entry" >> "$LOG_FILE"
}

# Allow direct invocation
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  append_state_log "$@"
fi
