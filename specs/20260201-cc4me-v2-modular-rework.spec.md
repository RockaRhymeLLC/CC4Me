# Spec: CC4Me v2 — Modular Architectural Rework

## Problem Statement

CC4Me v1 was built incrementally over several days. Each feature was added as needed, resulting in a system that works but has accumulated significant technical debt:

- **8 launchd jobs + 24 scripts** — too many moving parts
- **Unreliable message delivery** — bash transcript watcher parsing 300KB+ JSONL lines
- **Context loss on compaction** — pre-compact hook saves a generic placeholder, not real state
- **Hardcoded values in 15+ files** — no centralized config
- **Duplicated logic everywhere** — "is Claude busy?" reimplemented in 5 scripts
- **Tightly coupled features** — can't update one domain without touching others

## Goals

1. **Reliable messaging** — Messages reach Telegram/email consistently
2. **Context continuity** — Survive compactions with real state, not placeholders
3. **Modular architecture** — Independent feature domains that can be developed, tested, and pushed upstream separately
4. **Architectural simplicity** — Fewer processes, one config file, clear boundaries
5. **Easy setup** — New CC4Me agents configurable in minutes
6. **Feature sharing** — Improvements to any domain benefit all CC4Me agents

## Feature Domains

The system is organized into **independent feature domains**, each ownable and pushable to upstream on its own:

### 1. Core
The daemon skeleton, config system, and shared infrastructure.

| Component | Purpose |
|-----------|---------|
| `daemon/src/core/config.ts` | Load + validate `cc4me.config.yaml` |
| `daemon/src/core/session-bridge.ts` | All tmux interaction: session check, busy detection, inject text, pane capture |
| `daemon/src/core/logger.ts` | Structured JSON logging with rotation |
| `daemon/src/core/keychain.ts` | Single macOS Keychain access implementation |
| `daemon/src/core/health.ts` | System health checks (disk, memory, processes) |
| `daemon/src/core/main.ts` | Daemon entry point, HTTP server, module loader |

**Config section**: `agent`, `tmux`, `daemon` blocks in `cc4me.config.yaml`

### 2. Communications
Bidirectional messaging — how the agent talks to the outside world.

| Component | Purpose |
|-----------|---------|
| `daemon/src/comms/transcript-stream.ts` | Watch transcript JSONL via `fs.watch` + `readline`, emit typed events |
| `daemon/src/comms/channel-router.ts` | Read channel state, route outgoing messages to active adapter |
| `daemon/src/comms/adapters/telegram.ts` | Telegram: webhook receiver, media download, typing indicators, send |
| `daemon/src/comms/adapters/email/index.ts` | Unified email interface |
| `daemon/src/comms/adapters/email/graph-provider.ts` | MS Graph implementation |
| `daemon/src/comms/adapters/email/jmap-provider.ts` | Fastmail JMAP implementation |

**Config section**: `channels` block in `cc4me.config.yaml`
**Replaces**: `transcript-watcher.sh`, `gateway.js`, `telegram-send.sh`, `graph.js`, `jmap.js`

### 3. Automation
Scheduled tasks, reminders, and proactive behaviors.

| Component | Purpose |
|-----------|---------|
| `daemon/src/automation/scheduler.ts` | Cron/interval task runner with built-in busy checks |
| `daemon/src/automation/tasks/todo-reminder.ts` | Remind about open todos |
| `daemon/src/automation/tasks/email-check.ts` | Check unread emails, prompt to reply |
| `daemon/src/automation/tasks/context-watchdog.ts` | Monitor context, trigger save/clear |
| `daemon/src/automation/tasks/nightly-todo.ts` | Self-assigned todo prompt |
| `daemon/src/automation/tasks/health-check.ts` | Periodic system health |

**Config section**: `scheduler` block in `cc4me.config.yaml`
**Replaces**: `todo-reminder.sh`, `email-reminder.sh`, `context-watchdog.sh`, `nightly-todo.sh`, `health-check.sh`, and 5 launchd jobs

### 4. State
Context management, session continuity, and compaction recovery.

| Component | Purpose |
|-----------|---------|
| `.claude/hooks/pre-compact.sh` | Instructs Claude to self-save state (not a placeholder) |
| `.claude/hooks/session-start.sh` | Loads identity, autonomy, todos, calendar, saved state |
| `.claude/state/assistant-state.md` | Session work snapshot (written by Claude, not external script) |
| `.claude/state/context-usage.json` | Context window tracking |

### 5. Memory
Persistent, structured, and efficiently retrievable knowledge.

#### Memory Architecture

```
.claude/state/memory/
  briefing.md              # Auto-generated compact summary (~100 lines)
  memories/                # Individual memory files with frontmatter
  summaries/
    daily/
    weekly/
    monthly/
```

### 6. Soul / Personality
Identity, communication style, autonomy modes, and behavioral rules.

### 7. Knowledge
Reference documentation and integration guides.

### 8. Security
Access control, credential management, and safety policies.

## Architecture

### Single Daemon, Modular Internals

One Node.js daemon process with code organized by domain:

```
daemon/
  src/
    core/           # Shared infrastructure
    comms/          # Communications
    automation/     # Scheduler + tasks
  package.json
  tsconfig.json

cc4me.config.yaml   # Single config file
```

### Config Structure

```yaml
agent:
  name: "BMO"

tmux:
  session: "bmo"

daemon:
  port: 3847
  log_level: "info"
  log_rotation:
    max_size: "10MB"
    max_files: 5

channels:
  telegram:
    enabled: true
    webhook_path: "/telegram"
  email:
    enabled: true
    providers:
      - type: "graph"
      - type: "jmap"

scheduler:
  tasks:
    - name: "context-watchdog"
      interval: "3m"
      config:
        threshold_percent: 35
    - name: "todo-reminder"
      interval: "30m"
    - name: "email-check"
      interval: "15m"
    - name: "nightly-todo"
      cron: "0 22 * * *"
    - name: "health-check"
      cron: "0 8 * * 1"

security:
  safe_senders_file: ".claude/state/safe-senders.json"
```

## Phasing

### Phase 1: Core Foundation
Daemon skeleton, config, session bridge, logging, keychain. Runs alongside v1.

### Phase 2: Communications
Transcript watcher, Telegram adapter, email adapter, channel router.

### Phase 3: Automation + State
Scheduler, all periodic tasks, improved pre-compact hook.

### Phase 4: Polish + Upstream
Docs, setup wizard, fresh-clone validation, upstream PR.

## Success Criteria

1. Telegram messages delivered reliably (no missed final messages)
2. Context compaction preserves real work state
3. Fresh CC4Me setup in under 10 minutes
4. Single `cc4me.config.yaml` controls all behavior
5. Each feature domain independently developable and pushable
6. One daemon process replaces 6+ independent scripts
7. New channel adapter addable without touching core code
