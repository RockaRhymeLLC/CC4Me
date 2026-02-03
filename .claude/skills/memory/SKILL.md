---
name: memory
description: Look up and add facts to persistent memory. Use before asking the user questions they may have already answered.
argument-hint: [lookup "query" | add "fact" | list | search "term"]
---

# Memory Management (v2)

Store and retrieve persistent facts using the v2 memory system: individual files in `.claude/state/memory/memories/` with YAML frontmatter.

## Philosophy

**Check memory before asking.** If you need information that the user may have provided before (preferences, names, accounts, etc.), search memory first. Only ask if it's not there.

## Commands

Parse $ARGUMENTS to determine the action:

### Lookup
- `lookup "query"` - Search memory files for matching facts
- `"query"` - If argument looks like a search query, treat as lookup

Examples:
- `/memory lookup "email"` - Find email-related facts
- `/memory "preferred name"` - What do they like to be called?

### Add
- `add "fact"` - Add a new fact to memory
- `add "fact" category:preferences` - Add with category
- `add "fact" importance:high` - Add with importance level
- `add "fact" tags:tag1,tag2` - Add with tags
- Options can be combined: `add "fact" category:person importance:high tags:family,contact`

Examples:
- `/memory add "Prefers dark mode in all applications"`
- `/memory add "Wife's name is Sarah" category:person importance:high tags:family`

### List
- `list` - Show all memory entries
- `list category:work` - Show entries matching category

### Search
- `search "term"` - Full-text search across all memory files

## File Format (v2)

Memories are stored as individual markdown files in `.claude/state/memory/memories/`.

**Naming Convention**: `YYYYMMDD-HHMM-slug.md`

**File Structure**:
```markdown
---
date: 2026-01-27T09:00:00
category: person
importance: high
subject: Dave Hurley
tags: [owner, identity, telegram]
confidence: 1.0
source: user
---

# Dave Hurley — Identity

- **Name**: Dave Hurley
- **Role**: BMO's owner/operator
- **Telegram chat ID**: 7629737488
```

### Frontmatter Fields

| Field | Required | Values | Default |
|-------|----------|--------|---------|
| `date` | Yes | ISO 8601 timestamp | Current time |
| `category` | Yes | person, preference, technical, account, event, decision, other | other |
| `importance` | Yes | critical, high, medium, low | medium |
| `subject` | Yes | Brief subject line | Derived from fact |
| `tags` | No | Array of searchable tags | [] |
| `confidence` | No | 0.0 to 1.0 | 1.0 |
| `source` | No | user, observation, system | observation |

### Categories
- `person` — People, contacts, relationships
- `preference` — How the user likes things
- `technical` — Dev environment, tools, architecture
- `account` — Usernames, services, non-secret identifiers
- `event` — Things that happened (decays over time)
- `decision` — Decisions made (decays over time)
- `other` — Anything else

## Workflow

### Adding a Fact
1. Determine category, importance, tags from the fact and any explicit options
2. Generate a slug from the subject (kebab-case, max 40 chars)
3. Generate timestamp: `YYYYMMDD-HHMM`
4. Create the file at `.claude/state/memory/memories/YYYYMMDD-HHMM-slug.md`
5. Write YAML frontmatter + markdown content
6. Confirm what was added

**Generating the filename**:
```
Date: 2026-02-03 04:45 → 20260203-0445
Subject: "R2 agent comms proposal" → r2-agent-comms-proposal
Filename: 20260203-0445-r2-agent-comms-proposal.md
```

### Looking Up
1. Use Grep to search `.claude/state/memory/memories/` by keyword
2. Search both file content and frontmatter (tags, category, subject)
3. Return matching facts with their source file
4. If nothing found, say so (don't guess)

### Listing
1. Glob all `.md` files in `memories/` directory
2. If filtering by category, use Grep on frontmatter `category:` field
3. Display grouped by category

### Searching
1. Use Grep to search `.claude/state/memory/memories/` for the search term
2. Return matching lines with file context
3. Include frontmatter metadata (category, importance) in results

## Memory Cascade

State snapshots are appended to `summaries/24hr.md` on every save-state, compact, and restart. A nightly consolidation task (5am) cascades old entries:

- **24hr.md**: Rolling state log — detailed snapshots from the past day
- **30day.md**: Condensed daily summaries (2-4 sentences each, highlights only)
- **2026.md** (yearly): Monthly summaries (3-5 sentences, themes and milestones)

The nightly job also extracts new memories from the 24hr log — new people, decisions, tools, preferences — and creates individual memory files with back-references.

Individual memory files in `memories/` are the source of truth for persistent facts.

## Output Format

### Lookup Result
```
## Memory Lookup: "email"

Found 2 matches:

**20260127-1000-bmo-email-accounts.md** (account, high)
- BMO preferred email: bmo@bmobot.ai (M365, primary)
- BMO email (Fastmail): bmo_hurley@fastmail.com (secondary)

**20260127-0905-dave-emails.md** (person, critical)
- Work email: dhurley@servos.io
- Personal email: daveh@outlook.com
```

### Add Confirmation
```
Added to memory:
  File: 20260203-0445-prefers-dark-mode.md
  Category: preference | Importance: medium
  "Prefers dark mode in all applications"
```

## Best Practices

### What to Remember
- Stated preferences
- Names of people they mention
- Account identifiers (not passwords!)
- Technical preferences and setup
- Important dates
- Frequently referenced information

### What NOT to Remember
- Passwords or secrets (use Keychain)
- Temporary information
- One-time context
- Sensitive data without permission

### Writing Good Memory Files
- One fact or closely related group of facts per file
- Use descriptive subjects for easy scanning
- Tag generously — tags are searchable
- Set importance appropriately (critical/high for permanent facts, medium for context-dependent)
- Use `source: user` when the user stated it directly

## Migration Note

The legacy `.claude/state/memory.md` file is deprecated. All new facts should be written to individual files in `memory/memories/`. The legacy file is kept for reference but is no longer updated.
