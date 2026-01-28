#!/bin/bash

# CC4Me Tmux Startup Script
#
# Starts Claude Code in a persistent tmux session.
# The session survives terminal close and system sleep.
#
# Usage:
#   ./start-tmux.sh          # Start new session or attach to existing
#   ./start-tmux.sh --detach # Start detached (for launchd)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SESSION_NAME="bmo"
TMUX="/opt/homebrew/bin/tmux"

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

# Build the claude command
CLAUDE_CMD="cd '$PROJECT_DIR' && '$PROJECT_DIR/scripts/start.sh'"

if [[ "$1" == "--detach" ]]; then
    # Start detached session (for launchd)
    $TMUX new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR" "$CLAUDE_CMD"
    echo "Started session '$SESSION_NAME' (detached)"
else
    # Start and attach interactively
    exec $TMUX new-session -s "$SESSION_NAME" -c "$PROJECT_DIR" "$CLAUDE_CMD"
fi
