# Test Schema

Tests define the verification criteria for stories. They are step-by-step instructions for validating functionality.

## File Location

`plans/tests/t-{id}.json`

## Schema

```json
{
  "id": "t-001",
  "title": "Login with valid credentials",
  "description": "Verify user can log in with correct email and password",
  "storyRefs": ["s-abc"],
  "planRef": "plans/20260128-auth-system.plan.md",
  "type": "story",
  "status": "pending",
  "steps": [
    {
      "order": 1,
      "action": "Navigate to /login",
      "expected": "Login form is displayed"
    },
    {
      "order": 2,
      "action": "Enter valid email and password",
      "expected": "Form accepts input"
    },
    {
      "order": 3,
      "action": "Click submit button",
      "expected": "User is redirected to dashboard, session is created"
    }
  ],
  "created": "2026-01-28T10:00:00Z",
  "executedAt": null,
  "result": null
}
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique ID with `t-` prefix |
| `title` | string | Yes | Short test title |
| `description` | string | No | What this test verifies |
| `storyRefs` | string[] | Yes | IDs of stories this tests |
| `planRef` | string | Yes | Path to parent plan file |
| `type` | enum | Yes | `story` (single story) or `feature` (multiple stories) |
| `status` | enum | Yes | `pending`, `passed`, `failed` |
| `steps` | Step[] | Yes | Ordered verification steps |
| `created` | ISO datetime | Yes | Creation timestamp |
| `executedAt` | ISO datetime | No | When test was last run |
| `result` | Result | No | Execution result details |

## Step Schema

```json
{
  "order": 1,
  "action": "What to do",
  "expected": "What should happen"
}
```

## Result Schema (after execution)

```json
{
  "passed": true,
  "notes": "All steps verified successfully",
  "failedStep": null
}
```

Or on failure:

```json
{
  "passed": false,
  "notes": "Login redirect failed",
  "failedStep": 3
}
```

## Test Types

- `story` - Tests a single story's functionality
- `feature` - Tests integration across multiple stories (references multiple storyRefs)

## Status Values

- `pending` - Not yet executed
- `passed` - All steps verified successfully
- `failed` - One or more steps failed

## Immutability Rule

**Tests are IMMUTABLE during /build.**

- Cannot modify test steps, expected outcomes, or criteria
- Can only update: `status`, `executedAt`, `result`
- To change a test's definition, must exit build and get user approval
- This ensures implementation matches the spec, not vice versa

## Notes

- Tests reference stories (storyRefs), stories reference tests back
- Feature-level tests span multiple stories for integration verification
- Steps are ordered and should be executed sequentially
- Each step has an action (what to do) and expected result (what should happen)
