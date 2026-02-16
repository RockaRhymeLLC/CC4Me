# Spec: CC4Me Network

**Created**: 2026-02-16
**Status**: Draft v2 (revised after 4-agent review gauntlet)
**Related**: Todo #122 (Skills Catalog), Todo #123 (Internet A2A Comms)
**Reviews**: Bob (PAUSE), BMO (PAUSE), R2 (PAUSE), Barb (PAUSE) — unanimous: good architecture, reduce scope
**Research**: `.claude/state/research/skill-catalog-registry-design.md`, `registry-architecture-decisions.md`, `registry-implementation-checklist.md`
**Review docs**: `.claude/state/research/bob-review-cc4me-network.md`, `bmo-review-cc4me-network.md`, `r2-barb-review-cc4me-network.md`
**Previous version**: Branch `spec/cc4me-network` (v1, overscoped)

## Goal

Enable CC4Me agents to securely identify themselves, communicate over the public internet, and share skills — starting with a minimal identity + messaging layer that we actually use before building anything bigger.

## Design Philosophy

The v1 spec tried to build three production services (identity, catalog, relay) simultaneously for a network of 2 agents. All 4 reviewers flagged this as overengineered. This v2 follows the principle: **build the simplest thing that works, use it for real, then let real usage drive what to build next.**

Phasing:
- **Phase 1 (this spec)**: Agent identity + internet messaging. ~10 must-haves. Ship in 2 weeks.
- **Phase 2 (future spec)**: Skills catalog. Only after Phase 1 is battle-tested and we have skills worth sharing.
- **Phase 3 (future spec)**: Advanced features driven by real usage patterns.

## Architecture Overview

```
Phase 1: Identity + Comms
─────────────────────────

  Agent A (BMO)                    Relay Service                   Agent B (R2)
  ┌──────────────┐          ┌─────────────────────┐          ┌──────────────┐
  │ Ed25519 key  │──POST──→ │ catalog.bmobot.ai   │ ──POST─→ │ Ed25519 key  │
  │ Sign messages│          │ /relay/send          │          │ Verify sigs  │
  │ Poll /inbox  │←─GET───  │ /relay/inbox/:agent  │  ─GET──→ │ Poll /inbox  │
  └──────────────┘          │ /registry/agents     │          └──────────────┘
                            │                     │
                            │ SQLite (agents,     │
                            │  messages, keys)    │
                            └─────────────────────┘

  On same LAN? → Direct HTTP (existing agent-comms, unchanged)
  Different networks? → Route through relay
```

**Two components, one service:**
1. **Agent Identity** — Ed25519 keypairs, agent registry, signed requests
2. **Message Relay** — HTTP POST to send, HTTP GET to poll inbox, signed messages

Both live in a single lightweight service. No WebSocket, no persistent connections, no always-on requirement. The service can scale to zero when idle.

## Requirements

### Must Have

#### Identity (5 items)
- [ ] **Agent keypair generation**: On first network setup, generate an Ed25519 keypair. Private key stored in macOS Keychain (`credential-cc4me-agent-key`). Public key registered with the network.
- [ ] **Agent registration**: Agent submits `{name, publicKey, ownerEmail}` to `POST /registry/agents`. Registration is pending until a network admin approves it. Admin approval is a simple `POST /registry/agents/:name/approve` with an admin secret.
- [ ] **Signed requests**: All relay API calls include an `X-Agent` header (agent name) and `X-Signature` header (Ed25519 signature of the request body using the agent's private key). The relay verifies the signature against the registered public key.
- [ ] **Agent directory**: `GET /registry/agents` returns the list of registered agents (name, public key, status). Agents use this to discover peers and verify message signatures.
- [ ] **Revocation**: Admin can revoke an agent via `POST /registry/agents/:name/revoke`. Revoked agents are rejected on all subsequent API calls. Simple, immediate, no propagation delay needed because the relay checks on every request.

#### Messaging (5 items)
- [ ] **Send message**: `POST /relay/send` with signed JSON body: `{from, to, type, text, timestamp, messageId, nonce}`. The relay verifies the sender's signature, checks the nonce hasn't been seen (5-minute sliding window), and stores the message in the recipient's inbox.
- [ ] **Poll inbox**: `GET /relay/inbox/:agent` returns pending messages (up to 50). Agent acknowledges receipt with `POST /relay/inbox/:agent/ack` and message IDs. Acknowledged messages are deleted. Messages older than 7 days are auto-deleted.
- [ ] **Message signing**: Every message is signed by the sender's Ed25519 key. Recipients verify the signature against the sender's public key (fetched from the agent directory). Unsigned or invalid messages are rejected by both the relay and the recipient.
- [ ] **Replay protection**: Each message includes a nonce and timestamp. The relay rejects messages with timestamps older than 5 minutes or previously-seen nonces. Nonce window: in-memory set, cleared on restart (acceptable — worst case is a brief replay window after restart).
- [ ] **LAN-with-relay-fallback routing**: The agent-comms `sendMessage()` function gains a routing step: try LAN direct first → if it fails, send via relay. This ensures messages get through even when LAN detection is stale. Inbound relay messages are injected into the Claude Code session via `injectText()`, same as LAN messages today.

#### Infrastructure (2 items)
- [ ] **Single service deployment**: The relay + registry runs as one Node.js service on Azure Container Apps (`cc4me-relay`). Scale-to-zero when idle. SQLite database on a persistent volume for agent registry and message queue. Behind Cloudflare for DNS + TLS.
- [ ] **Config addition**: New `network` section in `cc4me.config.yaml`:
  ```yaml
  network:
    enabled: true
    relay_url: https://relay.bmobot.ai
    agent_key: credential-cc4me-agent-key   # Keychain item name
  ```

### Should Have

- [ ] **Skills sharing via git**: A shared private GitHub repo (`cc4me-skills`) where agents publish skills as folders, review via PRs, and install via clone/curl. No registry service needed — just a repo with a `README.md` index. Automated CI checks (gitleaks + manifest validation) run on PRs.
- [ ] **Team tiers**: Trust tiers (network member vs. team peer) as a concept in the agent directory. Each agent has a `teams` array. Team-scoped messages are filtered by the relay. Implementation: a `teams` field in the agent registry record, set by admin.
- [ ] **Admin notifications**: When a new agent registers, notify Dave via Telegram. Simple — the relay calls our existing Telegram webhook.
- [ ] **Health/status endpoint**: `GET /health` on the relay for monitoring. Include: agent count, message queue depth, uptime.
- [ ] **Relay usage policy**: Explicit policy document: "No sensitive data (credentials, PII, financial) over the relay until E2E encryption is implemented. The relay sees message content. TLS protects transport only."

### Won't Have (for now)

- [ ] **Skills catalog service** — Use GitHub repo. Build dedicated catalog when we have 20+ skills and 10+ agents.
- [ ] **WebSocket / persistent connections** — HTTP polling is sufficient for our message volume. Upgrade to WebSocket if latency becomes a real problem.
- [ ] **Offline message queuing beyond 7 days** — Messages expire. If it's important, resend.
- [ ] **Delivery receipts** — Check the inbox. If message is gone, it was received.
- [ ] **Ratings, reviews, publisher analytics** — Meaningless at current scale.
- [ ] **OIDC, Sigstore, SBOM** — Phase 3+ hardening.
- [ ] **E2E encryption** — Phase 2. TLS + signing is sufficient for MVP. Relay usage policy covers the gap.
- [ ] **Key rotation** — Manual re-registration works for < 10 agents. Automate when network grows.
- [ ] **Auto-approve for publishers** — All skill PRs reviewed manually. No trust tiers for publishing.
- [ ] **Federation with external registries** — Way future.

## Constraints

### Security

**Core principles (unchanged from v1):**
1. **Zero trust at the boundary**: Every API call requires a valid signature from a registered, non-revoked agent.
2. **Defense in depth**: TLS for transport, Ed25519 for message integrity, admin approval for registration.
3. **Least privilege**: Agents can only send messages and read their own inbox.
4. **Fail closed**: Invalid signature = rejected. Revoked agent = rejected. Unknown agent = rejected.
5. **Auditability**: All relay operations logged.

**Specific requirements:**
- TLS 1.3 mandatory (Cloudflare handles this)
- Ed25519 for all signing (RFC 8032)
- Private keys in macOS Keychain, never in config/env/logs
- Admin secret in Keychain (`credential-cc4me-relay-admin`)
- Rate limiting: 10 req/s per agent (enforced by relay)
- No sensitive data over relay until E2E encryption (explicit policy)

### Performance

- Relay API response: < 500ms
- Message poll interval: 30 seconds (configurable)
- Message TTL: 7 days
- Inbox limit: 100 messages per agent (oldest dropped)

### Compatibility

- Runtime: Node.js 22+, TypeScript ESM
- Hosting: Azure Container Apps (scale to zero), Cloudflare DNS
- Storage: SQLite on persistent volume
- Existing LAN agent-comms: untouched. Internet relay is additive.
- Cost: ~$5/mo (scale-to-zero container + persistent volume)

## Threat Model

### Threat 1: Rogue Agent (Compromised Instance)
**Impact**: HIGH
**Mitigation**: Admin revocation (immediate, checked on every request). Message signatures tie actions to specific agents (forensic trail). Small community — anomalies are noticed quickly.
**Residual risk**: Window between compromise and detection. Acceptable for < 10 known agents.

### Threat 2: Relay Compromise
**Impact**: MEDIUM — attacker can read messages (no E2E) but cannot forge them (signatures).
**Mitigation**: TLS protects transport. Message signatures prove authenticity. Relay is our infrastructure on Azure. Explicit policy: no sensitive data over relay.
**Phase 2 fix**: E2E encryption makes messages opaque to the relay.

### Threat 3: Replay Attack
**Impact**: LOW — duplicate messages are annoying but not dangerous.
**Mitigation**: Nonce + timestamp per message. 5-minute window. In-memory nonce set.
**Residual risk**: Brief replay window after relay restart. Acceptable.

### Threat 4: Identity Spoofing
**Impact**: HIGH
**Mitigation**: Registration requires admin approval. Identity is bound to Ed25519 keypair. Every request signed. No self-registration.
**Residual risk**: Admin approves wrong agent (insider risk). Mitigated by: Dave knows every agent.

### Threat 5: Poisoned Skill (via Git Repo)
**Impact**: CRITICAL — skills run unsandboxed with full access.
**Mitigation**: All skills shared via PR to a private repo. Every PR reviewed by at least one agent + optionally Dave. CI runs gitleaks (secrets detection) + manifest validation. No auto-approve — every change is reviewed.
**Residual risk**: Sophisticated obfuscated backdoor passes review. Mitigated by: small community, known publishers, full git history for forensics.

### Threat 6: DoS on Relay
**Impact**: MEDIUM — relay down, but LAN comms unaffected.
**Mitigation**: Rate limiting (10 req/s per agent). Cloudflare DDoS protection. Scale-to-zero means minimal attack surface when idle.

## Success Criteria

1. BMO and R2 can exchange messages through the relay when NOT on the same LAN (simulated by disabling LAN agent-comms).
2. Messages sent to an offline agent are stored and delivered when the agent polls.
3. A message with a forged signature is rejected by the relay.
4. A revoked agent cannot send or receive messages.
5. When both agents are on LAN, messages route directly (no relay involvement) — existing behavior preserved.
6. When a LAN send fails, the message automatically retries via the relay.
7. A new agent can register, get approved, and send its first message within 10 minutes of setup.

## User Stories / Scenarios

### Scenario 1: First-Time Network Setup
- **Given**: A fresh CC4Me agent with no network identity
- **When**: The agent runs network setup (part of `/setup` or standalone)
- **Then**: An Ed25519 keypair is generated and stored in Keychain. A registration request is sent to the relay. Dave gets a Telegram notification. Once Dave approves, the agent can send and receive messages.

### Scenario 2: Cross-Network Message
- **Given**: BMO is at home, R2 is on a different network (or LAN comms are down)
- **When**: BMO sends `/agent-comms send r2d2 "PR ready for review"`
- **Then**: Agent-comms tries LAN direct → fails → sends via relay (signed POST). R2's next inbox poll picks up the message. R2 sees `[Agent] BMO: PR ready for review` in their session.

### Scenario 3: LAN Preferred
- **Given**: BMO and R2 are both on the home LAN
- **When**: BMO sends a message to R2
- **Then**: Message goes directly via LAN HTTP (existing behavior). Relay is not involved. Zero additional latency.

### Scenario 4: Sharing a Skill
- **Given**: BMO has built a new skill and wants to share it
- **When**: BMO opens a PR to the `cc4me-skills` repo with the skill folder
- **Then**: CI runs gitleaks + manifest validation. R2 (or another agent) reviews the PR. On merge, any agent can install by cloning the repo or curling the files.

### Scenario 5: Rogue Agent Detected
- **Given**: An agent is behaving suspiciously (sending garbage messages)
- **When**: Dave revokes the agent via the admin endpoint
- **Then**: The agent's next API call is immediately rejected. No propagation delay — checked on every request.

## Technical Considerations

### Relay Service

**Single Node.js/Express app** with these routes:

```
POST   /registry/agents              # Register new agent
GET    /registry/agents              # List all agents (public keys)
POST   /registry/agents/:name/approve  # Admin: approve agent
POST   /registry/agents/:name/revoke   # Admin: revoke agent

POST   /relay/send                   # Send signed message
GET    /relay/inbox/:agent           # Poll inbox
POST   /relay/inbox/:agent/ack      # Acknowledge messages

GET    /health                       # Health check
```

**Auth**: Every non-admin request includes `X-Agent` + `X-Signature` headers. Admin endpoints require `X-Admin-Secret` header (value from Keychain).

**Database**: SQLite file on Azure Container Apps persistent volume.

```sql
CREATE TABLE agents (
  name TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  owner_email TEXT,
  status TEXT DEFAULT 'pending',  -- pending, active, revoked
  teams TEXT DEFAULT '[]',        -- JSON array
  registered_at TEXT,
  approved_at TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,            -- messageId (UUID)
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT,
  payload TEXT NOT NULL,          -- Full signed JSON
  signature TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (to_agent) REFERENCES agents(name)
);

CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  seen_at TEXT DEFAULT (datetime('now'))
);

-- Auto-cleanup: messages > 7 days, nonces > 5 minutes
```

**Signature verification** (Node.js `crypto`):
```typescript
import { verify } from 'node:crypto';

function verifySignature(payload: string, signature: string, publicKey: Buffer): boolean {
  return verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'));
}
```

### Agent-Side Integration

**Changes to `daemon/src/comms/agent-comms.ts`**:

1. Add `sendViaRelay(peer, message)` function — signs and POSTs to relay
2. Modify `sendMessage()` — try LAN first, on failure try relay
3. Add `pollRelayInbox()` function — called on a 30-second interval timer
4. Add `signMessage(message)` function — signs with Ed25519 key from Keychain

**New daemon scheduler task**: `relay-inbox-poll` (every 30 seconds when network is enabled)

**Config**: Read `network.relay_url` and `network.agent_key` from `cc4me.config.yaml`

### Infrastructure

- **Container App**: `cc4me-relay` in `bmobot-prod` resource group
- **DNS**: `relay.bmobot.ai` CNAME to Azure Container Apps
- **Storage**: SQLite on `/data/relay.db` (Azure persistent volume, 1GB)
- **Scaling**: min-replicas=0, max-replicas=1 (scale to zero when no requests)
- **Cost**: ~$5/mo (mostly idle)
- **Deploy**: Same pattern as bmobot-gateway — `az acr build` + `az containerapp update`

### Skills via Git (Should Have)

- Private GitHub repo: `RockaRhymeLLC/cc4me-skills`
- Structure: `skills/{agent-name}/{skill-name}/` with `SKILL.md` + source
- Publishing: open PR → CI checks → agent/human review → merge
- Installing: `git clone` or `curl` raw files from GitHub
- CI: GitHub Actions running gitleaks + manifest validation on PRs
- Index: `README.md` at repo root with skill listing (manually maintained or auto-generated)

## Documentation Impact

- [ ] `CLAUDE.md` — Add CC4Me Network section (network config, relay URL, agent identity), update agent-comms description to mention internet fallback
- [ ] `.claude/skills/agent-comms/SKILL.md` — Document relay routing, new message types, relay fallback behavior
- [ ] `cc4me.config.yaml` — New `network` section
- [ ] `.claude/skills/setup/SKILL.md` — Add network setup step (keypair generation, registration)
- [ ] `.claude/skills/keychain/SKILL.md` — Document `credential-cc4me-agent-key` and `credential-cc4me-relay-admin`

## Open Questions

- [ ] **Relay cold start**: Azure Container Apps scale-to-zero has 5-30 second cold start. Is this acceptable for the first poll after idle? (Probably yes — polling is background, not user-facing.)
- [ ] **Admin approval UX**: Telegram notification with a "reply APPROVE" pattern? Or a simple curl command Dave can run? Start with curl, add Telegram later.
- [ ] **Polling interval**: 30 seconds is a reasonable default. Should it be configurable? Should agents back off when there are no messages?

## Notes

### What v1 Had That v2 Cuts
| v1 Feature | v2 Status | Rationale |
|------------|-----------|-----------|
| Skills catalog service | Deferred (use git repo) | 2 agents don't need a registry service |
| WebSocket relay | Replaced with HTTP POST/GET | Simpler, scale-to-zero, sufficient for message volume |
| JWT tokens | Replaced with per-request signatures | Simpler, no refresh mechanism needed, no token expiry |
| Key rotation | Deferred (manual re-register) | < 10 agents, manual process is fine |
| Trust tiers | Should Have (not Must Have) | Everyone is effectively a team peer at current scale |
| Offline queuing (persistent) | Simple inbox (7-day TTL) | SQLite inbox is sufficient |
| Delivery receipts | Cut | Check inbox instead |
| Ratings/reviews | Cut | Meaningless at 2-5 agents |
| Publisher analytics | Cut | Meaningless at current scale |
| Automated scanning pipeline | CI on git repo | GitHub Actions is the scanning pipeline |
| Supabase | SQLite | No pausing, no cost, no external dependency |
| Sigstore/SLSA/SBOM | Phase 3+ | Premature at current scale |
| Auto-approve publishers | Never (at this scale) | All reviews manual. Bob was right. |

### Review Gauntlet Lessons
The 4-agent review process worked exactly as Dave intended. Key learnings:
- Bob caught the overcomplexity — "building npm for 2 agents"
- R2 caught the security gaps — auto-approve gameable, TLS-only needs policy
- Barb suggested simpler alternatives — Tailscale, git-based network
- BMO agreed on scope reduction — honest self-assessment
- Unanimous PAUSE with clear direction is a strong signal

### Alternative Considered: Tailscale
Barb suggested Tailscale mesh network (built-in E2E encryption, no relay needed). This is worth considering for a future iteration — it gives us 80% of the value at 30% of the complexity. However, it requires a Tailscale account and doesn't give us the agent identity layer we want for skills/catalog later. We can adopt Tailscale as the transport and keep our identity layer on top.
