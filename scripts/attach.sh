#!/bin/bash

# CC4Me Tmux Attach Script
#
# Attach to the running CC4Me tmux session.
#
# Usage: ./attach.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Session name defaults to directory name, override via CC4ME_SESSION
SESSION_NAME="${CC4ME_SESSION:-$(basename "$PROJECT_DIR")}"

# Find tmux - prefer Homebrew, fall back to PATH
if [ -x /opt/homebrew/bin/tmux ]; then
    TMUX=/opt/homebrew/bin/tmux
elif command -v tmux >/dev/null 2>&1; then
    TMUX=$(command -v tmux)
else
    echo "Error: tmux not found. Install with: brew install tmux" >&2
    exit 1
fi

if $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec $TMUX attach-session -t "$SESSION_NAME"
else
    echo "No active session '$SESSION_NAME'. Start with: ./scripts/start-tmux.sh"
    exit 1
fi
