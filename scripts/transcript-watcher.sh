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

# Resolve project directory (parent of scripts/)
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHANNEL_FILE="$BASE_DIR/.claude/state/channel.txt"
LOG_FILE="$BASE_DIR/logs/watcher.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

send_telegram() {
  local text="$1"

  # Get chat ID from safe-senders or environment
  local chat_id="${TELEGRAM_CHAT_ID:-}"
  if [ -z "$chat_id" ]; then
    local safe_senders_file="$BASE_DIR/.claude/state/safe-senders.json"
    if [ -f "$safe_senders_file" ]; then
      chat_id=$(/usr/bin/jq -r '.telegram.users[0] // empty' "$safe_senders_file" 2>/dev/null)
    fi
  fi

  if [ -z "$chat_id" ]; then
    log "ERROR: No chat ID available (set TELEGRAM_CHAT_ID or configure safe-senders.json)"
    return 1
  fi

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

  # Send text response (skip empty, whitespace-only, and placeholder messages)
  local trimmed=$(echo "$text" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -n "$trimmed" ] && [ "$trimmed" != "null" ] && [ "$trimmed" != "(no content)" ]; then
    log "New assistant text, channel=$channel"
    send_telegram "$text"
  fi
}

# Find the newest transcript file in the directory
get_newest_transcript() {
  local dir="$1"
  ls -t "$dir"/*.jsonl 2>/dev/null | head -1
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

TRANSCRIPT_DIR=$(dirname "$TRANSCRIPT_PATH")
NEW_FILE_CHECK_INTERVAL=10  # seconds between checking for newer transcripts
current_file="$TRANSCRIPT_PATH"
lines_seen=$(wc -l < "$current_file" 2>/dev/null | tr -d ' ')
check_timer=0

log "Starting watcher for: $current_file"

while true; do
  # Check for new lines in the current transcript
  current_lines=$(wc -l < "$current_file" 2>/dev/null | tr -d ' ')

  if [ "$current_lines" -gt "$lines_seen" ] 2>/dev/null; then
    new_count=$((current_lines - lines_seen))
    tail -n "$new_count" "$current_file" | while IFS= read -r line; do
      process_line "$line"
    done
    lines_seen=$current_lines
  elif [ "$current_lines" -lt "$lines_seen" ] 2>/dev/null; then
    # File was truncated or replaced -- reset
    log "File shrank (truncated?), resetting line count"
    lines_seen=$current_lines
  fi

  # Periodically check for a newer transcript file
  check_timer=$((check_timer + 1))
  if [ "$check_timer" -ge "$NEW_FILE_CHECK_INTERVAL" ]; then
    check_timer=0
    newest=$(get_newest_transcript "$TRANSCRIPT_DIR")
    if [ -n "$newest" ] && [ "$newest" != "$current_file" ]; then
      log "Newer transcript found: $(basename "$newest"), switching..."
      current_file="$newest"
      lines_seen=$(wc -l < "$current_file" 2>/dev/null | tr -d ' ')
      log "Now watching: $(basename "$current_file") (from line $lines_seen)"
    fi
  fi

  sleep 1
done
