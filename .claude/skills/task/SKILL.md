---
name: task
description: Manage persistent tasks that survive across sessions. List, add, update, and complete tasks stored in .claude/state/tasks/.
argument-hint: [list | add "description" | update id | complete id | show id]
---

# Task Management

Manage persistent tasks stored in `.claude/state/tasks/`. Tasks survive context clears and compaction.

## Commands

Parse $ARGUMENTS to determine the action:

### List Tasks
- `list` or `ls` or no arguments - Show all open tasks
- `list all` - Show all tasks including completed
- `list priority:high` - Filter by priority
- `list status:blocked` - Filter by status

### Add Task
- `add "Task description"` - Add with default priority (medium)
- `add "Task description" priority:high` - Add with specific priority
- `add "Task description" due:2026-02-01` - Add with due date

### Show Task
- `show {id}` or `{id}` - Show task details including all actions/history

### Update Task
- `update {id} status:in-progress` - Change status
- `update {id} priority:high` - Change priority
- `update {id} note:"Progress note"` - Add action/note to history
- `update {id} blocked:"Waiting on X"` - Mark as blocked with reason

### Complete Task
- `complete {id}` - Mark task as completed
- `done {id}` - Alias for complete

## File Format

Tasks are stored as individual JSON files in `.claude/state/tasks/`.

**Naming Convention**: `{priority}-{status}-{id}-{slug}.json`
- Priority: 1-critical, 2-high, 3-medium, 4-low
- Status: open, in-progress, blocked, completed
- ID: 3-character alphanumeric (e.g., a1b)
- Slug: kebab-case from title (first 30 chars)

**Example**: `2-high-open-a1b-implement-login-flow.json`

See `reference.md` for the full JSON schema.

## Workflow

1. **Read existing tasks**: Glob `.claude/state/tasks/*.json` and parse
2. **Parse command**: Determine action from $ARGUMENTS
3. **Execute action**:
   - List: Display formatted task list
   - Add: Generate ID, create file, confirm
   - Update: Load task, modify, save with new filename if status/priority changed
   - Complete: Update status, rename file, add completion action
4. **Report result**: Confirm what was done

## Output Format

### List Output
```
## Open Tasks (3)

[a1b] HIGH - Implement login flow
      Due: 2026-02-01 | Created: 2026-01-28

[c2d] MEDIUM - Write documentation
      Blocked: Waiting on API spec

[e3f] LOW - Clean up old files
      In Progress
```

### Task Detail Output
```
## Task [a1b]: Implement login flow

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

- Tasks can be referenced from calendar.md via `[task:id]` syntax
- SessionStart hook loads high-priority tasks into context
- PreCompact hook saves active task state

## Notes

- IDs are case-insensitive (stored lowercase)
- When status or priority changes, the file is renamed to maintain sort order
- Completed tasks are kept for history (can be archived manually)
- The `actions` array provides a full audit trail
