#!/bin/bash

# CC4Me Restart Script
#
# Restarts the CC4Me tmux session. Can be called:
# - Manually from another terminal
# - By the restart-watcher launchd service
# - After saving state (self-restart)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load shared config (provides SESSION_NAME, TMUX_BIN, etc.)
BASE_DIR="$PROJECT_DIR"
source "$SCRIPT_DIR/lib/config.sh"

TMUX="$TMUX_BIN"
if [ -z "$TMUX" ]; then
    echo "Error: tmux not found. Install with: brew install tmux" >&2
    exit 1
fi

RESTART_FLAG="$PROJECT_DIR/.claude/state/restart-requested"

# Clear restart flag if it exists
rm -f "$RESTART_FLAG"

# Kill existing session if running
if $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Killing existing session '$SESSION_NAME'..."
    $TMUX kill-session -t "$SESSION_NAME"
    sleep 2
fi

# Start fresh session (detached with auto-prompt)
echo "Starting fresh session..."
"$SCRIPT_DIR/start-tmux.sh" --detach

echo "Restart complete. Session '$SESSION_NAME' is running."
echo "Attach with: tmux attach -t $SESSION_NAME"
