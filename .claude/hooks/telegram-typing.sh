#!/bin/bash
#
# PreToolUse Hook: Refresh typing indicator
# Sends typing indicator before long-running tools to show BMO is still working

BASE_DIR="/Users/bmo/CC4Me-BMO"
PENDING_FILE="$BASE_DIR/.claude/state/telegram-pending.json"
TELEGRAM_SEND="$BASE_DIR/scripts/telegram-send.sh"

# Only run if there's a pending Telegram message
if [ ! -f "$PENDING_FILE" ]; then
  exit 0
fi

# Read the tool name from stdin (hook input is JSON)
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | /usr/bin/jq -r '.tool_name // empty')

# Only refresh for long-running tools
case "$TOOL_NAME" in
  Bash|Task|WebFetch|WebSearch)
    "$TELEGRAM_SEND" typing 2>/dev/null || true
    ;;
esac

exit 0
