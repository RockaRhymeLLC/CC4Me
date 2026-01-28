# To-Do File Reference

Complete JSON schema and examples for to-do files.

## JSON Schema

```json
{
  "id": "a1b",
  "title": "Implement login flow",
  "description": "Build the login flow with email/password authentication.\n\nRequirements:\n- Email validation\n- Password strength check\n- Remember me option",
  "priority": "high",
  "status": "open",
  "created": "2026-01-28T10:00:00Z",
  "due": "2026-02-01",
  "nextStep": "Set up authentication middleware",
  "blockedBy": null,
  "tags": ["auth", "frontend"],
  "specRef": "specs/20260128-auth-system.spec.md",
  "actions": [
    {
      "timestamp": "2026-01-28T10:00:00Z",
      "type": "created",
      "note": null
    },
    {
      "timestamp": "2026-01-28T14:30:00Z",
      "type": "note",
      "note": "Started research on auth libraries"
    },
    {
      "timestamp": "2026-01-28T16:00:00Z",
      "type": "status_change",
      "note": "Changed to in-progress"
    }
  ]
}
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | 3-char alphanumeric identifier |
| `title` | string | Yes | Short to-do title (max 80 chars) |
| `description` | string | No | Full description, supports markdown |
| `priority` | enum | Yes | `critical`, `high`, `medium`, `low` |
| `status` | enum | Yes | `open`, `in-progress`, `blocked`, `completed` |
| `created` | ISO datetime | Yes | When to-do was created |
| `due` | ISO date | No | Due date (YYYY-MM-DD) |
| `nextStep` | string | No | Immediate next action |
| `blockedBy` | string | No | Reason for blocked status |
| `tags` | string[] | No | Categorization tags |
| `specRef` | string | No | Path to related spec file |
| `actions` | Action[] | Yes | Audit trail of all changes |

## Action Types

| Type | When Used |
|------|-----------|
| `created` | To-do first created |
| `note` | Progress note added |
| `status_change` | Status field changed |
| `priority_change` | Priority field changed |
| `completed` | To-do marked complete |
| `reopened` | Completed to-do reopened |

## Priority Mapping

For filename sorting:
- `critical` → `1`
- `high` → `2`
- `medium` → `3`
- `low` → `4`

## Status Mapping

For filename:
- `open` → `open`
- `in-progress` → `in-progress`
- `blocked` → `blocked`
- `completed` → `completed`

## ID Generation

Generate a unique 3-character alphanumeric ID:
1. Use lowercase letters and numbers: `[a-z0-9]`
2. Check against existing to-do IDs
3. If collision, generate new ID

Simple approach:
```javascript
const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
let id = '';
for (let i = 0; i < 3; i++) {
  id += chars[Math.floor(Math.random() * chars.length)];
}
```

## Slug Generation

From the title:
1. Lowercase the title
2. Replace spaces and special chars with hyphens
3. Remove consecutive hyphens
4. Truncate to 30 characters
5. Remove trailing hyphens

```javascript
const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/-+/g, '-')
  .substring(0, 30)
  .replace(/-$/, '');
```

## Filename Examples

```
1-critical-open-x7q-fix-production-outage.json
2-high-in-progress-a1b-implement-login-flow.json
3-medium-blocked-c2d-write-documentation.json
4-low-completed-e3f-clean-up-old-files.json
```

## Example: Creating a To-Do

Input: `/todo add "Set up CI/CD pipeline" priority:high due:2026-02-15`

Generated file: `2-high-open-m9k-set-up-ci-cd-pipeline.json`

```json
{
  "id": "m9k",
  "title": "Set up CI/CD pipeline",
  "description": null,
  "priority": "high",
  "status": "open",
  "created": "2026-01-28T12:00:00Z",
  "due": "2026-02-15",
  "nextStep": null,
  "blockedBy": null,
  "tags": [],
  "specRef": null,
  "actions": [
    {
      "timestamp": "2026-01-28T12:00:00Z",
      "type": "created",
      "note": null
    }
  ]
}
```

## Example: Completing a To-Do

When completing to-do `m9k`:

1. Load current file
2. Update status to `completed`
3. Add completion action
4. Rename file from `2-high-open-m9k-...` to `2-high-completed-m9k-...`

Updated JSON:
```json
{
  "status": "completed",
  "actions": [
    // ... previous actions
    {
      "timestamp": "2026-01-30T15:00:00Z",
      "type": "completed",
      "note": "Pipeline deployed and tested"
    }
  ]
}
```

## Listing Algorithm

To list to-dos in priority order:

1. Glob `.claude/state/todos/*.json`
2. Filenames naturally sort by priority (1 before 2, etc.)
3. Filter by status if requested
4. Parse JSON for display details

The filename convention means `ls` output is already priority-sorted.
