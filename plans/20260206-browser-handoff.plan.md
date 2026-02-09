# Plan: Browser Hand-Off (Agent-Driven with Human Assist)

**Spec**: specs/20260206-browser-handoff.spec.md
**To-Do**: 065
**Created**: 2026-02-07
**Reviewed**: 2026-02-07 (devil's advocate — CONCERNS addressed, see review notes below)

## Technical Approach

### Architecture: Sidecar Process Pattern

Following the TTS worker pattern (`daemon/src/voice/tts.ts`), the browser module runs as a **separate Node.js process** communicating with the daemon via HTTP. This keeps `playwright-core` and `@browserbasehq/sdk` out of the daemon's dependency tree and isolates browser session crashes from core daemon services (Telegram, email, scheduler).

The sidecar lives in its own top-level directory (not nested inside `daemon/src/`) for clean separation — same pattern as `voice-client/`:

```
browser-sidecar/
  src/
    main.ts              # Entry point — HTTP server on port 3849
    session-manager.ts   # Browserbase session lifecycle, CDP connection, navigation
    context-store.ts     # JSON manifest: site name → Browserbase context ID
  package.json           # @browserbasehq/sdk + playwright-core
  tsconfig.json
```

### Key Design Decisions

1. **Simple module boundary, not formal abstraction.** Browserbase SDK calls are wrapped in well-named functions in `session-manager.ts`. This IS the provider boundary — if we ever swap providers, we rewrite this one file. No speculative `BrowserProvider` interface.

2. **No blocker detection.** BMO assesses page state visually via screenshots using its own LLM intelligence. The sidecar provides raw screenshots; Claude's session decides what they mean. This eliminates an entire module and is more accurate than DOM heuristics.

3. **Hand-off logic lives in Claude's session.** The sidecar tracks one thing: is there an active session or not. The daemon routes Telegram commands during active hand-offs. All higher-level decision-making (when to hand off, when to resume, what to do next) stays in Claude Code where it belongs.

4. **Telegram as control channel.** During hand-off, the daemon intercepts specific message patterns (`type:`, `done`, `abort`, `screenshot`) and routes them to the sidecar or back to Claude. Everything else flows normally. Commands are only intercepted when a hand-off is active. `type:` must be at message start. `done`/`abort`/`screenshot` are exact single-word matches.

5. **Context persistence via JSON manifest.** A JSON file (`.claude/state/browser-contexts.json`) maps site names to Browserbase context IDs with metadata (`last_used`, `last_verified`, `domain`). Consistent with all other state files in the codebase. Written atomically (write temp + rename) to prevent corruption.

6. **CDP reconnection before closure.** When WebSocket connections drop, the sidecar retries with exponential backoff (2s → 5s → 10s) before giving up. With `keepAlive` (Developer plan), the cloud session survives disconnects.

### Daemon Integration Points

1. **Config** (`cc4me.config.yaml`): New `integrations.browserbase` section with port, timeouts, and feature flags.
2. **Startup** (`main.ts`): `initBrowserSidecar()` spawns the sidecar process, watches for READY signal.
3. **Health** (`main.ts`): Periodic `/health` checks (like TTS worker). Auto-restart on failure.
4. **Shutdown** (`main.ts`): `stopBrowserSidecar()` sends SIGTERM, cleans up.
5. **Telegram interception** (`telegram.ts`): In `processIncomingMessage()`, check for hand-off commands before injecting into Claude session.
6. **Keychain** (`keychain.ts`): Add `getBrowserbaseApiKey()` and `getBrowserbaseProjectId()` accessors.

### Browserbase SDK Usage

- **Package**: `@browserbasehq/sdk` + `playwright-core` (sidecar-only dependencies)
- **Session creation**: `bb.sessions.create({ projectId, keepAlive, browserSettings: { context, blockAds, solveCaptchas } })`
- **CDP connect**: `chromium.connectOverCDP(session.connectUrl)` — use `browser.contexts()[0]` (never `newContext()`)
- **Live view**: `bb.sessions.debug(sessionId)` → `debuggerFullscreenUrl`
- **Close**: `bb.sessions.update(sessionId, { projectId, status: "REQUEST_RELEASE" })`
- **Orphan detection**: `bb.sessions.list({ status: "RUNNING" })`
- **No `contexts.list()` in SDK** — track context IDs in our own JSON manifest

### Tier Strategy

- **s-b01 (gate)**: Free tier — just need one session to test live view UX
- **s-b02 onward**: Upgrade to Developer plan ($20/month). Free tier's 15-min session max and lack of `keepAlive` make real development impractical. The $20/month is trivial vs. time cost of working around limits.

## Stories

| ID | Title | Priority | Tests | Blocked By |
|----|-------|----------|-------|------------|
| s-b01 | Pre-implementation gate: validate mobile live view UX | 1 | t-018 | — |
| s-b02 | Browserbase session manager | 2 | t-019, t-020 | s-b01 |
| s-b03 | Sidecar HTTP server + session endpoints | 3 | t-021, t-022 | s-b02 |
| s-b04 | Navigation primitives | 4 | t-023 | s-b03 |
| s-b05 | Context persistence | 5 | t-024, t-025 | s-b03 |
| s-b06 | Daemon integration + lifecycle management | 6 | t-026, t-027 | s-b03 |
| s-b07 | Telegram hand-off commands | 7 | t-028, t-029 | s-b06 |
| s-b08 | Orphan session recovery | 8 | t-031 | s-b03 |
| s-b09 | Session timeout + idle warnings | 9 | t-030 | s-b07 |

## Dependencies

```
s-b01 (gate)
  └── s-b02 (session manager)
        └── s-b03 (sidecar server)
              ├── s-b04 (navigation) — can parallel with b05, b06, b08
              ├── s-b05 (contexts) — can parallel with b04, b06, b08
              ├── s-b06 (daemon integration)
              │     └── s-b07 (telegram commands)
              │           └── s-b09 (timeout + idle warnings)
              └── s-b08 (orphan recovery) — can parallel with b04, b05, b06
```

Stories b04, b05, b06, and b08 can be worked in parallel after b03. Story b07 requires b06. Story b09 requires b07.

## Files

### New Files
- `browser-sidecar/src/main.ts` — HTTP server + entry point
- `browser-sidecar/src/session-manager.ts` — Browserbase session lifecycle, CDP, navigation
- `browser-sidecar/src/context-store.ts` — JSON manifest management
- `browser-sidecar/package.json` — Sidecar dependencies (SDK + playwright-core)
- `browser-sidecar/tsconfig.json` — TypeScript config
- `.claude/state/browser-contexts.json` — Context manifest (runtime state)
- `.claude/state/browser-session.json` — Active session state for crash recovery

### Modified Files
- `cc4me.config.yaml` — Add `integrations.browserbase` section
- `daemon/src/core/main.ts` — Add sidecar lifecycle (init, shutdown)
- `daemon/src/core/keychain.ts` — Add `getBrowserbaseApiKey()`, `getBrowserbaseProjectId()`
- `daemon/src/comms/adapters/telegram.ts` — Add hand-off command interception

## Review Notes (2026-02-07)

Devil's advocate sub-agent returned **CONCERNS**. Changes incorporated:

1. **Moved sidecar to top-level `browser-sidecar/` directory** — Was `daemon/src/browser/` with nested package.json. Now cleanly separated like `voice-client/`.
2. **Simplified provider layer** — Dropped formal `BrowserProvider` interface and `providers/` directory. Clean module boundary in `session-manager.ts` is sufficient. One file to rewrite if we ever swap providers.
3. **JSON instead of YAML for context store** — Consistency with all other `.claude/state/` files. Atomic writes to prevent corruption.
4. **Split s-b07** — Was "Telegram commands + session timeout + payment approval." Now: s-b07 = Telegram commands, s-b09 = session timeout/warnings. Payment pages are just another hand-off in Phase 1.
5. **Deferred blanket payment approval to Phase 2** — In Phase 1, payment pages trigger a normal hand-off. No auto-approve rules, no amount parsing.
6. **Added measurable pass/fail criteria to s-b01** — Dave can complete a form interaction on his phone in under 60 seconds.
7. **Upgraded to Developer plan after gate** — Free tier is only for s-b01 validation.

Changes NOT incorporated (with reasoning):
- **"Drop sidecar, make in-process"** — Spec decision, R2-approved. Sidecar isolates crash risk from core daemon. Moving to top-level dir addresses the nesting concern.
- **"Skip provider abstraction entirely"** — Already simplified to clean module boundary. No formal interface, just well-named functions in one file.

## Notes

- The sidecar gets its own `package.json` with `@browserbasehq/sdk` and `playwright-core` — these are NOT added to the daemon's dependencies.
- The sidecar is a TypeScript ESM module (same as daemon). Use `import`, never `require()`.
- Tests are acceptance-level (not unit tests). Most require a live Browserbase session. Group live-API tests to minimize session usage.
- The pre-implementation gate (s-b01) is a manual validation step, not code. If mobile UX fails, the entire plan is reconsidered.
- Payment pages in Phase 1 are handled as normal hand-offs to Dave. Blanket approval rules deferred to Phase 2.
- `type:` relay text is NEVER logged — security requirement from the spec.
