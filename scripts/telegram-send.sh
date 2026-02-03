#!/bin/bash
#
# Telegram Send Utility
# Usage:
#   telegram-send.sh typing                        # Send typing indicator
#   telegram-send.sh "message text"                # Send a message (chat ID from pending/env)
#   telegram-send.sh "chat_id" "message text"      # Send a message to specific chat ID
#
# Chat ID resolution order:
#   1. First argument (if two arguments provided)
#   2. TELEGRAM_CHAT_ID environment variable
#   3. telegram-pending.json file

set -e

# Resolve project directory (parent of scripts/)
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$BASE_DIR/.claude/state"
PENDING_FILE="$STATE_DIR/telegram-pending.json"

# Get bot token from Keychain
BOT_TOKEN=$(security find-generic-password -s "credential-telegram-bot" -w 2>/dev/null)

if [ -z "$BOT_TOKEN" ]; then
  echo "Error: Could not retrieve bot token from Keychain" >&2
  exit 1
fi

# If two arguments provided, first is chat ID, second is message
if [ $# -eq 2 ]; then
  CHAT_ID="$1"
  ACTION="$2"
else
  ACTION="$1"
  # Get chat ID from environment or pending file
  if [ -n "$TELEGRAM_CHAT_ID" ]; then
    CHAT_ID="$TELEGRAM_CHAT_ID"
  elif [ -f "$PENDING_FILE" ]; then
    CHAT_ID=$(/usr/bin/jq -r '.chatId' "$PENDING_FILE" 2>/dev/null)
  fi
fi

if [ -z "$CHAT_ID" ] || [ "$CHAT_ID" = "null" ]; then
  echo "Error: No chat ID available" >&2
  exit 1
fi

if [ "$ACTION" = "typing" ]; then
  # Send typing indicator
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": $CHAT_ID, \"action\": \"typing\"}" > /dev/null
elif [ -n "$ACTION" ]; then
  # Send message
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "$(/usr/bin/jq -n --arg chat_id "$CHAT_ID" --arg text "$ACTION" \
      '{chat_id: $chat_id, text: $text}')" > /dev/null
else
  echo "Usage: telegram-send.sh typing | telegram-send.sh \"message\"" >&2
  exit 1
fi
