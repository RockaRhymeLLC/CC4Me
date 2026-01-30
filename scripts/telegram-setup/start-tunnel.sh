#!/bin/bash
# Telegram Tunnel Startup Script
# Starts cloudflared and updates Telegram webhook with new URL
#
# Optional: Set TELEGRAM_CHAT_ID to receive a notification when the tunnel restarts.

# Resolve project directory (parent of scripts/telegram-setup/)
BASE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$BASE_DIR/logs"
TUNNEL_LOG="$LOG_DIR/cloudflare-tunnel.log"
GATEWAY_PORT="${GATEWAY_PORT:-3847}"

mkdir -p "$LOG_DIR"

# Get bot token from Keychain
BOT_TOKEN=$(security find-generic-password -s "credential-telegram-bot" -w 2>/dev/null)
if [ -z "$BOT_TOKEN" ]; then
    echo "ERROR: Could not get bot token from Keychain" >> "$TUNNEL_LOG"
    exit 1
fi

# Locate cloudflared
CLOUDFLARED="${CLOUDFLARED_PATH:-/opt/homebrew/bin/cloudflared}"
if [ ! -x "$CLOUDFLARED" ]; then
    CLOUDFLARED=$(which cloudflared 2>/dev/null)
    if [ -z "$CLOUDFLARED" ]; then
        echo "ERROR: cloudflared not found. Install with: brew install cloudflared" >> "$TUNNEL_LOG"
        exit 1
    fi
fi

# Start cloudflared and capture output
echo "[$(date)] Starting Cloudflare tunnel..." >> "$TUNNEL_LOG"
"$CLOUDFLARED" tunnel --url "http://localhost:${GATEWAY_PORT}" 2>&1 | while read line; do
    echo "$line" >> "$TUNNEL_LOG"

    # Look for the tunnel URL
    if [[ "$line" == *"trycloudflare.com"* ]]; then
        # Extract URL from the line
        TUNNEL_URL=$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com')

        if [ -n "$TUNNEL_URL" ]; then
            echo "[$(date)] Tunnel URL: $TUNNEL_URL" >> "$TUNNEL_LOG"

            # Update Telegram webhook
            WEBHOOK_URL="${TUNNEL_URL}/telegram"
            RESULT=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}")
            echo "[$(date)] Webhook update result: $RESULT" >> "$TUNNEL_LOG"

            # Save URL to file for reference
            echo "$TUNNEL_URL" > "$LOG_DIR/current-tunnel-url.txt"

            # Optionally notify the user
            if [ -n "$TELEGRAM_CHAT_ID" ]; then
                curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
                    -H "Content-Type: application/json" \
                    -d "{\"chat_id\": ${TELEGRAM_CHAT_ID}, \"text\": \"Tunnel restarted.\\nNew URL: ${TUNNEL_URL}\"}" > /dev/null
            fi
        fi
    fi
done
