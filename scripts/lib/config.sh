#!/bin/bash
#
# CC4Me Shared Configuration
#
# Source this file from any CC4Me script to get consistent paths and settings.
# All scripts that interact with tmux sessions should use these values.
#
# Usage:
#   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   source "$SCRIPT_DIR/../lib/config.sh"   # from scripts/
#   source "$SCRIPT_DIR/lib/config.sh"       # from project root
#
# Provides:
#   BASE_DIR       - Project root directory
#   SESSION_NAME   - tmux session name (from CC4ME_SESSION or directory name)
#   TMUX_BIN       - Path to tmux binary
#   TMUX_SOCKET    - Path to tmux socket (for launchd compatibility)
#   TMUX_CMD       - Full tmux command with socket (e.g., "/opt/homebrew/bin/tmux -S /path/to/socket")
#   STATE_DIR      - Path to .claude/state/
#   LOG_DIR        - Path to logs/

# Resolve project root if not already set
if [ -z "$BASE_DIR" ]; then
  # Walk up from this file: scripts/lib/config.sh -> scripts/lib -> scripts -> project root
  BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

# Session name: env var > directory name
SESSION_NAME="${CC4ME_SESSION:-$(basename "$BASE_DIR")}"

# Find tmux binary
if [ -n "$TMUX_BIN" ]; then
  : # Already set via environment
elif [ -x /opt/homebrew/bin/tmux ]; then
  TMUX_BIN="/opt/homebrew/bin/tmux"
elif command -v tmux >/dev/null 2>&1; then
  TMUX_BIN="$(command -v tmux)"
fi

# tmux socket path (explicit for launchd compatibility)
if [ -z "$TMUX_SOCKET" ]; then
  TMUX_SOCKET="/private/tmp/tmux-$(id -u)/default"
fi

# Full tmux command with socket
TMUX_CMD="$TMUX_BIN -S $TMUX_SOCKET"

# Common directories
STATE_DIR="$BASE_DIR/.claude/state"
LOG_DIR="$BASE_DIR/logs"

# Helper: check if tmux session exists
session_exists() {
  $TMUX_CMD has-session -t "$SESSION_NAME" 2>/dev/null
}

# Helper: create timestamped log entry
cc4me_log() {
  local log_file="${LOG_FILE:-$LOG_DIR/cc4me.log}"
  mkdir -p "$(dirname "$log_file")"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$log_file"
}
