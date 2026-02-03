#!/bin/bash
# Hook script for PostToolUse + Stop + SubagentStop events.
# Reads the hook payload from stdin and notifies the daemon that there's
# a new assistant message to read from the transcript.
#
# Also checks for context-watchdog flags:
# - context-save-pending: Injects /save-state, upgrades to clear-pending
# - context-clear-pending: Injects /clear (or falls back to restart)
#
# This approach solves the problem of /clear getting queued as a text
# message when injected during a blocking tool call. The Stop hook fires
# when Claude is BETWEEN operations — the right moment to act.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/.claude/state"
TMUX_BIN="/opt/homebrew/bin/tmux"
TMUX_SOCKET="/private/tmp/tmux-$(id -u)/default"
TMUX_CMD="$TMUX_BIN -S $TMUX_SOCKET"

# Read payload from stdin
PAYLOAD=$(cat)

# Extract transcript_path from payload if available
TRANSCRIPT_PATH=$(echo "$PAYLOAD" | grep -o '"transcript_path":"[^"]*"' | head -1 | cut -d'"' -f4)

# Extract hook_event_name from payload (e.g., "Stop", "SubagentStop", "PostToolUse")
HOOK_EVENT=$(echo "$PAYLOAD" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Build the JSON body
BODY="{}"
if [ -n "$TRANSCRIPT_PATH" ] && [ -n "$HOOK_EVENT" ]; then
  BODY="{\"transcript_path\":\"$TRANSCRIPT_PATH\",\"hook_event\":\"$HOOK_EVENT\"}"
elif [ -n "$TRANSCRIPT_PATH" ]; then
  BODY="{\"transcript_path\":\"$TRANSCRIPT_PATH\"}"
elif [ -n "$HOOK_EVENT" ]; then
  BODY="{\"hook_event\":\"$HOOK_EVENT\"}"
fi

# Notify daemon — synchronous (background curl gets killed on hook exit)
curl -s -X POST "http://localhost:3847/hook/response" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  --max-time 2 >/dev/null 2>&1

# --- Context watchdog flag processing ---
# Only process on Stop events (not PostToolUse — we want to wait until
# Claude is fully done, not between individual tool calls).
if [ "$HOOK_EVENT" = "Stop" ] || [ "$HOOK_EVENT" = "SubagentStop" ]; then

  SAVE_FLAG="$STATE_DIR/context-save-pending"
  CLEAR_FLAG="$STATE_DIR/context-clear-pending"

  # Get tmux session name from config
  SESSION_NAME=$(grep -A1 '^tmux:' "$PROJECT_DIR/cc4me.config.yaml" 2>/dev/null | grep 'session:' | sed 's/.*session:[[:space:]]*//' | tr -d '"' | tr -d "'")
  SESSION_NAME="${SESSION_NAME:-cc4me}"

  if [ -f "$CLEAR_FLAG" ]; then
    # Clear is pending — save-state already ran, inject /clear now.
    rm -f "$CLEAR_FLAG"
    rm -f "$SAVE_FLAG"

    # Small delay to let Claude finish writing
    sleep 0.5

    $TMUX_CMD send-keys -t "$SESSION_NAME" -l '/clear'
    sleep 0.1
    $TMUX_CMD send-keys -t "$SESSION_NAME" Enter

  elif [ -f "$SAVE_FLAG" ]; then
    # Save is pending — inject /save-state, then upgrade flag to clear-pending.

    # Read context info from the flag file before deleting
    USED=$(cat "$SAVE_FLAG" 2>/dev/null | grep -o '"used":[0-9]*' | cut -d: -f2)
    USED="${USED:-unknown}"
    rm -f "$SAVE_FLAG"

    # Small delay to let Claude finish writing
    sleep 0.5

    # Inject /save-state
    $TMUX_CMD send-keys -t "$SESSION_NAME" -l "/save-state \"Auto-save: context at ${USED}% used\""
    sleep 0.1
    $TMUX_CMD send-keys -t "$SESSION_NAME" Enter

    # Set clear-pending — next Stop event will inject /clear
    echo '{"pending":"clear"}' > "$CLEAR_FLAG"
  fi
fi
