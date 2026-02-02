---
name: todo
description: Manage persistent to-dos that survive across sessions. List, add, update, and complete to-dos stored in .claude/state/todos/.
argument-hint: [list | add "description" | update id | complete id | show id]
---

# To-Do Management

Manage persistent to-dos stored in `.claude/state/todos/`. To-dos survive context clears and compaction.

## Commands

Parse $ARGUMENTS to determine the action:

### List To-Dos
- `list` or `ls` or no arguments - Show all open to-dos
- `list all` - Show all to-dos including completed
- `list priority:high` - Filter by priority
- `list status:blocked` - Filter by status

### Add To-Do
- `add "To-do description"` - Add with default priority (medium)
- `add "To-do description" priority:high` - Add with specific priority
- `add "To-do description" due:2026-02-01` - Add with due date

### Show To-Do
- `show {id}` or `{id}` - Show to-do details including all actions/history

### Update To-Do
- `update {id} status:in-progress` - Change status
- `update {id} priority:high` - Change priority
- `update {id} note:"Progress note"` - Add action/note to history
- `update {id} blocked:"Waiting on X"` - Mark as blocked with reason

### Complete To-Do
- `complete {id}` - Mark to-do as completed
- `done {id}` - Alias for complete

## File Format

To-dos are stored as individual JSON files in `.claude/state/todos/`.

**Naming Convention**: `{priority}-{status}-{id}-{slug}.json`
- Priority: 1-critical, 2-high, 3-medium, 4-low
- Status: open, in-progress, blocked, completed
- ID: auto-incrementing integer, zero-padded to 3 digits (e.g., 001, 032)
- Slug: kebab-case from title (first 30 chars)

**Example**: `2-high-open-032-implement-login-flow.json`

**Counter file**: `.claude/state/todos/.counter` stores the next available ID number. Read it, use the value as the new ID, then write back the incremented value.

**Legacy IDs**: Older to-dos may use 3-character alphanumeric IDs (e.g., a1b). These are still valid and should be accepted for show/update/complete commands.

See `reference.md` for the full JSON schema.

## Workflow

1. **Read existing to-dos**: Glob `.claude/state/todos/*.json` and parse
2. **Parse command**: Determine action from $ARGUMENTS
3. **Execute action**:
   - List: Display formatted to-do list
   - Add: Generate ID, create file, confirm
   - Update: Load to-do, modify, save with new filename if status/priority changed
   - Complete: Update status, rename file, add completion action
4. **Report result**: Confirm what was done

## Output Format

### List Output
```
## Open To-Dos (3)

[32] HIGH - Implement login flow
     Due: 2026-02-01 | Created: 2026-01-28

[33] MEDIUM - Write documentation
     Blocked: Waiting on API spec

[34] LOW - Clean up old files
     In Progress
```

### To-Do Detail Output
```
## To-Do [32]: Implement login flow

Priority: HIGH | Status: open | Due: 2026-02-01

### Description
Build the login flow with email/password authentication.

### Actions
- 2026-01-28 10:00 - Created
- 2026-01-28 14:30 - Note: Started research on auth libraries
- 2026-01-28 16:00 - Status changed: in-progress

### Next Step
Set up authentication middleware
```

## Integration

- To-dos can be referenced from calendar.md via `[todo:id]` syntax
- SessionStart hook loads high-priority to-dos into context
- PreCompact hook saves active to-do state

## Notes

- New IDs are auto-incrementing integers from `.counter` file
- Legacy alphanumeric IDs (a1b, z6f, etc.) are still recognized
- When status or priority changes, the file is renamed to maintain sort order
- Completed to-dos are kept for history (can be archived manually)
- The `actions` array provides a full audit trail
