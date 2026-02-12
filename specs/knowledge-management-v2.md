# Knowledge Management v2

**Status**: Draft
**Authors**: R2D2, BMO
**Requested by**: Dave
**Created**: 2026-02-12

## Problem Statement

Our current memory systems have grown organically and now have issues:

1. **Orphaned memories**: Work done on todos generates memories, but no back-links exist
2. **Duplicate/overlapping content**: Multiple memories about the same topic (R2: 150 files, BMO: 240 files)
3. **Unclear boundaries**: No clear rules for what goes where (memory vs todo note vs skill doc vs config)

## Goals

- Clear taxonomy for different types of knowledge
- Bidirectional linking between related items
- Rules for when to consolidate vs keep separate
- Improved nightly consolidation that enforces these rules

---

## 1. Knowledge Taxonomy

### Proposed Categories

| Type | Purpose | Lifespan | Location |
|------|---------|----------|----------|
| **Memory** | Persistent facts, patterns, preferences | Long-term (rarely changes) | `memory/memories/` |
| **Todo Work Note** | Progress on a task, decisions during work | Task lifetime | `todos/*.json` actions array |
| **Timeline** | Events, sessions, milestones | Permanent (append-only) | `memory/timeline/` |
| **Skill Doc** | Procedures, how-to, API patterns | Until superseded | `.claude/skills/*/` |
| **Config** | Runtime settings, feature flags | Until changed | `cc4me.config.yaml` |
| **Briefing** | Auto-loaded summary for session start | Regenerated nightly | `memory/briefing.md` |

### What Goes Where

**Memory** (facts to remember):
- People: names, relationships, preferences
- Accounts: usernames, services, identifiers (not secrets)
- Patterns: "X is better than Y for Z"
- Preferences: "User prefers dark mode"
- Decisions: "We chose Supabase over Firebase because..."

**NOT Memory** (common mistakes):
- ❌ "Dashboard shipped tonight" → Timeline event
- ❌ "PlayPlan has 1085 tests" → Status update (stale quickly)
- ❌ "Fixed bug in webhook handler" → Todo work note
- ❌ "How to use Open-Meteo API" → Skill doc or reference

**Todo Work Note** (progress tracking):
- What was tried, what worked/didn't
- Decisions made during implementation
- Files touched, commits made
- Blockers encountered

**Timeline** (what happened when):
- Session summaries
- Milestones achieved
- Collaboration events
- NOT detailed how-to (that's skill docs)

**Skill Doc** (procedures):
- Step-by-step instructions
- API patterns and examples
- Troubleshooting guides
- Reference material

**Briefing** (session context):
- Auto-generated from high-importance memories
- Loaded at session start via hook
- Should NOT duplicate individual memory content
- Regenerate nightly, not append
- Keep concise: summaries only, link to full memories

### Memory Subcategories

Current `category` field values:
- `person` — People, contacts, relationships
- `preference` — How the user likes things
- `technical` — Dev environment, tools, architecture patterns *(50% of BMO's files — too broad)*
- `account` — Usernames, services, non-secret identifiers
- `website` — Site-specific knowledge (selectors, quirks, auth flows)
- `decision` — Choices made and rationale
- `other` — Catch-all (minimize use)

**Proposed changes:**
- Split `technical` into:
  - `infrastructure` — Servers, hosting, deployment, networking
  - `tool` — Specific tools, CLIs, libraries, APIs
  - `architecture` — System design, patterns, approaches
- Add `pattern` — Reusable approaches ("Open-Meteo > wttr.in for weather")

---

## 2. Cross-Referencing

### Current State

- Memories rarely reference todos
- Todos rarely reference memories
- No standard linking syntax
- No automated link creation

### Proposed Solution

**Linking Syntax:**
```
[todo:014] — links to todo ID 014
[memory:20260212-0030-open-meteo] — links to memory file
[skill:browser] — links to skill
[timeline:2026-02-12] — links to timeline date
```

**When creating a memory from todo work:**
- Memory MUST include `related_todos` in frontmatter (array)
- Example:
```yaml
---
date: 2026-02-12T00:30:00
category: pattern
subject: Open-Meteo weather API
related_todos: ["014"]
---
```

**When superseding an existing memory:**
- New memory MUST include `supersedes` field
- Old memory gets `superseded_by` field added
- Example:
```yaml
---
date: 2026-02-12T00:30:00
category: tool
subject: Weather API choice
supersedes: "20260201-1200-wttr-in-weather"
---
```

**When completing a todo:**
- Todo completion note SHOULD list extracted memories
- Example:
```json
{
  "type": "completed",
  "timestamp": "2026-02-12T00:30:00Z",
  "note": "Implemented weather fallback",
  "extracted_memories": ["20260212-0030-open-meteo"]
}
```

**Automated linking (nightly consolidation):**
- Scan memories for `[todo:XXX]` patterns
- Scan todos for memory file references
- Generate missing back-links

---

## 3. Consolidation Rules

### When to Consolidate

**MERGE when:**
- Same subject, different timestamps (status updates about same thing)
- Superseded information (old decision replaced by new)
- Fragmented facts about same entity (multiple "Dave" memories)

**KEEP SEPARATE when:**
- Different subjects (even if related)
- Different categories (person vs preference)
- Time-sensitive context matters (decision A led to decision B)

### Consolidation Process

1. **Identify candidates**: Same subject slug or high keyword overlap
2. **Review content**: Are they truly about the same thing?
3. **Merge strategy**:
   - Keep most recent timestamp
   - Preserve all unique facts
   - Note consolidation in frontmatter: `consolidated_from: [file1, file2]`
4. **Archive originals**: Move to `memory/archived/` (don't delete)

### Example Consolidation

Before (3 files):
- `20260212-0300-dashboard-status-extended-design.md`
- `20260212-0301-r2d2-status-extended-live.md`
- `20260212-0303-team-ops-dashboard-live.md`

After (1 file):
- `20260212-0303-team-ops-dashboard.md`
```yaml
---
date: 2026-02-12T03:03:00
category: technical
subject: Team ops dashboard
consolidated_from:
  - 20260212-0300-dashboard-status-extended-design
  - 20260212-0301-r2d2-status-extended-live
  - 20260212-0303-team-ops-dashboard-live
---
```

---

## 4. Nightly Consolidation Improvements

### Current Process

1. Rotate stale 24hr entries to timeline
2. Extract new memories
3. (No dedup, no consolidation, no linking)

### Proposed Additions

**Phase 1: Pre-rotation cleanup**
- Check new memories against existing (dedup)
- If duplicate subject exists, append facts instead of creating new file

**Phase 2: Cross-reference scan**
- Parse all memories for `[todo:XXX]` references
- Parse all todos for memory mentions
- Generate missing back-links

**Phase 3: Consolidation candidates**
- Identify memories with same subject slug
- Flag for review (don't auto-merge without human approval)
- Generate consolidation report

**Phase 4: Taxonomy enforcement**
- Flag memories that look like events (should be timeline)
- Flag memories that look like procedures (should be skill doc)
- Generate taxonomy violations report

### Consolidation Report Format

```markdown
## Nightly Consolidation Report — 2026-02-12

### Dedup
- Skipped 2 duplicates (already existed)

### Cross-References Added
- Memory 20260212-0030-open-meteo → linked to todo:014
- Todo 014 → linked to memory 20260212-0030-open-meteo

### Consolidation Candidates (requires review)
- dashboard-related: 5 files could merge to 1
- playplan-status: 3 files could merge to 1

### Taxonomy Violations
- 20260212-0301-r2d2-status-extended-live.md — looks like event, consider timeline
```

---

## Open Questions — Resolved

1. **Auto-consolidate vs flag for review?**
   - **Resolution**: Auto-consolidate importance 1-2, flag for review at 3+
   - Low-stakes stuff shouldn't need human review

2. **Retroactive cleanup?**
   - **Resolution**: One-time cleanup as Phase 1 implementation
   - The 63→15 cluster consolidation alone is a huge win
   - Then rules prevent future mess

3. **Shared knowledge base?**
   - **Resolution**: Add `shared: true` field to mark knowledge for sync
   - Agent-comms exchanges new shared memories on heartbeat
   - Categories likely shared: `website`, `pattern`, `tool`
   - Categories likely private: `person`, `preference`, `account`

---

## BMO Audit Findings

### Stats
- **240 files** total
- **76% auto-extracted** (nightly consolidation)
- **50% categorized as 'technical'** (catch-all abuse)

### Top Consolidation Clusters (10 identified)

| Cluster | Files | Target |
|---------|-------|--------|
| BMO Email Account Strategy | 6 | 1 |
| Dave's Email Preferences | 6 | 1 |
| Email Mailbox Routing | 5 | 1 |
| Busy State/Heartbeat | 5 | 1 |
| Memory System Architecture | 6 | 2 |
| Voice Integration | 14+ | 3-4 |
| Worker Agent | 5 | 1-2 |
| Operating Costs/Monetization | 7 | 2 |
| bmobot.ai Infrastructure | 6 | 1-2 |
| Dave's Laptop/Python | 3 | 1 |

**Total**: ~63 files → ~15 files (76% reduction in these clusters alone)

### Orphaned Todos
- 6 memories reference todo IDs in body text
- **NONE** use `related_todos` frontmatter field
- No structured linking exists

### Misclassified Content
- **8 files** should be work notes (transient state) → move to timeline
- **7 files** should be skill docs → move to SKILL.md
- **4 files** should be config docs → move to config or reference

### Schema Issues
- **Importance field**: Two scales in use
  - Numeric 1-5: 181 files
  - String (low/medium/high): 59 files
- **Source field**: 7 distinct values where 3 mean the same thing
- **Dead files**: 14 `.bak` files cluttering directory

### Root Cause
Auto-extraction (76% of files) doesn't check for existing coverage before creating new files. Every nightly run creates new memories even when the subject already exists.

---

## 5. Schema Standardization

### Importance Field
Standardize to **numeric 1-5**:
- 5: Critical (security, credentials, core identity)
- 4: High (people, key decisions, active projects)
- 3: Medium (patterns, tools, preferences)
- 2: Low (context, historical)
- 1: Minimal (transient, may auto-expire)

**Migration**: Convert string values: critical→5, high→4, medium→3, low→2

### Source Field
Standardize to **4 values**:
- `user` — User explicitly stated
- `observation` — Agent observed/inferred
- `extraction` — Nightly consolidation extracted
- `system` — Auto-generated by system

### Cleanup
- Delete all `.bak` files
- Archive superseded memories to `memory/archived/`

---

## Summary of Recommendations

1. **Add `related_todos` frontmatter** — Link memories to originating work
2. **Add `supersedes` field** — Track memory evolution
3. **Standardize importance to numeric** — One scale, consistent
4. **Split 'technical' category** — infrastructure/tool/architecture
5. **Enforce dedup at extraction time** — Check before creating
6. **Move misclassified content** — Work notes to timeline, procedures to SKILL.md
7. **Clean up schema** — Standardize source values, delete .bak files

---

## Implementation Priority

**Phase 0: Stop the bleeding**
1. Dedup at extraction time (rec #5) — Prevents new duplicates

**Phase 1: Retroactive cleanup**
2. One-time consolidation of identified clusters (63→15 files)
3. Schema standardization (importance, source)
4. Delete .bak files, archive superseded

**Phase 2: Cross-referencing**
5. Add `related_todos` to existing memories where applicable
6. Add `supersedes` tracking
7. Automated back-link generation in nightly consolidation

**Phase 3: Taxonomy enforcement**
8. Split 'technical' category
9. Move misclassified content (8 work notes, 7 skill docs, 4 config docs)
10. Add briefing.md regeneration (not append)

**Phase 4: Shared knowledge**
11. Add `shared` field
12. Implement heartbeat sync via agent-comms

---

## Next Steps

1. [x] BMO adds audit findings
2. [x] Resolve open questions
3. [ ] Review with Dave
4. [ ] Get approval on implementation priority
5. [ ] Execute Phase 0 (dedup) immediately
6. [ ] Schedule Phases 1-4
