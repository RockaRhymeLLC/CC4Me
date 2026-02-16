# Plan: CC4Me Network — Identity + Internet Messaging

**Spec**: specs/20260216-cc4me-network.spec.md
**To-Do**: #122 (Skills Catalog), #123 (Internet A2A Comms)
**Created**: 2026-02-16
**Status**: Ready for Build
**Reviewed**: Bob (GO with 5 gotchas — all addressed in story notes)

## User Perspective

**Primary User**: Hybrid — Claude Code agents (BMO, R2, and future agents) + Human admin (Dave)

**How They Interact**:
- **Agents** generate keypairs, register with the relay, send/receive messages, poll inboxes — all automatic after initial setup
- **Admin** approves registrations and revokes agents via curl commands
- **Existing agent-comms** skill works unchanged — relay is a transparent fallback

**Test Approach**: Tests simulate agent API calls (HTTP requests with signatures) and verify relay behavior (message delivery, rejection of invalid signatures, revocation enforcement). Agent-side tests verify the routing logic (LAN → relay fallback).

## Scale Considerations

Dave expects dozens of agents quickly, then hundreds/thousands if CC4Me goes well. The Phase 1 architecture handles this:
- HTTP POST/GET is stateless — can scale relay replicas horizontally
- Ed25519 per-request signatures need no server-side session state
- SQLite handles thousands of registry entries easily (read-heavy workload)
- At 500+ concurrent polling agents, consider migrating to PostgreSQL + connection pooling (Phase 2+)
- Manual admin approval bottleneck at ~50 agents — batch approval or org trust in Phase 2

Phase 1 priority: clean interfaces so pieces can be swapped without rewriting.

## Technical Approach

### Architecture

Two workstreams that converge:

1. **Relay Service** (new, deployed to Azure) — Express app with SQLite, handles agent registry + message relay
2. **Agent Integration** (modifications to daemon) — crypto utils, relay client, inbox polling, routing fallback

### Key Components

1. **`services/cc4me-relay/`** — Standalone Express app (own Container App on Azure)
   - `index.ts` — Express app, routes, middleware
   - `db.ts` — SQLite setup, schema, cleanup queries
   - `auth.ts` — Signature verification middleware, admin auth
   - `registry.ts` — Agent CRUD routes
   - `relay.ts` — Message send/poll/ack routes
   - `Dockerfile` — Node 22 alpine, SQLite persistent volume

2. **`daemon/src/comms/network/`** — New submodule in daemon
   - `crypto.ts` — Ed25519 keypair generation, signing, verification
   - `relay-client.ts` — HTTP client for relay API (sign + send, poll, ack)
   - `registration.ts` — First-time setup: generate key, register with relay

3. **Modified files**:
   - `daemon/src/comms/agent-comms.ts` — Add relay fallback to `sendAgentMessage()`
   - `daemon/src/automation/tasks/relay-inbox-poll.ts` — New scheduler task
   - `daemon/src/core/config.ts` — Add `NetworkConfig` interface
   - `daemon/src/core/main.ts` — Init/shutdown for network module
   - `cc4me.config.yaml` — New `network` section

### Design Decisions

**Why a separate service (not part of bmobot-gateway)?**
The gateway bundles 30 services into one container. The relay needs its own persistent volume (SQLite) and its own scale-to-zero behavior. Separate Container App = independent lifecycle, cleaner ops.

**Why SQLite (not Supabase)?**
R2's review flagged Supabase 7-day pause as a blocker. SQLite on persistent volume: zero cost, zero external dependencies, no pausing risk, simpler backups.

**Why `fetch()` for relay client (not `execFile('curl')`)?**
The macOS EHOSTUNREACH bug only affects LAN IPs via Node.js `http.request`. The relay is on the public internet — `fetch()` (Node 22 built-in) works fine and is cleaner than spawning curl subprocesses. LAN sends keep using `execFile('curl')` where the bug applies. (Bob review catch.)

**Why Ed25519 (not RSA/ECDSA)?**
Small keys (32 bytes), fast signing, no key-size decisions, good library support in Node.js `crypto`. RFC 8032 standard.

## Stories

| ID | Title | Priority | Size | Tests | Blocked By |
|----|-------|----------|------|-------|------------|
| s-n01 | Ed25519 crypto utilities | 1 | S | t-032, t-033 | — |
| s-n02 | Relay service: agent registry | 2 | M | t-034, t-035, t-036 | s-n01 |
| s-n03 | Relay service: message relay | 3 | M | t-037, t-038, t-039, t-040 | s-n01, s-n02 |
| s-n04 | Relay deployment (Azure + Cloudflare) | 4 | M | t-041 | s-n02, s-n03 |
| s-n05 | Agent-side identity + registration | 5 | S | t-042, t-043 | s-n01, s-n04 |
| s-n06 | Agent-side relay integration + routing | 6 | M | t-044, t-045, t-046 | s-n05 |
| s-n07 | Documentation + relay usage policy | 7 | S | t-047 | s-n06 |

## Dependencies

```
s-n01 (crypto) ──┬──→ s-n02 (registry) ──┬──→ s-n03 (relay) ──→ s-n04 (deploy)
                 │                        │                         │
                 └────────────────────────┘                         │
                                                                    ↓
                                              s-n05 (agent identity) ──→ s-n06 (routing) ──→ s-n07 (docs)
```

## Files to Create/Modify

### New Files
- `services/cc4me-relay/index.ts` — Relay Express app main
- `services/cc4me-relay/db.ts` — SQLite schema + queries
- `services/cc4me-relay/auth.ts` — Signature verification + admin auth middleware
- `services/cc4me-relay/registry.ts` — Agent registration routes
- `services/cc4me-relay/relay.ts` — Message relay routes
- `services/cc4me-relay/package.json` — Dependencies (express, better-sqlite3)
- `services/cc4me-relay/tsconfig.json` — TypeScript config
- `services/cc4me-relay/Dockerfile` — Container image definition
- `daemon/src/comms/network/crypto.ts` — Ed25519 key generation, signing, verification
- `daemon/src/comms/network/relay-client.ts` — Relay HTTP client
- `daemon/src/comms/network/registration.ts` — First-time network setup
- `daemon/src/comms/network/index.ts` — Module exports
- `daemon/src/automation/tasks/relay-inbox-poll.ts` — Inbox polling scheduler task
- `docs/relay-usage-policy.md` — Relay usage policy document

### Modified Files
- `daemon/src/comms/agent-comms.ts` — Add relay fallback in `sendAgentMessage()`
- `daemon/src/core/config.ts` — Add `NetworkConfig` interface + defaults
- `daemon/src/core/main.ts` — Add network module init/shutdown + import poll task
- `cc4me.config.yaml` — Add `network` section
- `cc4me.config.yaml.template` — Add `network` section template
- `.claude/CLAUDE.md` — Add CC4Me Network section
- `.claude/skills/agent-comms/SKILL.md` — Document relay fallback
- `.claude/skills/keychain/SKILL.md` — Document new credential names
- `.claude/skills/setup/SKILL.md` — Add network setup step

## Test Plan

**Location**: `plans/tests/t-032.json` through `plans/tests/t-047.json`
**IMPORTANT**: Tests are IMMUTABLE during build phase

### Test Summary

| Test | Story | Title |
|------|-------|-------|
| t-032 | s-n01 | Ed25519 keypair generation and signing |
| t-033 | s-n01 | Signature verification (valid + invalid + tampered) |
| t-034 | s-n02 | Agent registration and approval flow |
| t-035 | s-n02 | Agent revocation blocks all API access |
| t-036 | s-n02 | Agent directory lists registered agents |
| t-037 | s-n03 | Send and poll message via relay |
| t-038 | s-n03 | Relay rejects unsigned/forged messages |
| t-039 | s-n03 | Replay protection (duplicate nonce rejected) |
| t-040 | s-n03 | Inbox acknowledgment and message TTL cleanup |
| t-041 | s-n04 | Relay health endpoint responds from Azure |
| t-042 | s-n05 | Agent generates keypair and stores in Keychain |
| t-043 | s-n05 | Agent registers with relay and gets approved |
| t-044 | s-n06 | LAN send succeeds — relay not used |
| t-045 | s-n06 | LAN send fails — automatic relay fallback |
| t-046 | s-n06 | Relay inbox poll delivers messages to session |
| t-047 | s-n07 | Documentation covers all new features |

## Validation Checklist

- [ ] All 12 must-have requirements have story coverage
- [ ] All 7 success criteria have test coverage
- [ ] Each story has at least one test
- [ ] Crypto module is dependency-free (Node.js crypto only)
- [ ] Relay service has no daemon dependencies (standalone)
- [ ] Agent-side changes are additive (LAN comms untouched)
- [ ] Config changes are backward-compatible (network section optional)

## Rollback Plan

1. **Relay service**: Delete Container App (`az containerapp delete -n cc4me-relay -g bmobot-prod`), remove DNS record
2. **Agent integration**: Revert `agent-comms.ts` changes (relay fallback is additive, won't break LAN)
3. **Config**: Remove `network` section (defaults to disabled)
4. **Keys**: Keychain items persist harmlessly

## Bob Review Resolutions

Bob gave GO with 5 implementation gotchas. All addressed:

1. **Registration auth chicken-and-egg**: `POST /registry/agents` and `GET /registry/agents` are unauthenticated — new agents have no registered key yet. Added to s-n02 acceptance criteria.
2. **GET request signing**: Define signing payload for bodyless requests — sign `method + path + X-Timestamp` header. Added to s-n03.
3. **Nonce storage**: Use SQLite nonces table (already in schema) instead of in-memory Set. Eliminates restart replay window. Periodic cleanup query deletes entries > 5 min. Updated s-n03.
4. **Inbox path auth**: Verify `:agent` URL param matches `X-Agent` header — agents can only access their own inbox. Added to s-n03.
5. **Relay client transport**: Use `fetch()` for relay (public internet), keep `curl` for LAN only. Updated s-n06 and design decisions.

## Notes

- The relay service TypeScript will be compiled before Docker build (not in-container) to keep the image lean
- SQLite WAL mode for concurrent reads during polling — set explicitly in db.ts init
- Nonce dedup uses SQLite (not in-memory) — survives restart, cleaned every 5 min
- Admin secret should be generated and stored in Keychain before deployment: `credential-cc4me-relay-admin`
- Agent key naming: `credential-cc4me-agent-key` (private), public key registered with relay
- The bmobot-gateway's shared middleware (`services/shared/middleware.js`) can be reused for rate limiting and CORS
- Startup probe on /health to ensure SQLite is ready before accepting traffic (cold start protection)
