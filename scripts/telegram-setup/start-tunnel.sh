#!/bin/bash
# BMO Telegram Tunnel Startup Script
# Starts cloudflared and updates Telegram webhook with new URL

LOG_DIR="/Users/bmo/CC4Me-BMO/logs"
TUNNEL_LOG="$LOG_DIR/cloudflare-tunnel.log"

mkdir -p "$LOG_DIR"

# Get bot token from Keychain
BOT_TOKEN=$(security find-generic-password -s "credential-telegram-bot" -w 2>/dev/null)
if [ -z "$BOT_TOKEN" ]; then
    echo "ERROR: Could not get bot token from Keychain" >> "$TUNNEL_LOG"
    exit 1
fi

# Start cloudflared and capture output
echo "[$(date)] Starting Cloudflare tunnel..." >> "$TUNNEL_LOG"
/opt/homebrew/bin/cloudflared tunnel --url http://localhost:3847 2>&1 | while read line; do
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

            # Notify Dave
            curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
                -H "Content-Type: application/json" \
                -d "{\"chat_id\": 7629737488, \"text\": \"🌐 BMO tunnel restarted!\\nNew URL: ${TUNNEL_URL}\"}" > /dev/null
        fi
    fi
done
