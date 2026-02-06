#!/bin/bash
#
# UserPromptSubmit Hook: Auto-detect channel from message source
# Sets channel to "telegram" if message has [Telegram] prefix, otherwise "terminal"
# Preserves "-verbose" suffix if already set (e.g., telegram-verbose stays verbose)
# Preserves current channel for auto-injected prompts (session restore, hooks, etc.)

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHANNEL_FILE="$BASE_DIR/.claude/state/channel.txt"

# Read current channel to check for verbose mode
CURRENT=""
if [ -f "$CHANNEL_FILE" ]; then
  CURRENT=$(cat "$CHANNEL_FILE" | tr -d '[:space:]')
fi

# Read the prompt from stdin
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | /usr/bin/jq -r '.prompt // empty')

if [[ "$PROMPT" == "[Telegram]"* ]] || [[ "$PROMPT" == "[Voice]"* ]]; then
  # Keep verbose if already in verbose mode
  if [ "$CURRENT" = "telegram-verbose" ]; then
    echo "telegram-verbose" > "$CHANNEL_FILE"
  else
    echo "telegram" > "$CHANNEL_FILE"
  fi
elif [[ "$PROMPT" == "Session cleared"* ]] || \
     [[ "$PROMPT" == "/save-state"* ]] || \
     [[ "$PROMPT" == "/clear"* ]] || \
     [[ "$PROMPT" == "/restart"* ]] || \
     [[ -z "$PROMPT" ]]; then
  # Auto-injected system prompts — preserve current channel
  # Don't reset to terminal just because a hook/watchdog triggered a prompt
  :
else
  echo "terminal" > "$CHANNEL_FILE"
fi

exit 0
