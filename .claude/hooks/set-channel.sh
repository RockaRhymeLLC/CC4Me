#!/bin/bash
#
# UserPromptSubmit Hook: Auto-detect channel from message source
# Sets channel to "telegram" if message has [Telegram] prefix, otherwise "terminal"
# Preserves "-verbose" suffix if already set (e.g., telegram-verbose stays verbose)

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
else
  echo "terminal" > "$CHANNEL_FILE"
fi

# Opportunistic backup notification — the previous turn's response
# should be in the transcript by now. Background so it doesn't block.
curl -s -X POST "http://localhost:3847/hook/response" \
  -H "Content-Type: application/json" \
  -d '{"hook_event":"UserPromptSubmit"}' \
  --max-time 2 >/dev/null 2>&1 &

exit 0
