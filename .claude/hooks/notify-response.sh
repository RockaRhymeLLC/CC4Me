#!/bin/bash
# Hook script for PostToolUse + Stop events.
# Reads the hook payload from stdin and notifies the daemon that there's
# a new assistant message to read from the transcript.
#
# Runs async so it doesn't block Claude Code.

# Read payload from stdin
PAYLOAD=$(cat)

# Extract transcript_path from payload if available
TRANSCRIPT_PATH=$(echo "$PAYLOAD" | grep -o '"transcript_path":"[^"]*"' | head -1 | cut -d'"' -f4)

# Notify daemon — fire and forget
if [ -n "$TRANSCRIPT_PATH" ]; then
  curl -s -X POST "http://localhost:3847/hook/response" \
    -H "Content-Type: application/json" \
    -d "{\"transcript_path\":\"$TRANSCRIPT_PATH\"}" \
    --max-time 2 >/dev/null 2>&1 &
else
  curl -s -X POST "http://localhost:3847/hook/response" \
    --max-time 2 >/dev/null 2>&1 &
fi
