# Spec: Browser Hand-Off (Agent-Driven with Human Assist)

**Created**: 2026-02-06
**Status**: Final (post devil's advocate + R2 peer review)
**Related**: Todo #065

## Goal

Give BMO the ability to use a cloud browser for autonomous web tasks — and seamlessly tag Dave in when hitting blockers like CAPTCHAs, logins, or human verification. Dave unblocks, BMO carries on.

## The Core Idea

BMO is doing a task that requires a web browser: paying a bill, purchasing a product, registering for an event, filling out a form. BMO drives the browser autonomously. When BMO hits something it can't handle — a CAPTCHA, a login page, a confusing UI, human verification — it sends Dave a live view URL on Telegram. Dave taps in, handles the blocker, says "all yours." BMO resumes and finishes the job.

**BMO drives. Dave assists when needed.** The hand-off is the escape valve, not the primary mode.

## Why Browserbase, Not Local Playwright?

BMO already has a local Playwright MCP server. Here's why it isn't enough:

| | Local Playwright MCP | Browserbase |
|---|---|---|
| **Live view for Dave** | No — headless, no way to share | Yes — shareable URL, works on any device |
| **Phone hand-off** | No — Dave would need to VNC into Mac Mini | Yes — tap a Telegram link, interact in mobile browser |
| **Login persistence** | Possible but brittle (local profile dirs) | Built-in context API, encrypted at rest |
| **Session recording** | No | Automatic video recording |
| **CAPTCHA solving** | No | Built-in (Developer plan) |
| **Good for** | BMO-only tasks (research, screenshots, scraping) | Tasks requiring human hand-off |

**Bottom line**: Local Playwright works when BMO never needs help. Browserbase is needed when Dave might need to jump in — which is the whole point of this feature.

## Phased Approach

### Phase 1: Hand-Off Infrastructure (this spec)

The plumbing: session management, context persistence, hand-off mechanics (live view URL delivery + resume), Telegram relay for typing, and the sidecar process architecture.

Phase 1 gives BMO the ability to:
- Launch a cloud browser and navigate to URLs
- Take screenshots and visually assess page state (BMO uses its own intelligence — no heuristic blocker detection needed)
- Send Dave a live view URL with context when stuck ("Need you to handle this CAPTCHA on verizon.com")
- Wait for Dave to signal completion (or abort), then resume
- Save login state per site so Dave only logs in once
- Relay keystrokes from Telegram (for passwords, form fields Dave needs to type)

BMO can navigate programmatically in Phase 1 (go to URL, click elements, fill fields), but doesn't have site-specific knowledge yet. It handles explicit navigation steps given by a higher-level task, and hands off when blocked.

**Pre-implementation gate**: Before writing code, validate the mobile live view UX. Create a free Browserbase account, launch a test session, and have Dave open the live view URL on his phone. If mobile interaction is painful, revisit the approach.

### Phase 2+: Site-Specific Skills (built as needed)

Per-site flows built as skills when Dave actually needs them. Example: a "pay Verizon bill" skill that knows the navigation flow, where to click, and which steps are likely to need hand-off. These get built organically — when Dave asks BMO to do something on a site for the first time, the hand-off infrastructure handles it. If he asks again, that's when a site skill gets written.

No grand Phase 2/3 plan. Just: "I needed to do this twice, so now there's a skill for it."

## Architecture Overview

```
BMO (Mac Mini)                      Browserbase Cloud                Dave (Phone/Laptop)
+----------------------------+      +---------------------+         +-------------------+
|                            |      |                     |         |                   |
|  Browser sidecar process   |      |  Chrome session     |         |                   |
|    (separate from daemon)  |----->|    - Full browser    |         |  When BMO needs   |
|    - Playwright control    | CDP  |    - Live view URL   |         |  help:            |
|    - Session management    |      |    - Context persist |         |                   |
|    - Context persistence   |      |    - CAPTCHA solving |         |  1. Gets Telegram |
|    - Screenshot/assess     |      |                     |         |     msg + URL     |
|    - Hand-off triggers     |      +---------------------+         |  2. Taps live view|
|                            |                                      |  3. Handles block |
|  Daemon orchestrates via   |                                      |  4. Says "done"   |
|    HTTP (like TTS worker)  |                                      |                   |
|                            |                                      |  Telegram for     |
|  Claude session drives     |                                      |  typing relay     |
|    high-level task logic   |                                      |                   |
+----------------------------+                                      +-------------------+
```

**Key principles**:
1. **BMO drives, Dave assists.** BMO navigates autonomously. Dave only gets tagged when BMO is stuck.
2. **Separate process.** The browser sidecar runs independently (like the TTS worker), communicating with the daemon via HTTP. Keeps `playwright-core` and `@browserbasehq/sdk` out of the daemon's dependency tree.
3. **Telegram as the hand-off channel.** When BMO hits a blocker, it sends Dave a Telegram message with context and the live view URL. Dave helps, then signals completion via Telegram.
4. **Skills drive, sidecar executes.** The sidecar provides low-level browser primitives (navigate, click, type, screenshot). Higher-level task logic — including deciding when to hand off — lives in Claude's session or in site-specific skills (Phase 2+). BMO assesses page state visually via screenshots, not DOM heuristics.
5. **Provider abstraction.** The sidecar's session interface must be abstract enough to swap Browserbase for another cloud browser provider (or local Playwright fallback) without rewriting the daemon or skills.

## Requirements

### Must Have

- [ ] **Browserbase session lifecycle**: Create sessions with optional saved context, connect via CDP, get live view URL, close and save context. Credentials (`credential-browserbase-api-key`, `credential-browserbase-project-id`) stored in Keychain.
- [ ] **Autonomous navigation primitives**: Navigate to URLs, click elements (by selector or text), type into fields, scroll, wait for elements. These are the building blocks BMO uses to drive the browser.
- [ ] **Screenshot-based page assessment**: BMO takes screenshots after each navigation action and uses its own visual intelligence to assess page state. No DOM heuristic blocker detection — BMO is an LLM and can recognize login pages, CAPTCHAs, and unexpected states from screenshots far more reliably than pattern matching. This eliminates an entire module (`blocker-detector.ts`) and is more accurate across diverse sites.
- [ ] **Hand-off trigger**: When BMO decides it's stuck (via screenshot assessment), send Dave a Telegram message with:
  - What BMO was trying to do ("Paying Verizon bill — navigated to account page")
  - What's blocking ("Login page — need you to sign in")
  - The live view URL (tap to interact)
  - A screenshot of the current state
- [ ] **Hand-off resume**: After Dave signals completion ("done", "all yours", "go ahead"), BMO resumes the task. The sidecar takes a fresh screenshot, BMO re-assesses the page state, and continues. If the blocker is still present (Dave didn't finish), BMO re-sends the hand-off request rather than looping silently.
- [ ] **Hand-off abort**: Dave can say "abort" or "cancel" to cleanly exit a hand-off. BMO closes the session, saves context, and reports what happened. If Dave goes silent for the configured hand-off timeout, BMO closes the session and creates a retry todo.
- [ ] **Live view URL delivery**: Send the `debuggerFullscreenUrl` to Dave via Telegram. Include security reminder ("This link gives full browser access — don't forward it"). URL expires when session ends.
- [ ] **Context persistence**: Use Browserbase contexts to save login state per site. Dave logs in once during a hand-off; future sessions reuse saved cookies/localStorage. YAML manifest maps site names to context IDs.
- [ ] **Telegram text relay**: During a hand-off, Dave can send "type: [text]" in Telegram and BMO types it into the focused input field via Playwright. Solves the mobile keyboard problem and lets Dave enter passwords without BMO storing them.
- [ ] **Screenshot on request**: BMO can take screenshots at any time (for its own assessment or to send to Dave).
- [ ] **Session timeout with warnings**: Default 30 minutes per session. Warn Dave at 5 minutes remaining. Auto-close and save context on timeout. Idle warnings if Dave has been tagged but hasn't responded.
- [ ] **Orphan session recovery**: On sidecar startup, check Browserbase API for active sessions from previous runs. If Dave was actively using a session (hand-off in progress), attempt to reconnect rather than close. Only close truly abandoned sessions (no hand-off active, or session idle beyond timeout). This prevents killing Dave's active session after a sidecar crash.
- [ ] **Separate sidecar process**: Browser module runs as its own Node.js process, not inside the daemon. Daemon starts/stops it and communicates via HTTP. Must include a `/health` endpoint (like TTS worker).
- [ ] **Session cleanup on error**: If CDP connection drops, session errors, or sidecar crashes, ensure the Browserbase session is handled cleanly. Prefer reconnection over closure when keepAlive is available.
- [ ] **Provider abstraction**: Session creation, connection, screenshot, and context APIs must be behind an interface so Browserbase can be swapped for another provider (or local Playwright) without rewriting calling code.
- [ ] **Payment approval via Telegram**: At payment confirmation steps, BMO asks Dave via Telegram: "Verizon bill is $142.50 — okay to confirm?" Dave approves, BMO clicks confirm. No session hand-off needed — just a quick chat approval. Dave may grant blanket approvals per-site/amount over time, stored in the context manifest.

### Should Have

- [ ] **Screenshot on session start**: Automatically take a screenshot when session is ready — BMO uses this to assess initial page state.
- [ ] **Context listing and management**: BMO can list saved contexts and delete stale ones. Dave can ask "what sites do I have saved?"
- [ ] **Concurrent session guard**: Only allow one active session at a time.

### Won't Have (Phase 1)

- [ ] **Site-specific skills/recipes**: No per-site navigation flows. BMO follows explicit steps or hands off. (Phase 2+, built as needed.)
- [ ] **General task interpretation**: No "pay the Verizon bill" → figure out steps. The calling context (Claude session or future skill) provides the steps. (Phase 2+.)
- [ ] **Scheduled/recurring tasks**: No automatic "pay bills monthly." Manual trigger only.
- [ ] **Multi-tab sessions**: One tab per session. Simplifies state management.
- [ ] **Cost tracking**: Track cumulative session hours. Nice-to-have, not essential for Phase 1.
- [ ] **DOM-based blocker detection**: No heuristic analysis of page DOM. BMO assesses visually via screenshots. (Revisit only if screenshot assessment proves too slow.)

## Constraints

### Security

- **Credentials**: Browserbase API key and project ID stored in Keychain. Never logged.
- **Live view URLs are unauthenticated**: Anyone with the URL can interact with the session. Only send via private Telegram DM. Never log full URLs. URLs expire when session ends.
- **Telegram relay text is not logged**: When Dave sends "type: [text]" for relay, BMO types it into the browser and immediately discards it. Not stored in any log, memory, or state file. Dave accepts that relay text exists in Telegram message history (encrypted in transit, stored on Telegram's servers). For frequently-used site credentials, Dave may provide passwords for Keychain storage (`credential-{site}-login`) so BMO can fill them autonomously without relay.
- **Financial confirmations require approval**: BMO never confirms payments without Dave's explicit Telegram approval. BMO describes the payment (amount, payee, site) and waits for "yes" / "go ahead." Dave may grant per-site blanket approvals over time. No silent payments, ever.
- **Session isolation**: One session at a time. Each session scoped to one task.
- **Threat model for live view**: The URL is secret but not authenticated. Risk: Telegram forwarding, phone unlock, shoulder surfing. Mitigations: sessions auto-close on timeout, Dave can close at any time, contexts only persist cookies (not passwords). Acceptable risk for the convenience.

### Performance

- **Session creation**: Under 10 seconds to ready state.
- **Telegram relay latency**: Under 2 seconds from Dave's message to keystrokes in browser.
- **Screenshot delivery**: Under 5 seconds.
- **Hand-off round-trip**: From BMO deciding it's stuck → Dave getting Telegram message: under 10 seconds.

### Compatibility

- **Browserbase plan**: Start with free tier (1 hr/month, 15-min max sessions) to validate API integration and prove the concept. Upgrade to Developer plan ($20/month) for keepAlive, CAPTCHA solving, 6-hour max sessions, and 100 browser hours/month once the PoC is validated.
- **Sidecar dependencies**: `@browserbasehq/sdk`, `playwright-core`. Runs as separate Node.js process.
- **Dave's devices**: Live view works in mobile Safari and Chrome. Telegram relay handles typing.
- **Network**: Requires internet on Mac Mini for Browserbase API + CDP WebSocket.
- **CDP resilience**: WebSocket connections can drop. Sidecar detects disconnects and attempts reconnection (keepAlive preserves session in cloud). If reconnection fails after 3 attempts, notify Dave and close cleanly.

## Success Criteria

1. **Autonomous with hand-off**: BMO is performing a task that requires navigating to verizon.com. BMO launches a session with saved Verizon context, navigates to the site, and finds itself on the account dashboard (cookies still valid). BMO continues the task without involving Dave.

2. **Login hand-off**: BMO navigates to a site, detects a login page. BMO sends Dave a Telegram message: "I'm trying to [task] on chase.com but I need you to log in. Here's the browser: [live view URL]" with a screenshot. Dave taps the link, logs in, says "done." BMO takes a fresh screenshot, sees the dashboard, continues working.

3. **CAPTCHA hand-off**: BMO is navigating and hits a Cloudflare challenge page. BMO sends Dave: "Hit a CAPTCHA on [site]. Can you handle it? [live view URL]". Dave solves it, says "go ahead." BMO continues.

4. **Password relay**: During a login hand-off, Dave is on his phone. Instead of typing the password in the tiny live view keyboard, he sends "type: mypassword" in Telegram. BMO types it into the password field. Dave taps "Sign In" in the live view.

5. **Context reuse**: BMO opened chase.com last week and Dave logged in. This week, BMO opens chase.com again — the saved context has valid cookies, no login needed. BMO proceeds autonomously.

6. **Crash recovery (idle)**: Sidecar crashes with no active hand-off. Daemon restarts it. Sidecar finds the orphaned Browserbase session via API, closes it. No hours wasted.

6b. **Crash recovery (active hand-off)**: Sidecar crashes while Dave is actively using the live view. Daemon restarts sidecar. Sidecar detects the orphaned session, sees it was in a hand-off state, and attempts to reconnect via keepAlive rather than closing it. Dave's live view continues working. BMO re-establishes CDP connection and resumes.

7. **Financial safety**: BMO navigates to a payment confirmation page. BMO messages Dave on Telegram: "Verizon bill is $142.50 — okay to confirm?" Dave replies "yes." BMO clicks confirm. No session hand-off needed.

## User Stories / Scenarios

### Scenario 1: Smooth Autonomous Flow (No Hand-Off Needed)
- **Given**: BMO has saved context for verizon.com with valid cookies
- **When**: BMO launches a session to check the account balance
- **Then**: BMO navigates to verizon.com, lands on the dashboard (already logged in), reads the balance, closes the session. Dave is never involved.

### Scenario 2: Login Hand-Off
- **Given**: BMO is performing a task that requires accessing a website
- **When**: BMO navigates to the site, takes a screenshot, and sees a login page
- **Then**: BMO sends Dave a Telegram message with context, screenshot, and live view URL. Dave opens the link, logs in, says "done." BMO takes a fresh screenshot, confirms it's past the login, continues the task. Context is saved on session close.

### Scenario 3: CAPTCHA / Human Verification Hand-Off
- **Given**: BMO is navigating autonomously and hits a CAPTCHA or "verify you're human" challenge
- **When**: BMO takes a screenshot and recognizes the blocker
- **Then**: BMO sends Dave a hand-off request with the live view URL. Dave solves the challenge, says "all yours." BMO resumes.

### Scenario 4: Payment Approval via Telegram
- **Given**: BMO has navigated to a payment confirmation page as part of a bill-pay task
- **When**: BMO reaches the "Confirm Payment" step
- **Then**: BMO messages Dave on Telegram: "Verizon bill is $142.50 — okay to confirm?" Dave replies "yes." BMO clicks the confirm button. No session hand-off needed — just a quick approval in chat.

### Scenario 4b: Blanket Payment Approval
- **Given**: Dave has previously told BMO "auto-approve Verizon payments under $200"
- **When**: BMO reaches a Verizon payment confirmation for $142.50
- **Then**: BMO confirms the payment autonomously and notifies Dave after: "Paid Verizon bill — $142.50."

### Scenario 5: BMO Is Confused
- **Given**: BMO is navigating a site and encounters an unexpected page or can't figure out the next step
- **When**: BMO takes a screenshot, assesses it visually, and can't determine how to proceed
- **Then**: BMO sends Dave a hand-off with screenshot: "I'm on [site] trying to [task] but I'm not sure what to do next. Can you take a look? [live view URL]". Dave takes over temporarily, navigates past the confusion, says "okay, try now." BMO resumes.

### Scenario 6: Idle Hand-Off Timeout
- **Given**: BMO sent Dave a hand-off request but Dave is busy
- **When**: 10 minutes pass with no response from Dave
- **Then**: BMO sends a reminder: "Still waiting for your help on [site] — the session will close in 20 minutes." At 30 minutes, BMO closes the session, saves context, and tells Dave: "Closed the browser session. I'll retry [task] when you're available."

### Scenario 7: Typing Relay During Hand-Off
- **Given**: Dave is helping BMO log into a site from his phone
- **When**: Dave needs to type a password but the live view mobile keyboard is awkward
- **Then**: Dave taps the password field in live view, then sends "type: mySecurePass123" in Telegram. BMO types it into the field. Dave taps "Sign In" in live view.

## Technical Considerations

### Sidecar Process Architecture

Following the TTS worker pattern:

```
daemon/src/browser/
  browser-sidecar.ts              # Main entry point — HTTP server on internal port
  session-manager.ts              # Browserbase session lifecycle + CDP connection
  context-store.ts                # YAML manifest mapping site names → context IDs
  provider.ts                     # Abstract provider interface (Browserbase impl first)
```

No `blocker-detector.ts` — BMO assesses page state visually via screenshots using its own LLM intelligence. This is more accurate than DOM heuristics and eliminates an entire module.

The sidecar exposes a focused HTTP API on an internal port (e.g., 3849):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /health` | GET | Health check (like TTS worker) |
| `POST /session/start` | POST | `{"url": "...", "context": "verizon"}` → start session, return live view URL + screenshot |
| `POST /session/stop` | POST | Close session, optionally save context |
| `POST /session/navigate` | POST | `{"url": "..."}` → navigate to URL, return screenshot |
| `POST /session/type` | POST | `{"text": "..."}` → type into focused element |
| `POST /session/click` | POST | `{"selector": "..."}` or `{"text": "Pay Now"}` → click element |
| `POST /session/scroll` | POST | `{"direction": "down"}` → scroll page |
| `GET /session/screenshot` | GET | Returns screenshot as PNG |
| `GET /session/status` | GET | Current session info or "no active session" |
| `GET /contexts` | GET | List saved contexts |
| `DELETE /contexts/:name` | DELETE | Delete a saved context |
| `POST /cleanup` | POST | Find and close/reconnect orphaned sessions |

### Hand-Off Flow

Simplified — no formal state machine across processes. The sidecar tracks one thing: is there an active session or not. Hand-off logic lives in BMO's Claude session (which already knows what it's doing and why).

```
BMO working → takes screenshot → "I'm stuck" → sends Dave Telegram msg + live view URL
                                                       ↓
BMO working ← takes screenshot ← "done" from Dave ←───┘
                                                       ↓ (or)
              session closed ← "abort" from Dave ←─────┘
                                                       ↓ (or)
              session closed ← timeout (no response) ←─┘
```

The daemon routes Telegram messages during an active hand-off:
- `type: [text]` → relay to sidecar `/session/type` — text is NOT logged
- `done` / `all yours` / `go ahead` → signal BMO to resume (take screenshot, continue)
- `abort` / `cancel` → close session, save context, stop task
- `screenshot` → get screenshot from sidecar, send via Telegram
- Other messages → normal Telegram handling

### Context Management

```yaml
# .claude/state/browser-contexts.yaml
contexts:
  verizon:
    browserbase_context_id: "ctx_abc123"
    last_used: "2026-02-06"
    last_verified: "2026-02-06"     # Last time cookies were confirmed valid (no login needed)
    domain: "verizon.com"
    notes: "Dave's personal account"
    payment_approval:               # Optional blanket approval
      max_amount: 200
      auto_approve: true
  chase:
    browserbase_context_id: "ctx_def456"
    last_used: "2026-02-01"
    last_verified: "2026-02-01"
    domain: "chase.com"
    notes: "Primary checking"
```

Context invalidation: When BMO opens a site with saved context but hits a login page anyway, it updates `last_verified` and proceeds with a hand-off. Over time, BMO learns which sites expire cookies quickly (banks) vs. slowly (utilities).

### Telegram Integration During Hand-Off

When a hand-off is active, the daemon intercepts Telegram messages from Dave:

| Message pattern | Action |
|----------------|--------|
| `type: [text]` | Relay to sidecar `/session/type` — text is NOT logged |
| `screenshot` | Get screenshot from sidecar, send via Telegram |
| `done` / `all yours` / `go ahead` | Signal BMO to resume task |
| `abort` / `cancel` | Close session, save context, stop task |
| Other messages | Normal Telegram handling (not browser-related) |

Dave uses the live view directly for clicking, scrolling, and visual interaction. Telegram is just for typing relay (passwords, form fields) and signaling. This keeps the Telegram command surface minimal and avoids focus race conditions.

### CDP Reconnection Strategy

```typescript
// On WebSocket disconnect:
// 1. Wait 2 seconds, retry
// 2. Wait 5 seconds, retry
// 3. Wait 10 seconds, retry
// 4. If all fail, notify Dave, close session
// keepAlive (Developer plan) preserves session in cloud during disconnects
```

### Config Addition

```yaml
integrations:
  browserbase:
    enabled: true
    sidecar_port: 3849
    default_timeout: 1800       # 30 min per session
    idle_warning: 600           # 10 min idle → reminder
    handoff_timeout: 1800       # 30 min waiting for Dave before auto-close
    default_region: "us-east-1"
    block_ads: true
    solve_captchas: true
    record_sessions: false      # Disabled by default (privacy). Enable per-session for debugging.
    context_store: ".claude/state/browser-contexts.yaml"
```

### Dependencies (sidecar only)

```bash
npm install @browserbasehq/sdk playwright-core
```

No browser binary needed. `playwright-core` connects via CDP over WebSocket to Browserbase's cloud Chrome.

### Cost Estimate

Developer plan: $20/month for 100 browser hours.

Estimated usage:
- 2-3 autonomous tasks per week requiring browser
- ~10-15 minutes per session (BMO drives efficiently, hand-offs are brief)
- ~2-4 hours/month
- Well within limits
- Orphan recovery prevents runaway costs

## Resolved Questions

- [x] **Pricing commitment**: Start with free tier to validate the API integration. Upgrade to Developer ($20/month) once PoC is proven.
- [x] **Password relay via Telegram**: Acceptable risk — relay text in Telegram history is fine. For frequently-used sites, Dave will provide passwords for Keychain storage so BMO can fill them directly.
- [x] **Session recording privacy**: Disabled by default. Enable per-session when debugging. Too much sensitive info on screen (bank accounts, personal data) to record routinely.
- [x] **Payment confirmation scope**: BMO asks for Telegram approval before confirming payments — no session hand-off needed, just a quick "okay to pay $X?" in chat. Dave may grant per-site blanket approvals over time (e.g., "auto-approve Verizon under $200"). Trust-based escalation.

## Notes

- **Devil's advocate review #1** (2026-02-06): Original spec flagged for overcomplexity — was trying to build all phases at once. Scoped to infrastructure only. Telegram relay for typing was the reviewer's suggestion.
- **Reframed** (2026-02-06): Dave clarified the mental model — BMO drives autonomously, Dave assists when blocked. Spec rewritten to reflect "agent-driven with human assist" rather than "human-driven with agent assist."
- **Devil's advocate review #2** (2026-02-06): PAUSE verdict with strong recommendations: (1) drop blocker detection — use screenshots + LLM visual assessment instead of DOM heuristics, (2) validate mobile live view UX before writing code, (3) simplify state machine, (4) require provider abstraction in Phase 1, (5) address sidecar crash during active hand-off. All incorporated.
- **R2 peer review** (2026-02-06): SHIP IT with additions: (1) focus race condition on type relay — solved by limiting Telegram commands to `type:` and `done` only, Dave uses live view for clicking/scrolling, (2) timeout + abort handling for hand-off state — added `abort` command and hand-off timeout, (3) context invalidation detection — added `last_verified` timestamp tracking. Also confirmed sidecar pattern is "strong yes" and health endpoint needed.
- **Decisions** (2026-02-06 evening): Free tier first → Developer upgrade after PoC. Telegram relay text in history is acceptable risk; Dave will provide some passwords for Keychain. Session recording off by default. Payments: Telegram approval (not hand-off), with blanket approvals possible per-site over time.
- Free tier: 1 hr/month, 15-min max sessions — only useful for API validation. May need Developer plan ($20/month) sooner than expected since free tier's 15-min max is shorter than the hand-off timeout.
- Live view URLs are the killer feature for hand-offs — no install, works on any device, fully interactive.
- Context persistence is what makes this practical — Dave logs in once per site, BMO reuses cookies (until they expire, tracked via `last_verified`).
- keepAlive (Developer plan) is essential for session resilience during CDP disconnects.
- Sites with aggressive anti-bot/IP fingerprinting (banks) may not work with Browserbase. Test per-site. Not a blocker for most sites.
- Provider abstraction is a Phase 1 requirement — Browserbase could change pricing or features.
