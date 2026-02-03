#!/bin/bash
# agent-send.sh — Send a message to a peer agent via the daemon.
# Usage: agent-send.sh <peer> <message> [type]
#
# Examples:
#   agent-send.sh mypeer "Hello from me!"
#   agent-send.sh mypeer "idle" status
#   agent-send.sh mypeer "Telegram chunking" coordination

set -euo pipefail

DAEMON_PORT="${DAEMON_PORT:-3847}"
DAEMON_URL="http://localhost:${DAEMON_PORT}/agent/send"

PEER="${1:-}"
MESSAGE="${2:-}"
TYPE="${3:-text}"

if [ -z "$PEER" ] || [ -z "$MESSAGE" ]; then
  echo "Usage: agent-send.sh <peer> <message> [type]"
  echo ""
  echo "  peer     Peer agent name (e.g., mypeer)"
  echo "  message  Message text to send"
  echo "  type     Message type: text (default), status, coordination"
  echo ""
  echo "Examples:"
  echo "  agent-send.sh mypeer 'Hello from me!'"
  echo "  agent-send.sh mypeer 'idle' status"
  exit 1
fi

# Build JSON payload and send — use python3 for reliable JSON handling on macOS
python3 -c "
import json, sys, urllib.request, urllib.error

peer, msg_type, text, url = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
payload = json.dumps({'peer': peer, 'type': msg_type, 'text': text}).encode()

req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        d = json.loads(resp.read())
        if d.get('ok'):
            print(f'Message sent to {peer}')
        else:
            print(f'Error: {d.get(\"error\", \"unknown error\")}', file=sys.stderr)
            sys.exit(1)
except urllib.error.URLError as e:
    print(f'Error: Cannot reach daemon — {e.reason}', file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" "$PEER" "$TYPE" "$MESSAGE" "$DAEMON_URL"
