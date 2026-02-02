#!/bin/bash

# CC4Me Tmux Startup Script
#
# Starts Claude Code in a persistent tmux session with auto-prompt.
# The session survives terminal close and system sleep.
# On startup, Claude automatically checks for pending work.
#
# Usage:
#   ./start-tmux.sh                    # Start new session or attach to existing
#   ./start-tmux.sh --detach           # Start detached (for launchd)
#   ./start-tmux.sh --skip-permissions # Skip Claude's permission prompts

set -e

# Source shared config
source "$(dirname "${BASH_SOURCE[0]}")/lib/config.sh"

if [ -z "$TMUX_BIN" ]; then
    echo "Error: tmux not found. Install with: brew install tmux" >&2
    exit 1
fi

# Parse arguments
DETACH=false
SKIP_PERMISSIONS=false

for arg in "$@"; do
    case "$arg" in
        --detach) DETACH=true ;;
        --skip-permissions) SKIP_PERMISSIONS=true ;;
        *) echo "Unknown argument: $arg" >&2; exit 1 ;;
    esac
done

# Auto-prompt sent to Claude on fresh start
AUTO_PROMPT="Session auto-started. Check todos, calendar, and any saved state. Work on pending tasks autonomously."

# Check if session already exists
if session_exists; then
    if $DETACH; then
        echo "Session '$SESSION_NAME' already running"
        exit 0
    else
        # Attach to existing session
        exec $TMUX_CMD attach-session -t "$SESSION_NAME"
    fi
fi

# Build the claude command
CLAUDE_CMD="'$BASE_DIR/scripts/start.sh'"
if $SKIP_PERMISSIONS; then
    CLAUDE_CMD="'$BASE_DIR/scripts/start.sh' --dangerously-skip-permissions"
fi

if $DETACH; then
    # Start detached session (for launchd)
    $TMUX_CMD new-session -d -s "$SESSION_NAME" -c "$BASE_DIR" "$CLAUDE_CMD"

    # Wait for Claude to initialize, then send auto-prompt
    sleep 8
    $TMUX_CMD send-keys -t "$SESSION_NAME" "$AUTO_PROMPT"
    sleep 1
    $TMUX_CMD send-keys -t "$SESSION_NAME" Enter

    echo "Started session '$SESSION_NAME' (detached, auto-prompted)"
else
    # Start and attach interactively (no auto-prompt)
    exec $TMUX_CMD new-session -s "$SESSION_NAME" -c "$BASE_DIR" "$CLAUDE_CMD"
fi
