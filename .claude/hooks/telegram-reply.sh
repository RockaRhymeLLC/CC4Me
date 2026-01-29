#!/bin/bash
#
# Stop Hook: Send response to Telegram
# Triggered when Claude finishes responding. If there's a pending Telegram message,
# extract the response from the transcript and send it back.

set -e

BASE_DIR="/Users/bmo/CC4Me-BMO"
STATE_DIR="$BASE_DIR/.claude/state"
PENDING_FILE="$STATE_DIR/telegram-pending.json"
LOG_FILE="$BASE_DIR/logs/telegram-hook.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if there's a pending Telegram message
if [ ! -f "$PENDING_FILE" ]; then
  exit 0
fi

# Read pending info
CHAT_ID=$(cat "$PENDING_FILE" | /usr/bin/jq -r '.chatId')
TIMESTAMP=$(cat "$PENDING_FILE" | /usr/bin/jq -r '.timestamp')

if [ -z "$CHAT_ID" ] || [ "$CHAT_ID" = "null" ]; then
  log "No valid chat ID in pending file"
  rm -f "$PENDING_FILE"
  exit 0
fi

# Check if pending is stale (older than 5 minutes)
NOW=$(date +%s)
PENDING_AGE=$(( (NOW * 1000 - TIMESTAMP) / 1000 ))
if [ "$PENDING_AGE" -gt 300 ]; then
  log "Pending message is stale ($PENDING_AGE seconds old), ignoring"
  rm -f "$PENDING_FILE"
  exit 0
fi

# Read hook input from stdin to get transcript path
INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | /usr/bin/jq -r '.transcript_path')

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  log "No transcript file found: $TRANSCRIPT_PATH"
  rm -f "$PENDING_FILE"
  exit 0
fi

# Extract the last assistant message that has text content
# The transcript is JSONL - each line is a JSON object
# We want the last assistant message that contains a text block (not just tool_use or thinking)
RESPONSE=$(/usr/bin/jq -s '
  [.[] | select(.type == "assistant") |
   select(.message.content | map(select(.type == "text")) | length > 0)] |
  last |
  [.message.content[] | select(.type == "text") | .text] | join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null)

# Remove surrounding quotes from jq output
RESPONSE=$(echo "$RESPONSE" | sed 's/^"//;s/"$//')

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ] || [ "$RESPONSE" = "" ]; then
  log "No assistant response found in transcript"
  rm -f "$PENDING_FILE"
  exit 0
fi

# Unescape JSON string
RESPONSE=$(echo -e "$RESPONSE")

# Truncate if too long (Telegram limit is 4096)
if [ ${#RESPONSE} -gt 4000 ]; then
  RESPONSE="${RESPONSE:0:4000}..."
fi

# Get bot token from Keychain
BOT_TOKEN=$(security find-generic-password -s "credential-telegram-bot" -w 2>/dev/null)

if [ -z "$BOT_TOKEN" ]; then
  log "Could not retrieve bot token from Keychain"
  rm -f "$PENDING_FILE"
  exit 1
fi

# Send to Telegram
log "Sending response to chat $CHAT_ID (${#RESPONSE} chars)"

RESULT=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$(echo '{}' | /usr/bin/jq --arg chat_id "$CHAT_ID" --arg text "$RESPONSE" \
    '{chat_id: $chat_id, text: $text}')")

if echo "$RESULT" | /usr/bin/jq -e '.ok' > /dev/null 2>&1; then
  log "✅ Sent successfully"
else
  log "❌ Failed to send: $RESULT"
fi

# Clear pending file
rm -f "$PENDING_FILE"

exit 0
