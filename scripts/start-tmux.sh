#!/bin/bash

# CC4Me Tmux Startup Script
#
# Starts Claude Code in a persistent tmux session with auto-prompt.
# The session survives terminal close and system sleep.
# On startup, Claude automatically checks for pending work.
#
# Usage:
#   ./start-tmux.sh          # Start new session or attach to existing
#   ./start-tmux.sh --detach # Start detached (for launchd)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SESSION_NAME="bmo"
TMUX="/opt/homebrew/bin/tmux"

# Auto-prompt sent to Claude on fresh start
AUTO_PROMPT="Session auto-started. Check todos, calendar, and any saved state. Work on pending tasks autonomously."

# Check if session already exists
if $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    if [[ "$1" == "--detach" ]]; then
        echo "Session '$SESSION_NAME' already running"
        exit 0
    else
        # Attach to existing session
        exec $TMUX attach-session -t "$SESSION_NAME"
    fi
fi

# Build the claude command (fresh session, not --continue to avoid conflicts)
CLAUDE_CMD="'$PROJECT_DIR/scripts/start.sh'"

if [[ "$1" == "--detach" ]]; then
    # Start detached session (for launchd)
    $TMUX new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR" "$CLAUDE_CMD"

    # Wait for Claude to initialize, then send auto-prompt
    sleep 8
    $TMUX send-keys -t "$SESSION_NAME" "$AUTO_PROMPT"
    sleep 1
    $TMUX send-keys -t "$SESSION_NAME" Enter

    echo "Started session '$SESSION_NAME' (detached, auto-prompted)"
else
    # Start and attach interactively (no auto-prompt)
    exec $TMUX new-session -s "$SESSION_NAME" -c "$PROJECT_DIR" "$CLAUDE_CMD"
fi
