---
name: plan
description: Create implementation plans or add tasks using the spec-driven workflow. Use after completing a spec, ready for technical planning.
argument-hint: [spec-file or task description]
---

# /plan - Planning & Task Management

This skill handles both creating full implementation plans from specs and adding individual tasks to existing plans. The workflow adapts based on the arguments you provide.

## Purpose

Define HOW we'll build features, break work into tasks, and write tests BEFORE implementation. Planning is test-driven: tests are written during this phase and become immutable during build.

## Usage Patterns

### Create New Plan
```bash
/plan <spec-file-path>
```
Examples:
- `/plan specs/20260127-telegram-integration.spec.md`
- `/plan specs/20260127-state-manager.spec.md`

**When to use**: After completing a spec, ready for full technical planning

### Add Task to Plan
```bash
/plan <natural language description>
```
Examples:
- `/plan add unit tests for breakfast module`
- `/plan implement coffee brewing logic`
- `/plan refactor context tracker error handling`

**When to use**: Quick task additions during planning or build

## How It Works

**I infer your intent** based on:
1. **Argument format**:
   - File path → Create full plan from spec
   - Natural sentence → Add task to existing plan
2. **Conversation context**: What plan are we working on?
3. **File system**: What plans exist in `plans/`?

If ambiguous, I'll ask you to clarify.

## Workflows

### Creation Workflow
1. Read and analyze spec file
2. Design technical approach
3. Break down into tasks (with TaskCreate)
4. Identify user perspective for testing
5. Create test files (initially failing/red)
6. Create `plans/YYYYMMDD-feature-name.plan.md`
7. Set as active plan (context tracker)
8. Run validation automatically
9. Suggest next steps: `/build`

### Update Workflow
1. Parse task description
2. Determine target plan (from context or ask)
3. Extract task details (subject, size, dependencies)
4. Add to plan file (markdown)
5. Add to TaskList (TaskCreate)
6. Log change to history
7. Confirm what was added

## Key Principles

**Test-Driven**:
- Tests written during plan phase
- Tests must FAIL initially (red state)
- Tests become IMMUTABLE during build
- Implementation must match tests

**User Perspective**:
- Identify who the user is (Human, Claude Code, External System)
- Write tests from user's viewpoint
- Tests reflect real usage patterns

**Complete Before Build**:
- All tasks defined
- All tests written
- All dependencies mapped
- Validation passed

## Best Practices

**For Creation**:
- Analyze spec thoroughly
- Map every requirement to tasks/tests
- Size tasks realistically (S/M/L)
- Identify clear dependencies
- Write comprehensive tests
- Ensure tests fail initially

**For Updates**:
- Be specific about task scope
- Size appropriately
- Note dependencies if obvious
- Quick iterations encouraged

## Integration

**Context Tracker**: Remembers active plan across conversation
**Task System**: Uses TaskCreate/TaskUpdate for task management
**History Logger**: Records all plan changes
**Validation**: Plans validated before moving to build

See `reference.md` for detailed step-by-step workflows.
