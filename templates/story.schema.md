# Story Schema

Stories are the work units within a plan. They represent discrete pieces of functionality to implement.

## File Location

`plans/stories/s-{id}.json`

## Schema

```json
{
  "id": "s-abc",
  "title": "Implement user authentication",
  "description": "Build login/logout functionality with session management",
  "planRef": "plans/20260128-auth-system.plan.md",
  "todoRef": "abc",
  "status": "in-progress",
  "priority": 1,
  "tests": ["t-001", "t-002"],
  "blockedBy": [],
  "created": "2026-01-28T10:00:00Z",
  "updated": "2026-01-28T14:30:00Z",
  "notes": [
    {
      "timestamp": "2026-01-28T14:30:00Z",
      "content": "Started implementing login form"
    }
  ],
  "files": [
    "src/auth/login.ts",
    "src/auth/session.ts"
  ],
  "acceptanceCriteria": [
    "User can log in with email/password",
    "Session persists across page refreshes",
    "Logout clears session"
  ]
}
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique ID with `s-` prefix |
| `title` | string | Yes | Short story title |
| `description` | string | No | Detailed description |
| `planRef` | string | Yes | Path to parent plan file |
| `todoRef` | string | No | ID of parent to-do (if any) |
| `status` | enum | Yes | `pending`, `in-progress`, `blocked`, `completed` |
| `priority` | number | Yes | Execution order (1 = first) |
| `tests` | string[] | Yes | IDs of associated tests |
| `blockedBy` | string[] | No | Story IDs this is blocked by |
| `created` | ISO datetime | Yes | Creation timestamp |
| `updated` | ISO datetime | Yes | Last update timestamp |
| `notes` | Note[] | No | Progress notes added during build |
| `files` | string[] | No | Files to create/modify |
| `acceptanceCriteria` | string[] | Yes | What defines "done" |

## Status Values

- `pending` - Not started
- `in-progress` - Currently being worked on
- `blocked` - Waiting on another story
- `completed` - All tests pass, criteria met

## Notes

- Stories are **updatable during /build** - status, notes, files can change
- Stories reference tests by ID (tests are separate files)
- Priority determines execution order within the plan
- Acceptance criteria are high-level; detailed steps are in tests
