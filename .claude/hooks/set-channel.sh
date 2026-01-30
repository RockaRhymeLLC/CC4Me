#!/bin/bash
#
# UserPromptSubmit Hook: Auto-detect channel from message source
# Sets channel to "telegram" if message has [Telegram] prefix, otherwise "terminal"
# Preserves "-verbose" suffix if already set (e.g., telegram-verbose stays verbose)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CHANNEL_FILE="$PROJECT_DIR/.claude/state/channel.txt"

# Read current channel to check for verbose mode
CURRENT=""
if [ -f "$CHANNEL_FILE" ]; then
  CURRENT=$(cat "$CHANNEL_FILE" | tr -d '[:space:]')
fi

# Read the prompt from stdin
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

if [[ "$PROMPT" == "[Telegram]"* ]]; then
  # Keep verbose if already in verbose mode
  if [ "$CURRENT" = "telegram-verbose" ]; then
    echo "telegram-verbose" > "$CHANNEL_FILE"
  else
    echo "telegram" > "$CHANNEL_FILE"
  fi
else
  echo "terminal" > "$CHANNEL_FILE"
fi

exit 0
