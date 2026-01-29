#!/bin/bash
#
# Transcript Watcher
# Tails the transcript file and sends assistant text responses to the current channel.
#
# Channel modes:
#   terminal          - no external sending (default)
#   telegram          - send text responses to Telegram (no thinking)
#   telegram-verbose  - send text + thinking blocks to Telegram
#   silent            - no sending anywhere
#
# Usage: ./transcript-watcher.sh <transcript_path>

set -e

TRANSCRIPT_PATH="$1"
BASE_DIR="/Users/bmo/CC4Me-BMO"
CHANNEL_FILE="$BASE_DIR/.claude/state/channel.txt"
LOG_FILE="$BASE_DIR/logs/watcher.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

send_telegram() {
  local text="$1"
  local chat_id="7629737488"  # Dave's chat ID from memory

  # Get bot token
  local token=$(security find-generic-password -s "credential-telegram-bot" -w 2>/dev/null)
  if [ -z "$token" ]; then
    log "ERROR: No bot token"
    return 1
  fi

  # Truncate if too long
  if [ ${#text} -gt 4000 ]; then
    text="${text:0:4000}..."
  fi

  # Send
  curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "$(/usr/bin/jq -n --arg chat_id "$chat_id" --arg text "$text" \
      '{chat_id: $chat_id, text: $text}')" > /dev/null

  log "Sent to Telegram (${#text} chars)"
}

get_channel() {
  if [ -f "$CHANNEL_FILE" ]; then
    cat "$CHANNEL_FILE" | tr -d '[:space:]'
  else
    echo "terminal"
  fi
}

process_line() {
  local line="$1"

  # Parse JSON - check if it's an assistant message
  local msg_type=$(/usr/bin/jq -r '.type // empty' <<< "$line" 2>/dev/null)

  if [ "$msg_type" != "assistant" ]; then
    return
  fi

  # Check channel first (avoid unnecessary parsing)
  local channel=$(get_channel)

  case "$channel" in
    terminal|silent)
      return
      ;;
  esac

  # Extract text content (non-thinking)
  local text=$(/usr/bin/jq -r '
    [.message.content[]? | select(.type == "text") | .text // empty] | join("\n")
  ' <<< "$line" 2>/dev/null)

  # Extract thinking content (for verbose mode)
  local thinking=""
  if [ "$channel" = "telegram-verbose" ]; then
    thinking=$(/usr/bin/jq -r '
      [.message.content[]? | select(.type == "thinking") | .thinking // empty] | join("\n")
    ' <<< "$line" 2>/dev/null)
  fi

  # Send thinking first if in verbose mode
  if [ -n "$thinking" ] && [ "$thinking" != "null" ]; then
    log "New thinking block, channel=$channel"
    send_telegram "<thinking>
$thinking
</thinking>"
  fi

  # Send text response
  if [ -n "$text" ] && [ "$text" != "null" ]; then
    log "New assistant text, channel=$channel"
    send_telegram "$text"
  fi
}

# Main
if [ -z "$TRANSCRIPT_PATH" ]; then
  echo "Usage: $0 <transcript_path>"
  exit 1
fi

if [ ! -f "$TRANSCRIPT_PATH" ]; then
  echo "Transcript not found: $TRANSCRIPT_PATH"
  exit 1
fi

log "Starting watcher for: $TRANSCRIPT_PATH"

# Tail the file, processing new lines
tail -n 0 -f "$TRANSCRIPT_PATH" | while read -r line; do
  process_line "$line"
done
