# Spec: CC4Me Multi-User — 3rd Party Access & Agent-to-Agent Communication

## Problem Statement

CC4Me agents are designed as 1:1 personal assistants — one agent, one primary human. But real life isn't 1:1. The primary human's spouse, coworkers, friends, and even their agents need to interact with the assistant. Today, any message from an unknown sender is either ignored or handled ad-hoc with no consistent policy, no approval flow, and no guardrails.

As CC4Me agents proliferate (e.g., one for Dave, one for Chrissy), they need a structured way to interact with each other and with each other's humans — coordinating schedules, relaying messages, and helping with tasks — without compromising the primary human's privacy or the agent's integrity.

## Goals

1. **Controlled access** — 3rd parties can only interact with the agent after explicit approval by the primary human
2. **Privacy protection** — The primary human's private information is never shared without per-request consent
3. **Agent-to-agent coordination** — CC4Me agents can communicate with each other over standard channels (Telegram, email)
4. **Ecosystem-wide** — Every CC4Me agent gets this feature, enabling a network of cooperating agents and humans
5. **Low friction for the primary** — Approval is quick (approve/deny via Telegram), not a chore
6. **Spam resilience** — Email and other high-noise channels are pre-filtered so the primary isn't flooded with junk approval requests

## Requirements

### Must Have

- [ ] **Unknown sender detection**: When a message arrives from a sender not in safe-senders or 3rd-party-approved list, trigger the approval flow
- [ ] **Approval notification**: Immediately notify the primary human via their preferred channel (e.g., Telegram) with: who contacted, what channel, and what they said
- [ ] **Approve/deny response**: Primary can reply "approve" or "deny" to the notification. "Approve" adds the sender to the 3rd-party approved list
- [ ] **Optional approval duration**: Primary can specify a duration (e.g., "approve for 1 week", "approve until Friday"). Default is persistent until revoked
- [ ] **3rd-party senders state file**: `3rd-party-senders.json` storing approved senders with metadata: sender ID, channel, display name, approved date, expiry (if set), approved by
- [ ] **Capability boundaries for approved 3rd parties**:
  - CAN: Ask for help with general tasks (tech support, drafting, brainstorming, CC4Me setup)
  - CAN: Share publicly available information
  - CANNOT: Access primary human's private info (calendar, personal details, schedule, location, preferences) without per-request approval from primary
  - CANNOT: Modify agent config, features, skills, or core state files
  - CANNOT: Create to-dos for the primary human
  - CAN: Trigger the agent to create to-dos for itself (e.g., enhancement ideas noted for later review)
- [ ] **Private info gate**: When an approved 3rd party requests private info about the primary, the agent asks the primary via Telegram before sharing. Primary approves or denies per-request
- [ ] **Interaction memory logging**: Log 3rd party interactions to memory (using existing memory system) — who, what was discussed, what was shared
- [ ] **Enhancement capture**: When a 3rd party interaction reveals an opportunity to improve the agent's capabilities, create a to-do for review with the primary
- [ ] **Rate limiting (incoming)**: Configurable max messages per minute per sender. If exceeded, tell the sender to slow down and pause processing their messages until rate drops
- [ ] **Rate limiting (outgoing)**: Configurable max messages per minute per recipient. Prevents the agent from flooding another agent or user
- [ ] **All-channel support**: Works on every configured communication channel (Telegram, email, future channels)
- [ ] **Scheduled approval audit**: Periodic task (every 6 months) to review 3rd-party approvals — flag stale/expired entries, notify primary of active approvals for review
- [ ] **Blocked list**: Blocked senders are silently ignored (no notification to primary). Primary can manually block senders. Agent can auto-block senders who spam repeated requests after denial
- [ ] **Pending response**: When the primary hasn't responded to an approval request yet, tell the 3rd party "I need to check with my human first — I'll get back to you"
- [ ] **Self-introduction**: When a sender is newly approved, the agent proactively introduces itself in its own personality/style

### Should Have

- [ ] **Email pre-filter**: Before escalating an unknown email sender to the primary, apply heuristics to filter spam/phishing (bulk mail headers, no personal reference, known spam patterns). Silently discard or log without notifying primary
- [ ] **Approval context**: When notifying the primary of an unknown sender, include any known context from memory (e.g., "This looks like Will Loving's agent — Will is your boss at Servos")
- [ ] **Association tracking**: Store in memory that a human and their agent are related (e.g., "Will Loving's CC4Me agent is @will_cc4me_bot") for richer context in future interactions
- [ ] **Revocation command**: Primary can say "revoke access for [sender]" to remove someone from the approved list immediately
- [ ] **3rd party interaction summary**: When the primary asks, provide a summary of recent 3rd party interactions (who talked to me, about what, what was shared)

### Won't Have (for now)

- [ ] Shared Keychain / credential exchange between agents
- [ ] Multi-primary (co-owner) model — there is exactly one primary human per agent
- [ ] Group chat support (only 1:1 direct messages)
- [ ] Automated trust propagation (e.g., "if Dave trusts Will, auto-approve Will's agent")
- [ ] Cross-agent task delegation (e.g., "tell Chrissy's agent to add this to her to-do list")
- [ ] Custom per-sender capability profiles (all approved 3rd parties have the same permissions)

## Constraints

### Security

- The existing Secure Data Gate (Keychain credentials, PII, financial data) remains absolute — 3rd parties never get access regardless of approval level
- Private info gate is a second, softer layer: calendar, schedule, personal preferences, location — requires per-request approval from primary
- Rate limiting prevents abuse from compromised or misbehaving agents
- Approval state is stored locally, not shared externally
- The primary human is the sole authority for approvals — no delegation

### Performance

- Approval notification must be near-instant (within 2 seconds of receiving the unknown sender's message)
- Rate limit checks must not add noticeable latency to message processing
- Email pre-filter should not delay legitimate contact escalation by more than a few seconds

### Compatibility

- Works with existing daemon architecture (v2)
- Extends existing safe-senders.json concept (does not replace it — safe senders remain a separate, higher-trust tier)
- Rate limit parameters stored in `cc4me.config.yaml`
- All channel adapters (Telegram, email, future) must implement the unknown-sender detection hook
- Agent-to-agent communication uses standard Telegram messages — no custom protocol needed

## User Stories / Scenarios

### Scenario 1: Unknown human contacts the agent

- **Given**: Will Loving messages BMO on Telegram for the first time
- **When**: BMO receives the message and Will is not in safe-senders or 3rd-party-approved
- **Then**: BMO sends Dave a Telegram notification: "Will Loving (Telegram: 8549670531) messaged me: 'Hey BMO, can you help me set up my CC4Me?' — approve or deny?" Dave replies "approve". BMO adds Will to 3rd-party-approved, then responds to Will and helps with setup

### Scenario 2: Approved 3rd party asks for private info

- **Given**: Will is already approved and messages BMO
- **When**: Will asks "Is Dave free Thursday afternoon?"
- **Then**: BMO recognizes this requires Dave's calendar (private info). BMO messages Dave: "Will is asking if you're free Thursday afternoon. OK to share?" Dave replies "yes". BMO checks the calendar and responds to Will

### Scenario 3: Agent-to-agent coordination

- **Given**: Chrissy's CC4Me agent (@chrissy_assistant_bot) messages BMO on Telegram
- **When**: The agent says "Chrissy wants to know if Dave can pick up the kids at 3pm"
- **Then**: BMO follows the same flow: if not yet approved, notify Dave. If approved, recognize this is a private info request (Dave's schedule), ask Dave, then respond to Chrissy's agent. BMO logs in memory: "Chrissy's agent is @chrissy_assistant_bot, associated with Chrissy Hurley"

### Scenario 4: Spam email filtered

- **Given**: BMO receives an email from "marketing@deals4u.biz" saying "Dear assistant, please review our offer"
- **When**: BMO's email pre-filter evaluates the message
- **Then**: BMO identifies it as spam (bulk sender, no personal reference, generic content) and silently logs it without notifying Dave

### Scenario 5: Rate-limited sender

- **Given**: A 3rd party agent sends 20 messages in 30 seconds
- **When**: The incoming rate limit (configurable, e.g., 5/min) is exceeded
- **Then**: BMO responds once: "You're sending messages faster than I can process them. Please slow down." BMO pauses processing that sender's messages until the rate drops below the threshold

### Scenario 6: Approval with expiration

- **Given**: A contractor messages BMO asking for help
- **When**: Dave is notified and replies "approve for 1 week"
- **Then**: BMO adds the contractor to 3rd-party-approved with an expiry date of 1 week from now. After expiry, the next message from that contractor triggers a new approval request

### Scenario 7: Enhancement idea from 3rd party interaction

- **Given**: While helping Will set up CC4Me, BMO realizes a setup wizard improvement would help
- **When**: BMO identifies the enhancement opportunity
- **Then**: BMO creates a to-do: "Review potential improvement: setup wizard could auto-detect existing Keychain credentials" tagged for review with Dave

## Technical Considerations

### State File: `3rd-party-senders.json`

```json
{
  "approved": [
    {
      "id": "8549670531",
      "channel": "telegram",
      "name": "Will Loving",
      "type": "human",
      "approved_date": "2026-02-01T18:00:00Z",
      "approved_by": "dave",
      "expires": null,
      "notes": "Dave's boss at Servos"
    },
    {
      "id": "9876543210",
      "channel": "telegram",
      "name": "Chrissy's Assistant",
      "type": "agent",
      "approved_date": "2026-02-02T10:00:00Z",
      "approved_by": "dave",
      "expires": "2026-03-02T10:00:00Z",
      "notes": "Associated with Chrissy Hurley"
    }
  ],
  "denied": [
    {
      "id": "1111111111",
      "channel": "telegram",
      "name": "Unknown",
      "denied_date": "2026-02-01T19:00:00Z",
      "reason": "Unrecognized sender"
    }
  ],
  "blocked": [
    {
      "id": "9999999999",
      "channel": "telegram",
      "name": "Spammer",
      "blocked_date": "2026-02-01T20:00:00Z",
      "blocked_by": "agent",
      "reason": "Repeated requests after denial"
    }
  ],
  "pending": []
}
```

### Config additions to `cc4me.config.yaml`

```yaml
security:
  safe_senders_file: ".claude/state/safe-senders.json"
  third_party_senders_file: ".claude/state/3rd-party-senders.json"
  rate_limits:
    incoming_max_per_minute: 5
    outgoing_max_per_minute: 10
```

### Daemon changes

- **Telegram adapter**: Add unknown-sender check before processing. If unknown, hold the message, notify primary, wait for approval response
- **Email adapter**: Add pre-filter layer before unknown-sender escalation
- **Channel router**: Add outgoing rate limiter
- **New module**: `daemon/src/core/access-control.ts` — centralized sender classification (safe / approved-3rd-party / unknown / denied), expiry checking, rate limiting
- **New scheduler task**: `approval-audit` — periodic review of 3rd-party approvals, flag expired entries, optionally notify primary

### Behavioral changes (CLAUDE.md / system prompt)

- Add 3rd party interaction policy section
- Define capability boundaries clearly
- Document the private info gate
- Update security policy to reference 3rd-party-senders.json

## Resolved Questions

1. **Denied senders**: Denied senders can try again (denial is not a block). If a denied sender persists, the primary can ask the agent to add them to a blocked list. If a sender spams repeated requests, the agent can auto-block them until the primary reviews. Blocked senders are silently ignored — no notification to primary.
2. **Primary unreachable**: Tell the 3rd party "I need to check with my human first — I'll get back to you when I hear from them." Queue the request for when the primary responds.
3. **Self-introduction**: Yes — when a sender is newly approved, the agent introduces itself in its own style/personality. The introduction is at the agent's discretion.
4. **Agent deadlock**: Not a real concern. Both agents simply wait for their respective primaries to approve. No special handling needed — it's just two independent approval flows happening in parallel.
5. **Approval audit**: Periodic, infrequent. Every 6 months. Configurable via `cc4me.config.yaml` cron schedule.

## Open Questions

- None — all questions resolved during interview

## Phasing

### Phase 1: Access Control Foundation
- `access-control.ts` module (sender classification, state file management)
- Unknown sender detection in Telegram adapter
- Approval notification + approve/deny flow
- `3rd-party-senders.json` state file
- CLAUDE.md policy updates

### Phase 2: Capability Boundaries
- Private info gate implementation
- Interaction memory logging
- Enhancement capture (to-do creation)
- Behavioral rules in system prompt

### Phase 3: Rate Limiting & Spam Protection
- Incoming rate limiter per sender
- Outgoing rate limiter per recipient
- Email pre-filter for spam/phishing
- Config parameters in `cc4me.config.yaml`

### Phase 4: Audit & Polish
- Scheduled approval audit task
- Revocation command
- 3rd party interaction summary
- Association tracking in memory
- Documentation updates

## Success Criteria

1. Unknown Telegram sender triggers an approval notification to the primary within 2 seconds
2. Primary can approve/deny via natural language reply on Telegram
3. Approved 3rd party can converse with the agent freely for general tasks
4. Request for primary's private info triggers a second approval prompt to the primary
5. Agent config/state cannot be modified by any 3rd party interaction
6. Rate limiting kicks in and warns sender when threshold exceeded
7. Spam emails are filtered without notifying the primary
8. Expired approvals are detected and the sender is prompted for re-approval
9. All 3rd party interactions are logged to memory
10. Another CC4Me agent can communicate with this agent via Telegram using the same flow as any other sender
