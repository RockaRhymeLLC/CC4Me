#!/bin/bash

# CC4Me Shared Configuration
#
# Source this from any CC4Me script:
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/config.sh"
#
# Reads from cc4me.config.yaml (single source of truth).
# Environment variables override YAML values.
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

CONFIG_FILE="$BASE_DIR/cc4me.config.yaml"

# Read a simple value from cc4me.config.yaml (handles "key: value" lines)
# Falls back gracefully if yq isn't available or config doesn't exist
_yaml_get() {
    local key="$1"
    local default="$2"

    if [ ! -f "$CONFIG_FILE" ]; then
        echo "$default"
        return
    fi

    # Try yq first (handles nested keys properly)
    if command -v yq >/dev/null 2>&1; then
        local val
        val=$(yq -r "$key // empty" "$CONFIG_FILE" 2>/dev/null)
        if [ -n "$val" ] && [ "$val" != "null" ]; then
            echo "$val"
            return
        fi
    fi

    # Fallback: grep for simple top-level or one-level-deep keys
    # Converts dotted key like ".tmux.session" to match YAML structure
    local leaf="${key##*.}"
    local val
    val=$(grep -E "^[[:space:]]*${leaf}:" "$CONFIG_FILE" 2>/dev/null | head -1 | sed 's/^[^:]*:[[:space:]]*//' | sed 's/[[:space:]]*#.*//' | sed 's/^["'"'"']//' | sed 's/["'"'"']$//')
    if [ -n "$val" ]; then
        echo "$val"
    else
        echo "$default"
    fi
}

# Session name: env override > config > directory name
SESSION_NAME="${CC4ME_SESSION:-$(_yaml_get '.tmux.session' "$(basename "$BASE_DIR")")}"

# Find tmux binary
if [ -x /opt/homebrew/bin/tmux ]; then
    TMUX_BIN=/opt/homebrew/bin/tmux
elif command -v tmux >/dev/null 2>&1; then
    TMUX_BIN=$(command -v tmux)
else
    TMUX_BIN=""
fi

# tmux socket: env override > config > system default
_YAML_SOCKET="$(_yaml_get '.tmux.socket' '')"
TMUX_SOCKET="${CC4ME_TMUX_SOCKET:-$_YAML_SOCKET}"

if [ -n "$TMUX_SOCKET" ]; then
    TMUX_CMD="$TMUX_BIN -S $TMUX_SOCKET"
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
