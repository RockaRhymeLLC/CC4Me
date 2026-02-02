# Plan: CC4Me Multi-User — 3rd Party Access & Agent-to-Agent Communication

**Spec**: specs/20260201-multi-user-3rd-party-access.spec.md
**Created**: 2026-02-01

## Technical Approach

### Core Architecture

The feature centers on a new **access control module** (`daemon/src/core/access-control.ts`) that serves as the single authority for sender classification. Every incoming message — regardless of channel — passes through this module before being processed.

**Sender classification tiers** (checked in order):
1. **Blocked** → silently drop, no notification
2. **Safe sender** (existing `safe-senders.json`) → full access, inject directly (current behavior)
3. **Approved 3rd party** (`3rd-party-senders.json`) → inject with `[3rdParty]` tag so Claude knows the behavioral boundaries
4. **Denied** (recently) → re-trigger approval flow (denials are not blocks)
5. **Unknown** → hold message, notify primary, wait for approval

### Message Flow (Telegram)

```
Incoming message
  │
  ├─ Blocked? → drop silently
  ├─ Safe sender? → inject as [Telegram] Name: text (existing flow)
  ├─ Approved 3rd party? → check rate limit → inject as [3rdParty][Telegram] Name: text
  ├─ Pending approval? → queue message, tell sender "waiting on my human"
  └─ Unknown? → notify primary, tell sender "checking with my human", queue message
                  │
                  └─ Primary replies approve/deny
                       ├─ Approve → add to 3rd-party-senders.json, self-introduce, process queued messages
                       └─ Deny → log denial, tell sender "sorry, can't help right now"
```

### Key Design Decisions

1. **Separate state files**: `safe-senders.json` (primary human, highest trust) stays as-is. `3rd-party-senders.json` is a new file for approved 3rd parties. This keeps the trust model clear and backwards-compatible.

2. **`[3rdParty]` message tag**: When injecting a 3rd party's message into the session, prefix it with `[3rdParty]` so Claude's behavioral rules (CLAUDE.md) can enforce capability boundaries. Claude sees `[3rdParty][Telegram] Will: help me set up CC4Me` and knows to apply 3rd party rules.

3. **Approval via existing channel**: The approval notification goes to the primary via `sendMessage()` on the Telegram adapter (direct API call, not through the session). The primary's reply is detected by matching context in incoming messages.

4. **Rate limiting in access-control.ts**: A sliding window counter per sender ID. Checked before message processing. Config-driven thresholds from `cc4me.config.yaml`.

5. **Outgoing rate limiting in channel-router.ts**: A simple token bucket per recipient. Applied in `routeOutgoingMessage()` before dispatching.

6. **Behavioral enforcement via CLAUDE.md**: The private info gate and capability boundaries are enforced by Claude's behavioral rules, not by daemon code. The daemon's job is classification and tagging. Claude's job is following the rules based on the tag.

### Files to Create

| File | Purpose |
|------|---------|
| `daemon/src/core/access-control.ts` | Sender classification, state file CRUD, rate limiting, expiry checks |
| `daemon/src/automation/tasks/approval-audit.ts` | Scheduled audit of 3rd-party approvals |
| `.claude/state/3rd-party-senders.json` | 3rd party approved/denied/blocked/pending state |

### Files to Modify

| File | Changes |
|------|---------|
| `daemon/src/comms/adapters/telegram.ts` | Replace hardcoded safe-sender check with access-control module. Add approval flow (notify primary, handle response) |
| `daemon/src/comms/channel-router.ts` | Add outgoing rate limiter |
| `daemon/src/core/config.ts` | Add `third_party_senders_file` and `rate_limits` config parsing |
| `daemon/src/core/main.ts` | Register approval-audit task |
| `cc4me.config.yaml` | Add rate_limits and third_party_senders_file config |
| `cc4me.config.yaml.template` | Same for upstream template |
| `.claude/CLAUDE.md` | Add 3rd party interaction policy, private info gate, capability boundaries |

## Stories

| ID | Title | Priority | Tests | Blocked By |
|----|-------|----------|-------|------------|
| s-m01 | Access control module | 1 | t-001, t-002, t-003 | — |
| s-m02 | Telegram approval flow | 2 | t-004, t-005, t-006 | s-m01 |
| s-m03 | 3rd party message injection & tagging | 3 | t-007, t-008 | s-m01, s-m02 |
| s-m04 | CLAUDE.md policy & behavioral rules | 4 | t-009, t-010 | — |
| s-m05 | Rate limiting (incoming & outgoing) | 5 | t-011, t-012 | s-m01 |
| s-m06 | Blocked list & auto-block | 6 | t-013, t-014 | s-m01, s-m02 |
| s-m07 | Approval expiry & audit task | 7 | t-015, t-016 | s-m01 |
| s-m08 | Config & state file setup | 1 | t-017 | — |

## Dependencies

```
s-m08 (config)
  │
  └─ s-m01 (access control) ──┬── s-m02 (approval flow) ── s-m03 (injection & tagging)
                               ├── s-m05 (rate limiting)
                               ├── s-m06 (blocked list)
                               └── s-m07 (expiry & audit)

s-m04 (CLAUDE.md policy) — independent, can be done in parallel
```

## Notes

- The private info gate is entirely behavioral (CLAUDE.md rules), not daemon-enforced. The daemon tags messages so Claude knows the sender type; Claude decides what to share.
- Email channel support follows the same access-control flow but with an added spam pre-filter. This can be a follow-up story once the Telegram flow is solid.
- The `sendMessage` function in the Telegram adapter already supports sending to arbitrary chat IDs — we use this for the approval notification to the primary.
