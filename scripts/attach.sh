#!/bin/bash

# Attach to BMO's tmux session
#
# Usage: ./attach.sh

SESSION_NAME="bmo"
TMUX="/opt/homebrew/bin/tmux"

if $TMUX has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec $TMUX attach-session -t "$SESSION_NAME"
else
    echo "No active session. Start with: ./scripts/start-tmux.sh"
    exit 1
fi
