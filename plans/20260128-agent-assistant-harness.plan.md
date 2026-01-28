# Plan: Agent Assistant Harness

**Created**: 2026-01-28
**Spec**: specs/20260127-agent-assistant-harness.spec.md
**Status**: Planning

## Overview

This plan builds a **template framework** for an autonomous personal assistant. The project is meant to be cloned - we're building the infrastructure, skills, hooks, and documentation, not configuring a live instance.

### What We're Building
- Directory structure and file templates
- Skills for task management, state, mode control
- Hooks for session lifecycle (startup, compaction)
- CLAUDE.md instructions for assistant behavior
- Initial setup flow for when the template is cloned
- Integration knowledge base structure

### What We're NOT Building
- Actual Telegram bot (configured at clone time)
- Actual email connection (configured at clone time)
- Real credentials (added by user after cloning)

## Technical Approach

### Architecture

```
CC4Me (Template)
├── .claude/
│   ├── CLAUDE.md              # Assistant behavior instructions
│   ├── settings.json          # Claude Code settings
│   ├── hooks/                 # Lifecycle hooks
│   │   ├── session-start.sh   # Load state on startup
│   │   └── pre-compact.sh     # Save state before compaction
│   ├── skills/                # Assistant capabilities
│   │   ├── mode/              # Autonomy mode control
│   │   ├── task/              # Task management
│   │   ├── memory/            # Memory lookup/add
│   │   ├── calendar/          # Calendar management
│   │   ├── save-state/        # Manual state save
│   │   └── setup/             # Initial setup wizard
│   ├── state/                 # Runtime state (gitignored except templates)
│   │   ├── .gitkeep
│   │   ├── autonomy.json.template
│   │   ├── identity.json.template
│   │   ├── memory.md.template
│   │   ├── calendar.md.template
│   │   ├── safe-senders.json.template
│   │   └── tasks/
│   └── knowledge/
│       └── integrations/      # How-to docs for providers
│           ├── telegram.md
│           ├── fastmail.md
│           └── README.md
├── scripts/
│   └── setup.sh               # Initial setup script
├── launchd/
│   └── com.assistant.harness.plist.template
└── README.md                  # Setup instructions for cloners
```

### User Perspective

**Primary User**: Human cloning the template + Claude Code (the assistant)

**Setup Flow** (when someone clones):
1. Clone repository
2. Run `/setup` or `scripts/setup.sh`
3. Configure identity (name, personality)
4. Set autonomy mode
5. Add safe senders
6. Configure integrations (Telegram bot token, email credentials)
7. Install launchd service (optional)

**Runtime Flow** (after setup):
1. SessionStart hook loads state, autonomy, identity
2. Assistant operates per CLAUDE.md instructions
3. PreCompact hook saves state before context clear
4. Tasks, memory, calendar persist across sessions

## Phases

### Phase 1: Foundation & Structure
Set up directory structure, templates, and core configuration.

### Phase 2: State Management Skills
Build skills for tasks, memory, calendar, and state persistence.

### Phase 3: Lifecycle Hooks
Implement SessionStart and PreCompact hooks for state management.

### Phase 4: Autonomy & Control
Build mode control skill and CLAUDE.md behavior instructions.

### Phase 5: Integration Framework
Create knowledge base structure and integration templates.

### Phase 6: Setup & Documentation
Build setup wizard and documentation for cloners.

## Tasks

### Phase 1: Foundation & Structure

- [ ] **Task 1**: Create state directory structure (Size: S)
  - **Description**: Create `.claude/state/` with subdirectories and .gitkeep files. Add to .gitignore appropriately (state files ignored, templates kept).
  - **Files**: `.claude/state/`, `.claude/state/tasks/`, `.gitignore`
  - **Acceptance**: Directory structure exists, properly gitignored

- [ ] **Task 2**: Create state file templates (Size: S)
  - **Description**: Create template files for autonomy.json, identity.json, memory.md, calendar.md, safe-senders.json with example content and comments.
  - **Files**: `.claude/state/*.template`
  - **Acceptance**: Templates have clear structure and documentation

- [ ] **Task 3**: Create knowledge base structure (Size: S)
  - **Description**: Create `.claude/knowledge/integrations/` with README explaining purpose, plus starter docs for telegram.md and fastmail.md.
  - **Files**: `.claude/knowledge/integrations/`
  - **Acceptance**: Structure exists with helpful README

### Phase 2: State Management Skills

- [ ] **Task 4**: Create /task skill (Size: M)
  - **Description**: Skill for managing persistent tasks. Commands: list, add, update, complete. Reads/writes to `.claude/state/tasks/`. Handles file naming convention ({priority}-{status}-{id}-{slug}.json).
  - **Files**: `.claude/skills/task/SKILL.md`, `.claude/skills/task/reference.md`
  - **Acceptance**: Can create, list, update, complete tasks via natural language

- [ ] **Task 5**: Create /memory skill (Size: S)
  - **Description**: Skill for looking up and adding facts to memory.md. Commands: lookup, add, list. Integrates with CLAUDE.md "check before asking" instruction.
  - **Files**: `.claude/skills/memory/SKILL.md`
  - **Acceptance**: Can lookup and add memory entries

- [ ] **Task 6**: Create /calendar skill (Size: S)
  - **Description**: Skill for managing calendar entries. Commands: show (date/range), add, remove. Can reference tasks via [task:id] syntax.
  - **Files**: `.claude/skills/calendar/SKILL.md`
  - **Acceptance**: Can view and manage calendar entries

- [ ] **Task 7**: Create /save-state skill (Size: S)
  - **Description**: Manual skill to save current state to assistant-state.md. Captures current work, context, next steps. Used before manual /clear or as backup.
  - **Files**: `.claude/skills/save-state/SKILL.md`
  - **Acceptance**: Generates state file with current context

### Phase 3: Lifecycle Hooks

- [ ] **Task 8**: Create SessionStart hook (Size: M)
  - **Description**: Hook that fires on startup/resume/clear/compact. Loads and injects: autonomy mode, identity, current state, pending high-priority tasks. Outputs concise context for assistant.
  - **Files**: `.claude/hooks/hooks.json`, `.claude/hooks/session-start.sh`
  - **Acceptance**: State is loaded and injected on all session starts

- [ ] **Task 9**: Create PreCompact hook (Size: M)
  - **Description**: Hook that fires before context compaction. Saves current state: active task, progress, next steps. Writes to assistant-state.md for recovery.
  - **Files**: `.claude/hooks/pre-compact.sh` (update hooks.json)
  - **Acceptance**: State is automatically saved before compaction

### Phase 4: Autonomy & Control

- [ ] **Task 10**: Create /mode skill (Size: S)
  - **Description**: Skill to view and set autonomy mode. Shows current mode if no args, sets mode if provided (yolo/confident/cautious/supervised). Updates autonomy.json.
  - **Files**: `.claude/skills/mode/SKILL.md`
  - **Acceptance**: Can view and change autonomy mode

- [ ] **Task 11**: Update CLAUDE.md with assistant behavior (Size: M)
  - **Description**: Add comprehensive sections for: autonomy mode behaviors, memory lookup instructions, calendar awareness, security policy (safe senders, secure data gate), self-modification guidelines, context efficiency rules.
  - **Files**: `.claude/CLAUDE.md`
  - **Acceptance**: CLAUDE.md defines complete assistant behavior

### Phase 5: Integration Framework

- [ ] **Task 12**: Create Telegram integration docs (Size: S)
  - **Description**: Knowledge doc for Telegram integration: telegraf setup, bot token configuration, message handling patterns, Keychain storage for token.
  - **Files**: `.claude/knowledge/integrations/telegram.md`
  - **Acceptance**: Clear how-to for Telegram setup

- [ ] **Task 13**: Create Fastmail integration docs (Size: S)
  - **Description**: Knowledge doc for Fastmail integration: IMAP/SMTP or API setup, credential storage, common operations (send, receive, search).
  - **Files**: `.claude/knowledge/integrations/fastmail.md`
  - **Acceptance**: Clear how-to for email setup

- [ ] **Task 14**: Create Keychain integration docs (Size: S)
  - **Description**: Knowledge doc for macOS Keychain: naming conventions (credential-*, pii-*, financial-*), CLI commands, security notes.
  - **Files**: `.claude/knowledge/integrations/keychain.md`
  - **Acceptance**: Clear how-to for secure storage

### Phase 6: Setup & Documentation

- [ ] **Task 15**: Create /setup skill (Size: M)
  - **Description**: Interactive setup wizard for new clones. Steps through: identity config, autonomy mode, safe senders, integration setup prompts. Creates state files from templates.
  - **Files**: `.claude/skills/setup/SKILL.md`, `.claude/skills/setup/reference.md`
  - **Acceptance**: New user can configure assistant via /setup

- [ ] **Task 16**: Create launchd plist template (Size: S)
  - **Description**: Template plist for persistent service. Includes KeepAlive, NetworkState, RunAtLoad. Instructions for customization and installation.
  - **Files**: `launchd/com.assistant.harness.plist.template`, `launchd/README.md`
  - **Acceptance**: Clear instructions for service setup

- [ ] **Task 17**: Update README.md for cloners (Size: M)
  - **Description**: Comprehensive README: what this is, prerequisites, clone & setup instructions, configuration options, usage guide, troubleshooting.
  - **Files**: `README.md`
  - **Acceptance**: Someone can clone and set up from README alone

## Dependencies

```
Phase 1 (Foundation)
    ↓
Phase 2 (State Skills) ←→ Phase 3 (Hooks)
    ↓                        ↓
Phase 4 (Autonomy & CLAUDE.md)
    ↓
Phase 5 (Integrations)
    ↓
Phase 6 (Setup & Docs)
```

Tasks within phases can often run in parallel.

## Test Approach

Since this is a template/framework (not runtime code), testing focuses on:

1. **Structure validation**: Required files/directories exist
2. **Template validity**: JSON templates are valid, markdown is well-formed
3. **Skill testing**: Skills work as documented (manual testing during build)
4. **Hook testing**: Hooks execute correctly (test in Claude Code)
5. **Setup flow**: Can complete setup wizard successfully

## Files Summary

### New Files
- `.claude/state/` directory structure
- `.claude/state/*.template` files (5)
- `.claude/skills/task/` (SKILL.md, reference.md)
- `.claude/skills/memory/SKILL.md`
- `.claude/skills/calendar/SKILL.md`
- `.claude/skills/save-state/SKILL.md`
- `.claude/skills/mode/SKILL.md`
- `.claude/skills/setup/` (SKILL.md, reference.md)
- `.claude/hooks/hooks.json`
- `.claude/hooks/session-start.sh`
- `.claude/hooks/pre-compact.sh`
- `.claude/knowledge/integrations/` (telegram.md, fastmail.md, keychain.md, README.md)
- `launchd/` (plist template, README.md)

### Modified Files
- `.claude/CLAUDE.md` (major additions)
- `.gitignore` (state file rules)
- `README.md` (setup instructions)

## Rollback Plan

This is additive work on a template. To rollback:
1. Remove new skill directories
2. Remove new hook files
3. Remove state directory structure
4. Revert CLAUDE.md changes
5. Git provides full history

## Validation Checklist

- [ ] All 17 Must Have requirements mapped to tasks
- [ ] Template vs runtime distinction clear
- [ ] Setup flow covers all configuration needs
- [ ] CLAUDE.md will define complete assistant behavior
- [ ] Integration docs provide clear guidance
- [ ] README enables self-service setup

## Notes

### Template Philosophy
- Provide structure and patterns
- Document clearly for cloners
- Keep configuration flexible
- Don't hardcode instance-specific values

### What Happens at Clone Time
1. User clones repo
2. Runs /setup (or manually creates state files from templates)
3. Configures their specific: name, personality, safe senders, API keys
4. Optionally installs launchd service
5. Assistant is ready to use

### What the Assistant Can Do After Setup
- Manage tasks across sessions
- Remember facts about the user
- Track calendar and schedules
- Communicate via Telegram/email (once configured)
- Self-modify skills and hooks
- Install packages and MCP servers
- Schedule recurring jobs
