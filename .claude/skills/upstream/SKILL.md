---
name: upstream
description: Upstream local enhancements back to the original CC4Me repo. Use when contributing fork improvements to the shared upstream project.
argument-hint: [audit | genericize | analyze | pr | status]
disable-model-invocation: true
---

# Upstream Enhancements

Contribute enhancements from your local fork back to the original CC4Me repository. This is a multi-phase workflow that audits, genericizes, analyzes, and prepares clean PRs.

## Usage

- `/upstream` or `/upstream status` - Show current upstream progress
- `/upstream audit` - Run the full audit + genericize + analyze pipeline
- `/upstream genericize <pr-group>` - Genericize files for a specific PR group
- `/upstream analyze` - Generate or update the analysis document
- `/upstream pr <pr-group>` - Create a PR for a specific group (after review/approval)

## Overview

```
Fork (your repo)                     Upstream (CC4Me)
+--------------+                     +--------------+
| Fork-specific|   /upstream audit   |   Generic    |
|  code with   | ------------------- |  code ready  |
| enhancements |   copy + strip      |  for anyone  |
+--------------+                     +--------------+
       |                                   |
       |         Analysis Doc              |
       |    (tech debt, findings)          |
       |              |                    |
       v              v                    v
   Don't touch    Review with        Create PRs
                    owner            after approval
```

## Key Directories

| Path | Purpose |
|------|---------|
| Fork repo directory | Your fork -- live assistant code. **NEVER modify for upstream work.** |
| Upstream working copy | Working copy of upstream repo. All genericization happens here. |
| `.claude/state/research/upstream-analysis.md` | Analysis document (tech debt, findings, recommendations) |

## Phase 1: Setup Working Copy

```bash
# First time only -- clone the upstream repo
git clone <upstream-repo-url> ~/CC4Me-upstream
cd ~/CC4Me-upstream

# Subsequent runs -- pull latest
cd ~/CC4Me-upstream
git checkout main
git pull origin main
```

Verify the clone is clean and matches the upstream repo before starting.

## Phase 2: Audit & Genericize

### PR Groups

Work through these groups in order. Each becomes a branch and eventually a PR.

#### Group 1: Session Persistence & Lifecycle Hooks
**Branch**: `feature/session-persistence`
**Files to copy from fork**:
- `scripts/start-tmux.sh`
- `scripts/attach.sh`
- `scripts/restart.sh`
- `scripts/restart-watcher.sh`
- `.claude/hooks/session-start.sh`
- `.claude/hooks/pre-compact.sh`
- `.claude/hooks/set-channel.sh`
- `.claude/settings.json` (hook configuration only)
- `.claude/skills/restart/SKILL.md`
- `scripts/start.sh` (updates)

#### Group 2: Email Integration
**Branch**: `feature/email-integration`
**Files to copy from fork**:
- `.claude/skills/email/SKILL.md`
- `scripts/email/jmap.js` (Fastmail)
- `scripts/email/graph.js` (M365)
- `scripts/email-reminder.sh`
- `.claude/knowledge/integrations/fastmail.md`
- `.claude/knowledge/integrations/microsoft-graph.md`
- `.claude/knowledge/integrations/keychain.md`

#### Group 3: Telegram Integration
**Branch**: `feature/telegram-integration`
**Files to copy from fork**:
- `.claude/skills/telegram/SKILL.md`
- `scripts/telegram-send.sh`
- `scripts/transcript-watcher.sh`
- `scripts/telegram-setup/*` (entire directory)
- `.claude/knowledge/integrations/telegram.md`

#### Group 4: Scheduled Jobs & Monitoring
**Branch**: `feature/scheduled-jobs`
**Files to copy from fork**:
- `scripts/todo-reminder.sh`
- `scripts/context-watchdog.sh`
- `scripts/context-monitor-statusline.sh`
- `launchd/` (updated templates)

#### Group 5: Documentation & Setup Updates
**Branch**: `feature/documentation-update`
**Files to copy from fork**:
- `.claude/CLAUDE.md` (rewritten for generic assistant)
- `README.md` (comprehensive update)
- `SETUP.md` (updated with integration steps)
- `.claude/skills/setup/SKILL.md` (updated wizard)
- `scripts/init.sh` (updated with new prereqs)

### Genericization Rules

When copying files from the fork to upstream, apply these transformations:

1. **Remove personal data**: Strip all references to specific people, emails, phone numbers, chat IDs
   - Search for personal names, usernames, phone numbers, domain names
   - Replace with template variables, Keychain lookups, or remove entirely

2. **Remove hardcoded paths**: Replace absolute user paths with relative paths or `$PROJECT_DIR`
   - `start.sh`: Replace hardcoded claude path with `command -v claude` fallback
   - All scripts: Use `$BASE_DIR` or `$(dirname "$0")/..` patterns

3. **Parameterize credentials**: Ensure all secrets come from Keychain lookups, never hardcoded
   - Verify `security find-generic-password` calls use generic credential names
   - Document required Keychain entries in each skill/script

4. **Remove branded content**: App bundles, custom names, personality references
   - Keep templates generic (e.g., `{{NAME}}` not a specific name)

5. **Preserve functionality**: The genericized code must work identically -- just without fork-specific assumptions

### Audit Checklist (Per File)

For each file being copied upstream, evaluate and document:

- [ ] **Hardcoded values**: Any personal data, paths, or credentials?
- [ ] **Code quality**: Clean, readable, well-structured?
- [ ] **Error handling**: Appropriate error handling for the context?
- [ ] **Dependencies**: Are all dependencies documented? Any unnecessary ones?
- [ ] **Security**: Any credential leaks, injection risks, or unsafe patterns?
- [ ] **Portability**: Will this work on a fresh macOS install with different username?
- [ ] **Documentation**: Are comments adequate? Is usage clear?
- [ ] **Tech debt**: Anything that works but should be improved?
- [ ] **Dead code**: Unused variables, unreachable branches, commented-out code?
- [ ] **Consistency**: Does it follow the same patterns as other scripts/skills?

## Phase 3: Analysis Document

Generate `upstream-analysis.md` in `.claude/state/research/` with this structure:

```markdown
# CC4Me Upstream Analysis

## Summary
[Overall assessment, total files reviewed, key findings count]

## Findings by Severity

### Critical (Must Fix Before PR)
[Security issues, broken functionality, data leaks]

### Important (Should Fix)
[Tech debt, poor patterns, missing error handling]

### Minor (Nice to Have)
[Style issues, documentation gaps, minor improvements]

### Notes (Informational)
[Observations, architectural notes, future considerations]

## Findings by PR Group

### Group 1: Session Persistence
[Findings specific to these files]

### Group 2: Email Integration
[Findings specific to these files]

... (repeat for each group)

## Recommendations
[Prioritized list of what to address before vs. after PRs]
```

### What to Look For

- **Tech debt**: Patterns that work but are fragile, hacky, or hard to maintain
- **Old code**: Approaches that made sense early on but should be updated now
- **Bad patterns**: Anti-patterns, security risks, race conditions
- **Missing features**: Error handling, logging, or validation that should exist
- **Inconsistencies**: Different patterns used for the same thing across files
- **Dependencies**: Unnecessary or outdated dependencies
- **Portability issues**: Anything that assumes a specific environment

## Phase 4: Review with Owner

**STOP here and present findings before proceeding.**

1. Save analysis to `.claude/state/research/upstream-analysis.md`
2. Share the analysis with the owner for review
3. Discuss findings -- owner decides what to fix now vs. later
4. Get explicit approval before creating any commits or PRs

## Phase 5: Create PRs (After Approval)

For each approved PR group:

```bash
cd ~/CC4Me-upstream
git checkout main
git pull origin main
git checkout -b feature/<branch-name>

# Copy and genericize files (already done in Phase 2)
# Stage changes
git add <files>
git commit -m "Add <feature description>"

# Push and create PR
git push -u origin feature/<branch-name>
gh pr create --title "<PR title>" --body "<description>"
```

### PR Standards
- One logical group per PR
- Clean commit messages describing the "why"
- PR description includes: summary, files changed, testing notes
- No personal data in any committed file

## Phase 6: Merge & Verify

After owner reviews each PR:

1. Merge on GitHub (or via `gh pr merge`)
2. Pull merged changes: `git checkout main && git pull`
3. Verify: Clone fresh to a temp directory, run `init.sh` and `/setup`, confirm everything works
4. Move to next PR group

## Status Tracking

Track progress in the analysis document's summary section:

```markdown
## Progress
| Group | Audit | Genericize | Analysis | Review | PR | Merged |
|-------|-------|------------|----------|--------|----|--------|
| 1. Session Persistence | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| 2. Email Integration   | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| 3. Telegram Integration| [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| 4. Scheduled Jobs      | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| 5. Documentation       | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
```

## Notes

- **Never modify the fork** during upstream work
- **Always work in** the upstream working copy
- **Analysis doc is the source of truth** for what needs attention
- **Owner approval required** before any commits or PRs
- This skill is reusable -- any fork can use `/upstream` to contribute enhancements back
