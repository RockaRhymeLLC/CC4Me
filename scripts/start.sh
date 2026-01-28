#!/bin/bash

# CC4Me Startup Script
#
# Launches Claude Code with the custom system prompt.
# Used by both manual startup and launchd service.

set -e

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Change to project directory
cd "$PROJECT_DIR"

# System prompt file location
SYSTEM_PROMPT_FILE=".claude/state/system-prompt.txt"

# Build claude command
CLAUDE_CMD="claude"

# Add system prompt if it exists
if [ -f "$SYSTEM_PROMPT_FILE" ]; then
    SYSTEM_PROMPT=$(cat "$SYSTEM_PROMPT_FILE")
    CLAUDE_CMD="$CLAUDE_CMD --append-system-prompt \"$SYSTEM_PROMPT\""
fi

# Add any additional arguments passed to this script
if [ $# -gt 0 ]; then
    CLAUDE_CMD="$CLAUDE_CMD $@"
fi

# Execute
eval $CLAUDE_CMD
