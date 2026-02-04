#!/bin/bash
# agent-send.sh — Send a message to a peer agent directly.
# Reads peer config from cc4me.config.yaml and sends via curl.
# Uses curl instead of the daemon's Node.js HTTP client to avoid
# macOS local network permission issues with Node.js.
#
# Usage: agent-send.sh <peer> <message> [type]
#
# Examples:
#   agent-send.sh mypeer "Hello from me!"
#   agent-send.sh mypeer "idle" status
#   agent-send.sh mypeer "task name" coordination

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_DIR/cc4me.config.yaml"

PEER="${1:-}"
MESSAGE="${2:-}"
TYPE="${3:-text}"

if [ -z "$PEER" ] || [ -z "$MESSAGE" ]; then
  echo "Usage: agent-send.sh <peer> <message> [type]"
  echo ""
  echo "  peer     Peer agent name (must match a peer in cc4me.config.yaml)"
  echo "  message  Message text to send"
  echo "  type     Message type: text (default), status, coordination"
  echo ""
  echo "Examples:"
  echo "  agent-send.sh mypeer 'Hello from me!'"
  echo "  agent-send.sh mypeer 'idle' status"
  exit 1
fi

# ── Parse config with grep/awk (no PyYAML dependency) ──

# Get agent name
AGENT_NAME=$(grep -E '^\s+name:' "$CONFIG_FILE" | head -1 | sed 's/.*name:[[:space:]]*//' | sed 's/^"//;s/"$//' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')

# Check agent-comms enabled
COMMS_ENABLED=$(grep -A1 'agent-comms:' "$CONFIG_FILE" | grep 'enabled:' | awk '{print $2}')
if [ "$COMMS_ENABLED" != "true" ]; then
  echo "Error: agent-comms not enabled in config" >&2
  exit 1
fi

# Find peer config — parse the peers section looking for matching name
PEER_HOST=""
PEER_PORT=""
IN_PEERS=false
IN_TARGET_PEER=false

while IFS= read -r line; do
  # Detect peers section
  if echo "$line" | grep -q '^\s*peers:'; then
    IN_PEERS=true
    continue
  fi

  # If we're past the peers section (hit a non-indented line), stop
  if $IN_PEERS && echo "$line" | grep -qE '^[a-z#]'; then
    break
  fi

  if $IN_PEERS; then
    # New peer entry (starts with "- name:")
    if echo "$line" | grep -q '^\s*-\s*name:'; then
      ENTRY_NAME=$(echo "$line" | sed 's/.*name:[[:space:]]*//' | sed 's/^"//;s/"$//' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
      if [ "$ENTRY_NAME" = "$(echo "$PEER" | tr '[:upper:]' '[:lower:]')" ]; then
        IN_TARGET_PEER=true
      else
        IN_TARGET_PEER=false
      fi
      continue
    fi

    if $IN_TARGET_PEER; then
      if echo "$line" | grep -q '^\s*host:'; then
        PEER_HOST=$(echo "$line" | sed 's/.*host:[[:space:]]*//' | sed 's/^"//;s/"$//' | tr -d '[:space:]')
      fi
      if echo "$line" | grep -q '^\s*port:'; then
        PEER_PORT=$(echo "$line" | awk '{print $2}')
      fi
    fi
  fi
done < "$CONFIG_FILE"

if [ -z "$PEER_HOST" ] || [ -z "$PEER_PORT" ]; then
  echo "Error: Unknown peer: $PEER" >&2
  exit 1
fi

# Get secret from Keychain
SECRET=$(security find-generic-password -s 'credential-agent-comms-secret' -w 2>/dev/null) || {
  echo "Error: Agent comms secret not found in Keychain" >&2
  exit 1
}

# Build message JSON and send via curl, parse response
# Uses python3 with only stdlib (json, uuid, datetime) — no PyYAML needed
python3 -c "
import json, sys, subprocess, uuid, datetime, os

agent_name = sys.argv[1]
peer_name = sys.argv[2]
peer_host = sys.argv[3]
peer_port = sys.argv[4]
msg_type = sys.argv[5]
text = sys.argv[6]
secret = sys.argv[7]
project_dir = sys.argv[8]

# Build message
msg = {
    'from': agent_name,
    'type': msg_type,
    'text': text,
    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
    'messageId': str(uuid.uuid4()),
}

# Send via curl (bypasses Node.js local network restrictions)
url = f'http://{peer_host}:{peer_port}/agent/message'
payload = json.dumps(msg)

result = subprocess.run(
    ['curl', '-s', '--connect-timeout', '5', '-X', 'POST', url,
     '-H', 'Content-Type: application/json',
     '-H', f'Authorization: Bearer {secret}',
     '--data-raw', payload],
    capture_output=True, text=True
)

if result.returncode != 0:
    print(f'Error: Cannot reach {peer_name} at {peer_host}:{peer_port}', file=sys.stderr)
    sys.exit(1)

try:
    d = json.loads(result.stdout)
    if d.get('ok'):
        print(f'Message sent to {peer_name}' + (' (queued)' if d.get('queued') else ''))
        # Log to agent-comms.log
        log_path = os.path.join(project_dir, 'logs', 'agent-comms.log')
        log_entry = json.dumps({
            'ts': msg['timestamp'],
            'direction': 'out',
            'from': agent_name,
            'type': msg_type,
            'text': text,
            'messageId': msg['messageId'],
            'queued': d.get('queued', False),
        })
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, 'a') as lf:
            lf.write(log_entry + '\n')
    else:
        print(f'Error: {d.get(\"error\", \"unknown error\")}', file=sys.stderr)
        sys.exit(1)
except json.JSONDecodeError:
    print(f'Error: Invalid response from peer: {result.stdout[:200]}', file=sys.stderr)
    sys.exit(1)
" "$AGENT_NAME" "$PEER" "$PEER_HOST" "$PEER_PORT" "$TYPE" "$MESSAGE" "$SECRET" "$PROJECT_DIR"
