#!/bin/bash

# CC4Me Shared Configuration
#
# Source this from any CC4Me script:
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/config.sh"
#
# Provides:
#   BASE_DIR      - Project root directory
#   SESSION_NAME  - tmux session name
#   TMUX_BIN      - Path to tmux binary
#   TMUX_CMD      - Full tmux command (with socket if needed)
#   STATE_DIR     - .claude/state directory
#   LOG_DIR       - logs directory
#   session_exists()  - Check if tmux session is running
#   cc4me_log()       - Log with timestamp

# Resolve project root (two levels up from lib/)
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(dirname "$LIB_DIR")"
BASE_DIR="$(dirname "$SCRIPTS_DIR")"

# Session name: env override > directory name
SESSION_NAME="${CC4ME_SESSION:-$(basename "$BASE_DIR")}"

# Find tmux binary
if [ -x /opt/homebrew/bin/tmux ]; then
    TMUX_BIN=/opt/homebrew/bin/tmux
elif command -v tmux >/dev/null 2>&1; then
    TMUX_BIN=$(command -v tmux)
else
    TMUX_BIN=""
fi

# tmux socket (use default unless CC4ME_TMUX_SOCKET is set)
if [ -n "${CC4ME_TMUX_SOCKET:-}" ]; then
    TMUX_CMD="$TMUX_BIN -S $CC4ME_TMUX_SOCKET"
else
    TMUX_CMD="$TMUX_BIN"
fi

# Standard directories
STATE_DIR="$BASE_DIR/.claude/state"
LOG_DIR="$BASE_DIR/logs"

# Check if the CC4Me tmux session exists
session_exists() {
    [ -n "$TMUX_BIN" ] && $TMUX_CMD has-session -t "$SESSION_NAME" 2>/dev/null
}

# Log with timestamp
cc4me_log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}
