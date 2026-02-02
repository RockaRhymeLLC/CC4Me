#!/bin/bash

# CC4Me Restart Script
#
# Restarts the CC4Me tmux session. Can be called:
# - Manually from another terminal
# - By the restart-watcher launchd service
# - After saving state (self-restart)

set -e

# Source shared config
source "$(dirname "${BASH_SOURCE[0]}")/lib/config.sh"

if [ -z "$TMUX_BIN" ]; then
    echo "Error: tmux not found. Install with: brew install tmux" >&2
    exit 1
fi

RESTART_FLAG="$STATE_DIR/restart-requested"

# Clear restart flag if it exists
rm -f "$RESTART_FLAG"

# Kill existing session if running
if session_exists; then
    cc4me_log "Killing existing session '$SESSION_NAME'..."
    $TMUX_CMD kill-session -t "$SESSION_NAME"
    sleep 2
fi

# Start fresh session (detached with auto-prompt)
cc4me_log "Starting fresh session..."
"$SCRIPTS_DIR/start-tmux.sh" --detach

cc4me_log "Restart complete. Session '$SESSION_NAME' is running."
echo "Attach with: $TMUX_BIN attach -t $SESSION_NAME"
