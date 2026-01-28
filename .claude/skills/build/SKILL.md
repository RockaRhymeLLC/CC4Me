---
name: build
description: Implement features test-first or request specific build actions. Use after planning is complete, ready for implementation.
argument-hint: [plan-file or build request]
---

# /build - Implementation & Build Management

This skill handles both executing full implementation plans and processing specific build requests. The workflow adapts based on the arguments you provide.

## Purpose

Implement features following test-driven development: make failing tests pass without modifying the tests. Build phase is where code comes to life, guided by immutable tests.

## Usage Patterns

### Execute Full Plan
```bash
/build <plan-file-path>
```
Examples:
- `/build plans/20260127-state-manager.plan.md`
- `/build plans/20260127-telegram-integration.plan.md`

**When to use**: After planning is complete, ready for full implementation

### Request Specific Action
```bash
/build <natural language description>
```
Examples:
- `/build implement coffee brewing first`
- `/build fix context tracker error handling`
- `/build add validation for empty descriptions`
- `/build refactor logger to use streams`

**When to use**: Quick implementation requests or prioritization during build

## How It Works

**I infer your intent** based on:
1. **Argument format**:
   - File path → Execute full build plan
   - Natural sentence → Specific build request
2. **Conversation context**: What are we building?
3. **Task state**: What's in progress, what's pending?

If ambiguous, I'll ask you to clarify.

## Workflows

### Full Build Workflow
1. Pre-build validation (via hook)
2. Read spec, plan, and tests
3. Verify user perspective from plan
4. For each task:
   - Mark in_progress
   - Implement to match tests
   - Run tests (fix implementation, not tests!)
   - Mark completed when green
5. Run validation automatically
6. Offer to create git commit
7. Display summary

### Build Request Workflow
1. Parse request
2. Check current context/tasks
3. Determine action (new implementation, fix, refactor, priority change)
4. Execute or queue
5. Update task status
6. Log action
7. Confirm

## Critical Rules

**Tests are IMMUTABLE**:
- Written during plan phase
- Cannot be changed during build
- If tests are wrong, STOP and return to planning
- Implementation must match tests, not vice versa

**Test-Driven Development**:
- Tests define the contract
- Run tests frequently
- Fix failing tests by changing implementation
- All tests must pass before completion

## Best Practices

**For Full Build**:
- Read tests before coding
- Understand user perspective
- Implement smallest change to make test pass
- Run tests after each change
- Complete tasks in dependency order
- Keep changes focused

**For Build Requests**:
- Be specific about what to build/fix
- Note priority if urgent
- Trust the TDD process
- Don't request test changes

## Integration

**Task System**: Tracks progress through tasks
**Context Tracker**: Maintains build state
**History Logger**: Records all build actions
**Validation**: Ensures quality before completion
**Git**: Commits completed features

See `reference.md` for detailed step-by-step workflows.
