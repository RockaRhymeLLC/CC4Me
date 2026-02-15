#!/bin/bash

# Open Cloudflare Zero Trust in Safari
echo "Opening Cloudflare Zero Trust in Safari..."
osascript <<EOF
tell application "Safari"
    activate
    open location "https://one.dash.cloudflare.com/"
    delay 3
end tell
EOF

echo "Safari should now be open with Cloudflare Zero Trust."
echo "Please navigate to: Networks → Tunnels"
echo ""
echo "When you're there, press Enter to continue..."
read

echo ""
echo "Now:"
echo "1. Click 'Create a tunnel' (or select existing tunnel)"
echo "2. Name it 'r2-telegram-webhook' (or whatever you prefer)"
echo "3. On the next screen, you'll get a tunnel token"
echo ""
echo "Copy the tunnel token and paste it here:"
read -p "Tunnel token: " TUNNEL_TOKEN

if [ -z "$TUNNEL_TOKEN" ]; then
    echo "No token provided. Exiting."
    exit 1
fi

# Store tunnel token in keychain
security add-generic-password -a "assistant" -s "credential-cloudflare-tunnel-token" -w "$TUNNEL_TOKEN" -U

echo ""
echo "Tunnel token stored in keychain!"
echo ""
echo "Now in the Cloudflare interface:"
echo "1. Add a 'Public Hostname'"
echo "2. Subdomain: (your choice, like 'r2-webhook')"
echo "3. Domain: (select your domain)"
echo "4. Service type: HTTP"
echo "5. URL: localhost:3000"
echo ""
echo "What subdomain did you use?"
read -p "Subdomain: " SUBDOMAIN
echo "What domain?"
read -p "Domain: " DOMAIN

WEBHOOK_URL="https://${SUBDOMAIN}.${DOMAIN}/webhook"
echo ""
echo "Your webhook URL will be: $WEBHOOK_URL"
echo ""
echo "Registering webhook with Telegram..."

# Get bot token from keychain
BOT_TOKEN=$(security find-generic-password -a "assistant" -s "credential-telegram-bot" -w)

# Register webhook
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WEBHOOK_URL}\"}"

echo ""
echo ""
echo "Done! Now run the tunnel with:"
echo "cloudflared tunnel run"
EOF

chmod +x /Users/agent/cc4me_r2d2/scripts/cloudflare-safari-setup.sh
