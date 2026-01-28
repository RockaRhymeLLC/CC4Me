---
skill: plan
description: Create an implementation plan with tasks and tests from a specification
tags: [workflow, planning, test-driven]
---

# /plan - Create Implementation Plan

This skill creates a detailed implementation plan with task breakdown and test stubs from an existing specification.

## Purpose
Define HOW we'll build the feature specified in a spec document, create tasks, and write tests BEFORE implementation.

## Usage
```bash
/plan <spec-file-path>
```

Example: `/plan specs/20260127-telegram-integration.spec.md`

## Workflow

When this skill is invoked, you should:

### 1. Validate input
- Check that the spec file path is provided
- Read the spec file and verify it exists
- Parse the spec to understand all requirements

### 2. Analyze the specification
Read and understand:
- All must-have requirements
- All should-have requirements
- Constraints (security, performance, compatibility)
- Success criteria
- User stories/scenarios
- Open questions

### 3. Technical planning

#### Architecture decisions
Consider and document:
- What libraries or frameworks are needed?
- What design patterns are appropriate?
- What files need to be created or modified?
- Are there any architectural implications?

#### File planning
Identify:
- New files to create (with purpose)
- Existing files to modify (with what changes)
- Test files needed

### 4. Task breakdown
Using TaskCreate, break the work into discrete tasks:
- Each task should be completable independently (or have clear dependencies)
- Size tasks as S (< 1 hour), M (1-4 hours), or L (> 4 hours)
- Map each task to specific spec requirements
- Identify which tests must pass for each task
- Set up dependencies using TaskUpdate if tasks must be done in order

Example:
```
Task 1: Set up Telegram bot connection (Size: M)
- Dependencies: None
- Tests: tests/telegram-bot.test.ts - connection tests
- Acceptance: Bot responds to /start command

Task 2: Implement message routing (Size: M)
- Dependencies: Task 1
- Tests: tests/telegram-bot.test.ts - routing tests
- Acceptance: Messages forwarded to Claude correctly
```

### 5. Identify the user perspective

**CRITICAL: Tests must be written from the actual user's perspective.**

Before writing tests, explicitly identify who the user is:

#### User Types

**1. Claude Code (AI as User)**
- Feature is a skill, hook, or Claude-facing functionality
- Tests should:
  - Invoke skills using the Skill tool
  - Check file outputs (specs, plans, generated code)
  - Verify Claude's behavior and responses
  - Simulate how Claude would use the feature
- Example: Testing `/spec` skill → invoke Skill tool, check created spec file

**2. Human User**
- Feature is CLI command, UI, or human-facing functionality
- Tests should:
  - Simulate CLI commands via Bash tool
  - Check stdout/stderr output
  - Verify file system changes
  - Test user interaction flows
- Example: Testing `init.sh` → run via Bash, check output messages, verify setup

**3. External System**
- Feature is API, webhook, or system integration
- Tests should:
  - Simulate HTTP requests
  - Check API responses
  - Verify webhook handling
  - Test integration points
- Example: Testing Telegram bot → simulate webhook POST, check response

**4. Hybrid**
- Feature has multiple user types
- Tests should cover all perspectives
- Example: Validation system → Claude runs it (AI perspective) AND humans can run CLI (human perspective)

#### Document in Plan

In the plan document, add a "User Perspective" section:
```markdown
## User Perspective

**Primary User**: [Claude Code | Human | External System | Hybrid]

**How They Interact**:
- [Describe the interaction pattern]
- [What commands/actions they perform]
- [What they expect to see/receive]

**Test Approach**:
- Tests simulate [specific user actions]
- Assertions check [specific user-visible outcomes]
```

This ensures tests reflect REAL usage, not just internal implementation details.

### 6. Create the plan document

Read `templates/plan.template.md` and create a plan file:
- Filename: `plans/YYYYMMDD-[feature-name].plan.md`
- Extract feature name from spec filename
- Fill in all sections:
  - Link back to the spec file
  - Document technical approach
  - List all files to create/modify
  - Document all tasks (matching what you created with TaskCreate)
  - Create detailed test plan

### 7. Generate test file stubs

For each test file identified in the plan:
- Read `templates/test.template.ts`
- Create the test file with:
  - Proper imports
  - Test structure matching the test plan
  - **Tests written from the user's perspective** (see step 5)
  - Placeholder tests that FAIL initially (red tests)
  - Comments linking back to spec and plan
- Example: `tests/telegram-bot.test.ts`

**User Perspective in Tests**:
The test setup should simulate how the actual user interacts:
```typescript
// Example: Claude Code as user
it('should create spec file when /spec is invoked', async () => {
  // Simulate Claude invoking the skill
  await invokeSkill('spec', ['my-feature']);

  // Check user-visible outcome
  expect(fs.existsSync('specs/20260127-my-feature.spec.md')).toBe(true);
});

// Example: Human as user
it('should display success message to user', async () => {
  // Simulate human running CLI command
  const result = await execBash('./scripts/init.sh');

  // Check what human sees
  expect(result.stdout).toContain('✅ Setup Complete!');
});

// Example: External system as user
it('should respond to webhook POST', async () => {
  // Simulate external system sending request
  const response = await fetch('/webhook', {
    method: 'POST',
    body: JSON.stringify({ message: 'Hello' })
  });

  // Check what external system receives
  expect(response.status).toBe(200);
});
```

**CRITICAL**: Tests must be written to FAIL initially. They should have:
```typescript
expect(true).toBe(false); // Placeholder - will implement during build phase
```

This ensures we're in the "red" state before building.

**Test Immutability**: Once tests are written in the plan phase, they are IMMUTABLE during the build phase. The build phase may only modify implementation code, never test code.

### 8. Validation checklist

Before finishing, verify:
- [ ] All spec requirements have corresponding tasks
- [ ] All tasks have acceptance criteria
- [ ] User perspective identified and documented
- [ ] Test files are created and tests are failing
- [ ] Tests written from user's perspective (not internal implementation)
- [ ] Tests are immutable (cannot be changed during build)
- [ ] No unresolved open questions from spec (if any exist, clarify with user)
- [ ] Security implications reviewed
- [ ] Dependencies between tasks are documented

### 9. Run /validate

Automatically invoke the `/validate` skill to run validation checks.

### 10. Output summary

Display:
- Path to created plan file
- Path to created test files
- Number of tasks created
- Validation results
- Next steps: "Plan created! Next steps:
  1. Review the plan in `plans/YYYYMMDD-[feature-name].plan.md`
  2. Review test stubs in `tests/` directory
  3. Verify tests are failing: `npm test`
  4. When ready, run `/build plans/YYYYMMDD-[feature-name].plan.md` to implement"

## Best Practices

1. **Test-first mindset**: Always create tests before implementation
2. **User-perspective testing**: Write tests from the actual user's point of view
3. **Test immutability**: Tests are sacred - they define the contract and cannot change during build
4. **Granular tasks**: Break work into small, manageable tasks
5. **Clear dependencies**: Document what must be done in order
6. **Map to spec**: Every task should trace back to a spec requirement
7. **Validation-ready**: Plan should include how to verify completion
8. **Red-green-refactor**: Tests start red (failing), build makes them green
9. **Real-world simulation**: Tests should simulate actual usage patterns, not just internal APIs

## Task Creation Guidelines

When using TaskCreate for plan tasks:
- **subject**: Imperative, action-oriented (e.g., "Set up Telegram bot connection")
- **description**: Detailed description including:
  - What needs to be done
  - Why it's needed (link to spec requirement)
  - Acceptance criteria
  - Which tests must pass
- **activeForm**: Present continuous (e.g., "Setting up Telegram bot connection")

After creating tasks, use TaskUpdate to set up dependencies:
```javascript
// If Task 2 depends on Task 1:
TaskUpdate({ taskId: "2", addBlockedBy: ["1"] })
```

## Example Flow

```bash
User: /plan specs/20260127-telegram-bot.spec.md

Claude:
1. ✓ Read spec file
2. ✓ Analyzed requirements (3 must-have, 2 should-have)
3. ✓ Created 5 tasks in TaskList
4. ✓ Created plan: plans/20260127-telegram-bot.plan.md
5. ✓ Created test stubs: tests/telegram-bot.test.ts
6. ✓ Verified tests are failing (red state)
7. ✓ Ran validation checks

Plan created! Next steps:
1. Review the plan in plans/20260127-telegram-bot.plan.md
2. Review test stubs in tests/ directory
3. Verify tests are failing: npm test
4. When ready, run /build plans/20260127-telegram-bot.plan.md
```

## Integration with Validation

The plan phase includes validation to ensure quality:
- Spec coverage check (all requirements have tasks)
- Test existence check (test files created)
- Open questions check (none unresolved)
- TaskList consistency (tasks created and properly linked)

If validation fails, the plan should not be considered complete.

## Notes

- This is the SECOND phase of the spec-driven workflow (after /spec)
- The plan should be reviewed before moving to the build phase
- Plans can be updated as understanding evolves
- The test plan becomes the definition of "done"
- Red tests ensure we're not accidentally passing tests before implementation
