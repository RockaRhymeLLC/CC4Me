# Agent-to-Agent Communication

**Created**: 2026-02-03
**Status**: Approved
**Related**: Todo #044, R2 email proposal (2026-02-02)

## Overview

Enable direct, low-latency communication between CC4Me agents on the same local network. Currently BMO and R2 can only communicate via email (polled every 15min) or SSH+tmux injection (fragile). This feature adds a dedicated HTTP endpoint to each agent's daemon for structured inter-agent messaging.

## Problem

- Email has 15+ minute latency due to polling intervals
- SSH+tmux injection is brittle and requires busy-checking
- No structured message format — everything is plain text
- No way to coordinate work (e.g., "I'm working on X, don't duplicate")
- No presence/availability detection between agents

## Requirements

### Must Have

1. **HTTP Message Endpoint**: Each daemon exposes `POST /agent/message` that accepts JSON messages from other agents
2. **Authentication**: Shared secret (bearer token) stored in Keychain on each agent's machine
3. **Async Delivery**: Fire-and-forget by default — sender gets `{ ok: true, queued: true }` immediately
4. **Message Injection**: Received messages are injected into the Claude Code session (like Telegram messages), prefixed with sender identity
5. **Busy Awareness**: If the receiving agent is busy, messages are queued and delivered when idle
6. **Basic Message Types**:
   - `text` — Free-form text message
   - `status` — Availability/presence ping (`{ type: 'status', status: 'idle' | 'busy' | 'offline' }`)
   - `coordination` — Work coordination (`{ type: 'coordination', action: 'claim' | 'release', task: '...' }`)

7. **Message Log**: All sent and received messages logged to `logs/agent-comms.log` (JSONL format) with timestamps, sender, type, and content. Gives the owner visibility into agent comms for troubleshooting.
8. **FIFO Queue**: Messages received while busy are delivered in order (first-in, first-out) when idle

### Nice to Have

9. **Callback Support**: Optional `callbackUrl` field — receiver can POST a response back when ready
10. **PR Review Requests**: Structured message for requesting code review (`{ type: 'pr-review', repo, branch, pr }`)
11. **Memory Sync**: Share individual memory files between agents
12. **Context Handoff**: When one agent hits context limits, hand off the current task to the other
13. **Heartbeat**: Periodic presence check (lightweight GET endpoint)

### Won't Do (This Phase)

- End-to-end encryption (local network, shared secret is sufficient)
- Multi-agent discovery (mDNS/Bonjour — just hardcode IP:port for now)
- Message persistence across daemon restarts (in-memory queue is fine for v1)
- Binary/file transfer (use filesystem paths instead)

## Design Constraints

- **No new infrastructure**: Runs within existing daemon HTTP server (port 3847)
- **No external dependencies**: Node.js built-in HTTP only, no message brokers
- **Local network only**: No internet-facing endpoints (Cloudflare tunnel should NOT route /agent/*)
- **Minimal overhead**: Heartbeat should be < 1ms, message delivery < 100ms
- **Compatible with busy detection**: Uses existing `isBusy()` from session-bridge

## Message Format

```typescript
interface AgentMessage {
  from: string;           // Agent name (e.g., 'r2d2', 'bmo')
  type: 'text' | 'status' | 'coordination' | 'pr-review';
  text?: string;          // For text messages
  context?: string;       // Optional context/metadata
  callbackUrl?: string;   // Optional URL to POST response to
  timestamp: string;      // ISO 8601
  messageId: string;      // UUID for dedup/tracking
}

interface AgentMessageResponse {
  ok: boolean;
  queued: boolean;        // true if agent is busy and message was queued
  error?: string;
}
```

## Injection Format

Messages appear in Claude Code's session as:
```
[Agent] R2: Hey BMO, I'm picking up the Telegram chunking fix. Don't duplicate.
[Agent] R2: [Status: idle]
[Agent] R2: [Coordination: claimed "Telegram message chunking"]
```

## Configuration

In `cc4me.config.yaml`:
```yaml
agent-comms:
  enabled: true
  secret: keychain:credential-agent-comms-secret
  peers:
    - name: r2d2
      host: chrissys-mac-mini.local
      port: 3847
```

## Success Criteria

1. BMO can send a text message to R2 and R2 receives it within 2 seconds
2. R2 can send a text message to BMO and BMO receives it within 2 seconds
3. Messages are properly queued when the receiving agent is busy
4. Shared secret auth rejects unauthorized requests
5. /agent/message endpoint does NOT route through Cloudflare tunnel
6. Messages appear in Claude Code session with clear [Agent] prefix
7. Status pings work for presence detection

## Resolved Questions

1. **Same port or separate?** Same port (3847). The daemon already has an HTTP server — adding routes is simpler than managing a second listener. Agent comms routes are namespaced under `/agent/*` and excluded from Cloudflare tunnel routing.

2. **Message ordering when busy?** FIFO queue. Messages are delivered in the order received once the agent becomes idle. Queue is in-memory (lost on daemon restart, which is acceptable for v1).

3. **Coordination claims — persist or in-memory?** In-memory for v1. Claims are ephemeral — if the daemon restarts, agents re-coordinate. Persistence adds complexity without much benefit when agents can just re-ping.

4. **Rate limiting between agents?** Not for v1. Agents are trusted peers on the local network. If we see issues, we can add it later.

## History

| Date | Change |
|------|--------|
| 2026-02-03 | Initial spec created from R2's email proposal + BMO's additions |
| 2026-02-03 | Dave approved. Promoted message log to must-have. Resolved open questions. |
