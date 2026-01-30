#!/bin/bash

# CC4Me Restart Watcher
#
# Monitors for restart-requested flag and triggers restart.
# Run as a background process via launchd.
#
# Usage:
#   ./restart-watcher.sh          # Run in foreground
#   launchd plist recommended for production use

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESTART_FLAG="$PROJECT_DIR/.claude/state/restart-requested"
LOG="$PROJECT_DIR/logs/restart-watcher.log"

mkdir -p "$(dirname "$LOG")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

log "Restart watcher started"

while true; do
    if [ -f "$RESTART_FLAG" ]; then
        log "Restart flag detected, triggering restart..."
        "$SCRIPT_DIR/restart.sh" >> "$LOG" 2>&1
        log "Restart complete"
    fi
    sleep 5
done
