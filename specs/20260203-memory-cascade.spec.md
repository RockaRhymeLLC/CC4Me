# Memory Cascade System

**Created**: 2026-02-03
**Status**: Approved — R2 feedback incorporated
**Related**: Todo #045 (memory v2 migration), existing `memory-consolidation` task

## Overview

Replace the current memory architecture with a cascading time-based system. State snapshots flow through three tiers — 24-hour detail, 30-day summaries, yearly highlights — providing quick reference at different time scales. Individual memory files continue to store permanent facts, with new memories extracted automatically from the daily log.

## Problem

The current memory system has overlapping concerns and gaps:
- `briefing.md` and `assistant-state.md` serve similar purposes (session context)
- `briefing.md` is auto-generated but stale (hasn't regenerated properly)
- Summary directories (`daily/`, `weekly/`, `monthly/`) exist but are empty — never written
- The deprecated `memory.md` still exists in the repo with PII
- No time-based log of what happened — state is overwritten on each save, so history is lost
- No way to answer "what were we working on last Tuesday?" or "when did we set up X?"

## Design

### File Structure

```
.claude/state/
├── assistant-state.md              # Current session context (keep as-is)
├── memory/
│   ├── memories/                   # Individual fact files (keep as-is)
│   │   └── YYYYMMDD-HHMM-slug.md
│   └── summaries/
│       ├── 24hr.md                 # Rolling log of state snapshots (detailed)
│       ├── 30day.md                # Condensed daily summaries (highlights)
│       ├── 2026.md                 # Yearly archive (further condensed)
│       └── 2027.md                 # (created as needed)
```

**Removed:**
- `memory.md` — deleted from repo and upstream (contains PII)
- `briefing.md` — removed, `assistant-state.md` covers this role
- `summaries/daily/`, `summaries/weekly/`, `summaries/monthly/` — replaced by the three-tier files above

### Tier 1: 24-Hour Log (`24hr.md`)

**What**: A rolling markdown file where each state save is appended as a timestamped entry.

**When entries are added**: Every time state is saved — on `/save-state`, `/clear`, `/restart`, and compaction (pre-compact hook).

**Entry format**:
```markdown
---
### 2026-02-03 09:15 — Auto-save: context at 72% used

**Current Task**: Implementing memory cascade spec
**Progress**:
- [x] Wrote spec for memory cascade
- [x] Emailed R2 for feedback
- [ ] Waiting on R2's response

**Context**: Daemon running, 11/11 health checks. Working on #044.
**Blockers**: None

---
```

Each entry is essentially the content of `assistant-state.md` at that moment, appended with a timestamp header and separator.

**Retention**: Entries stay in 24hr.md until the nightly consolidation job processes them. Entries older than ~24 hours are summarized and moved to 30day.md.

### Tier 2: 30-Day Summaries (`30day.md`)

**What**: Condensed daily summaries. Each entry captures the highlights of one day's work.

**Format**:
```markdown
---
### 2026-02-03

Completed 4 todos: context management reliability (#047), memory v2 migration (#045),
agent-to-agent comms spec (#044), speech research (#046). Fixed critical /clear injection
bug — watchdog now uses flag files checked by Stop hook. R2 collaboration on Telegram
reliability and agent comms. Daemon rebuilt, all health checks passing.

Memories: [mem:20260203-0930-r2-contact-info] [mem:20260203-0445-r2-agent-comms-proposal]

---
```

**Summary guidelines**:
- Focus on highlights: what was accomplished, key decisions, problems solved
- Skip routine operations (email checks, daemon restarts, etc.)
- Reference related memory files where they exist
- Aim for 2-4 sentences per daily entry — scannable, not comprehensive
- Include snapshot count in header: `(from 12 snapshots)` to gauge day density

**Retention**: Entries stay in 30day.md until they're older than 30 days, at which point the consolidation job summarizes them further into the yearly file.

### Tier 3: Yearly Archive (`2026.md`, `2027.md`, etc.)

**What**: Further-condensed monthly summaries. High-level highlights for long-term reference.

**Format**:
```markdown
---
### February 2026

Built CC4Me v2 daemon architecture. Migrated from shell scripts to Node.js.
Key features: transcript streaming, Telegram integration, context watchdog,
memory cascade system. Set up agent-to-agent comms with R2. Started speech
integration research. Major reliability fixes to context management and
Telegram delivery.

Memories: [mem:20260203-0445-r2-agent-comms-proposal] [mem:...]

---
```

**Summary guidelines**:
- Monthly granularity — one entry per month
- Aim for 3-5 sentences — themes, milestones, significant changes
- Reference key memory files
- Just the highlights reel

### Memory Extraction

During the nightly consolidation, the agent reviews 24hr.md entries and extracts new memories for anything important or interesting that doesn't already have a memory file. Examples:

- New people mentioned → person memory
- Technical decisions made → decision memory
- New tools installed → technical memory
- Preferences expressed → preference memory

Each extracted memory gets a standard v2 memory file in `memories/`. References go both directions:
- Source entries in 24hr.md/30day.md get annotated with `[mem:YYYYMMDD-HHMM-slug]`
- Memory files include a `source` field in frontmatter pointing back to which log entry they were extracted from

## Requirements

### Must Have

1. **Delete `memory.md`** from repo and upstream CC4Me project (contains PII, deprecated)
2. **Delete `briefing.md`** — `assistant-state.md` covers this role
3. **State append on save**: `/save-state`, `/clear`, `/restart`, and pre-compact hook append current state to `summaries/24hr.md`. Append throttling: skip if content hash matches the last entry, or enforce minimum 15-minute gap between appends to avoid near-identical snapshots from frequent watchdog fires.
4. **Nightly consolidation task** (rewrite existing `memory-consolidation`):
   - Review 24hr.md entries → extract new memories with back-references
   - Summarize entries older than 24h → append daily summary to 30day.md
   - Summarize 30day.md entries older than 30 days → append monthly summary to yearly file
   - Remove processed entries from source files after summarizing
5. **Consolidation is high priority**: Blocks other scheduled tasks while running. Added to calendar for visibility.
6. **Update session-start hook**: Load from `assistant-state.md` only (remove briefing.md loading)
7. **Update all references**: CLAUDE.md, system-prompt.txt, skill files — remove briefing.md mentions
8. **Clean up empty dirs**: Remove `summaries/daily/`, `summaries/weekly/`, `summaries/monthly/`

### Nice to Have

9. **Consolidation runs as Claude**: The nightly job could inject a prompt that triggers BMO to do the review, rather than the daemon doing mechanical summarization. This lets BMO apply judgment about what's worth remembering.
10. **Memory deduplication**: When extracting memories, check existing `memories/` files to avoid creating duplicates
11. **Search command**: `/memory search "last month"` could search across all three tiers
12. **Retention config**: Make summary length guidelines and retention periods configurable in `cc4me.config.yaml`

### Resolved Questions (from R2 review)

1. **Summary length**: Use sentence-count targets (2-4 sentences daily, 3-5 monthly) rather than character limits. Character counts are hard to eyeball when writing; sentence counts are natural. Soft guidelines, not hard caps.

2. **Who summarizes**: Hybrid approach confirmed. Claude does the summarization and memory extraction (requires judgment). Daemon handles scheduling, file management, and tier promotion. If Claude isn't running when the job fires, defer rather than do a mechanical fallback — a late good summary beats an on-time bad one.

3. **Confidence decay**: Removed. The cascade itself is the decay mechanism — details naturally compress through tiers. Individual memories stay at full confidence. Exception: memories can be explicitly marked as `superseded` when replaced by newer info (different from time-based decay).

## Implementation Notes

### Files to Modify

| File | Change |
|------|--------|
| `daemon/src/automation/tasks/memory-consolidation.ts` | Rewrite for cascade logic |
| `.claude/hooks/pre-compact.sh` | Append state to 24hr.md before compact |
| `.claude/skills/save-state/SKILL.md` | Add state append to 24hr.md |
| `.claude/skills/restart/SKILL.md` | Add state append to 24hr.md |
| `.claude/hooks/session-start.sh` | Remove briefing.md loading |
| `.claude/CLAUDE.md` | Update memory references |
| `.claude/state/system-prompt.txt` | Update memory directive |
| `.claude/state/memory.md` | Delete |
| `.claude/state/memory/briefing.md` | Delete |
| `.claude/state/memory/summaries/daily/` | Delete directory |
| `.claude/state/memory/summaries/weekly/` | Delete directory |
| `.claude/state/memory/summaries/monthly/` | Delete directory |
| `cc4me.config.yaml` | Update consolidation task config (schedule, priority) |

### State Append Logic

The append-to-24hr function should be shared (used by save-state skill, restart skill, pre-compact hook). Options:
- Shell function sourced by hooks and scripts
- Daemon endpoint (`POST /state/append-log`) called by hooks
- Inline in each location (simple but duplicated)

**Recommendation**: A small shell function in a shared file (e.g., `scripts/append-state-log.sh`) that hooks and skills source.

### Nightly Schedule

Current: `0 23 * * *` (11pm daily)
Proposed: `0 5 * * *` (5am daily) — runs while Dave is asleep, results ready for morning session. Open to other times.

## Out of Scope

- Upstream memory.md template changes (handled separately via `/upstream`)
- Agent-to-agent memory sharing (covered by #044 agent comms spec)
- Full-text search indexing of memory tiers (future enhancement)
