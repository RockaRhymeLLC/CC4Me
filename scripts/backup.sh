#!/bin/bash
# Weekly backup of CC4Me-BMO to ~/Documents/backups/
# Scheduled via launchd. Keeps max 2 backups, deletes oldest.

set -euo pipefail

PROJECT_DIR="$HOME/CC4Me-BMO"
BACKUP_DIR="$HOME/Documents/backups"
LOG_FILE="$HOME/.cc4me-backup.log"
LOCKFILE="/tmp/cc4me-backup.lock"
MAX_BACKUPS=2
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="cc4me-backup-${TIMESTAMP}"
BACKUP_ZIP="${BACKUP_DIR}/${BACKUP_NAME}.zip"
BACKUP_TMP="${BACKUP_DIR}/${BACKUP_NAME}.zip.tmp"

# Redirect all output to log
exec >> "$LOG_FILE" 2>&1

echo "========================================="
echo "$(date): Backup starting"

# Lockfile guard
if [ -f "$LOCKFILE" ]; then
  echo "$(date): Backup already running, skipping"
  exit 0
fi
trap "rm -f $LOCKFILE" EXIT
touch "$LOCKFILE"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Create zip, excluding large/regenerable content
cd "$(dirname "$PROJECT_DIR")"
zip -r -q "$BACKUP_TMP" "$(basename "$PROJECT_DIR")" \
  -x '*/node_modules/*' \
  -x '*/.venv/*' \
  -x '*/.git/*' \
  -x '*/logs/*' \
  -x '*/models/*' \
  -x '*/.playwright-mcp/*' \
  -x '*.onnx' \
  -x '*/daemon/dist/*'

# Verify zip integrity
if ! unzip -t "$BACKUP_TMP" > /dev/null 2>&1; then
  echo "$(date): ERROR — zip verification failed, aborting"
  rm -f "$BACKUP_TMP"
  exit 1
fi

# Size sanity check (should be at least 1MB)
BACKUP_SIZE=$(stat -f%z "$BACKUP_TMP")
if [ "$BACKUP_SIZE" -lt 1000000 ]; then
  echo "$(date): ERROR — backup suspiciously small (${BACKUP_SIZE} bytes), aborting"
  rm -f "$BACKUP_TMP"
  exit 1
fi

# Rename from temp to final
mv "$BACKUP_TMP" "$BACKUP_ZIP"

SIZE_MB=$((BACKUP_SIZE / 1048576))
echo "$(date): Backup created: $(basename "$BACKUP_ZIP") (${SIZE_MB}MB)"

# Rotate: keep only the newest MAX_BACKUPS
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/cc4me-backup-*.zip 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
  DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
  ls -1t "$BACKUP_DIR"/cc4me-backup-*.zip | tail -n "$DELETE_COUNT" | while read -r old; do
    echo "$(date): Removing old backup: $(basename "$old")"
    rm -f "$old"
  done
fi

echo "$(date): Backup complete. ${BACKUP_COUNT} backup(s) in ${BACKUP_DIR}"
