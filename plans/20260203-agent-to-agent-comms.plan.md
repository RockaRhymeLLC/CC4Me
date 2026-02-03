# Plan: Agent-to-Agent Communication

**Spec**: specs/20260203-agent-to-agent-comms.spec.md
**To-Do**: 044
**Created**: 2026-02-03

## Technical Approach

Add a lightweight inter-agent messaging system to the existing daemon HTTP server. Follows the same pattern as the Telegram adapter: receive message → validate → queue or inject → drain when idle. No new dependencies — just Node.js HTTP built-ins.

### Architecture

```
Peer Agent                          This Daemon (port 3847)
+-----------+    POST /agent/message    +------------------+
|  daemon   | -----------------------> | auth → validate  |
+-----------+    Bearer token          |   → queue/inject |
     ^                                 +------------------+
     |          sendAgentMessage()            |
     +--------- POST /agent/message ----------+
                 (outgoing)
```

### Key Design Decisions

1. **Single module** (`agent-comms.ts`) handles both inbound and outbound — simpler than splitting into adapter + router like Telegram (which has much more complexity: media, typing, approval flows).

2. **Queue drain via setInterval** — checks every 3 seconds when queue has items, stops when empty. Simpler than hooking into the scheduler (which is for longer-interval tasks) or the hook system (which is for transcript events).

3. **Separate JSONL log** (`logs/agent-comms.log`) rather than mixing into the daemon log — makes it easy for Dave to `tail -f` or `grep` just agent traffic.

4. **Auth is symmetric** — both agents use the same shared secret. Stored in Keychain as `credential-agent-comms-secret` on each machine.

5. **No channel router integration** — agent messages are injected directly, not routed through the channel system. Agent comms are a separate communication path, not a channel to switch to.

## Stories

| ID | Title | Priority | Tests | Blocked By |
|----|-------|----------|-------|------------|
| s-n01 | Config, types, and auth | 1 | t-018, t-019 | — |
| s-n02 | Agent comms module — receive, queue, inject | 2 | t-020, t-021, t-022 | s-n01 |
| s-n03 | HTTP endpoints | 3 | t-023, t-024 | s-n02 |
| s-n04 | Queue drain mechanism | 4 | t-025 | s-n02 |
| s-n05 | Send function | 5 | t-026, t-027 | s-n01 |

## Files

### New Files
- `daemon/src/comms/agent-comms.ts` — Core module (receive, queue, drain, send, log)

### Modified Files
- `daemon/src/core/config.ts` — Add AgentCommsConfig type and parsing
- `daemon/src/core/main.ts` — Add `/agent/message` and `/agent/status` endpoints + import
- `cc4me.config.yaml` — Add `agent-comms` config section

## Notes

- R2 needs to implement the same endpoint on her daemon. Email her the plan so she can build in parallel.
- Cloudflare tunnel config should explicitly exclude `/agent/*` routes. Check tunnel config after implementation.
- The send function needs to be callable from Claude's session — either via a script (`scripts/agent-send.sh`) or by injecting a daemon HTTP call. Script approach is simpler and matches how `telegram-send.sh` works.
