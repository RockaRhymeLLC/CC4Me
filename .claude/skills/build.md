---
skill: build
description: Implement features test-first based on a validated plan
tags: [workflow, implementation, test-driven]
---

# /build - Test-Driven Implementation

This skill implements features using test-driven development based on an approved plan.

## Purpose
Write code to make tests pass and meet the specification. This is the implementation phase where we turn red tests into green tests.

## Usage
```bash
/build <plan-file-path>
```

Example: `/build plans/20260127-telegram-integration.plan.md`

## Pre-Build Validation

Before starting implementation, the pre-build hook (`.claude/hooks/pre-build.sh`) will automatically run to verify:
- Spec file exists and is complete
- Plan file exists and is complete
- No unresolved open questions
- Test files exist

If pre-build validation fails, the build will not proceed.

## Workflow

When this skill is invoked, you should:

### 1. Verification Phase

#### Read and understand context
1. Read the plan file (required argument)
2. Extract the spec file path from the plan
3. Read the spec file
4. Read all test files referenced in the plan
5. Review the TaskList for this plan's tasks

#### Verify pre-build conditions
- [ ] Pre-build hook passed (already run automatically)
- [ ] Tests exist and are currently failing (red state)
- [ ] All blockers resolved (no tasks blocked)
- [ ] Plan validation passed
- [ ] Tests written from user's perspective (understand who the user is)

If any verification fails, STOP and report the issue.

#### Test Integrity Check

Before starting implementation, verify test quality:

**Check 1: User Perspective**
- Read the plan's "User Perspective" section
- Understand who will use this feature (Claude Code, human, external system)
- Verify tests simulate that user's actual interaction pattern
- Example: If user is "Claude Code", tests should invoke skills and check outputs

**Check 2: Test Correctness**
- Review each test to ensure expectations are correct
- Check that tests accurately reflect spec requirements
- Verify edge cases are covered

**If tests are wrong or incomplete:**
1. STOP the build immediately
2. Document what's wrong with the tests
3. Return to planning phase: Update plan and regenerate tests
4. DO NOT proceed with build until tests are correct

**Remember: Once build begins, tests are IMMUTABLE.**

### 2. Implementation Phase

#### Test-Driven Development Approach

For each task in the plan:

1. **Read the failing tests**
   - Understand what behavior is expected
   - Identify which tests relate to this task

2. **Update task status**
   - Use TaskUpdate to mark task as "in_progress"

3. **Implement the minimum code to pass tests**
   - Write implementation in the files specified by the plan
   - Follow the technical approach documented in the plan
   - Respect all constraints from the spec (security, performance, etc.)
   - Keep it simple - don't over-engineer

4. **Run tests**
   - Execute `npm test` to check if tests pass
   - If tests fail: debug and fix
   - If tests pass: move to next step

5. **Mark task complete**
   - Use TaskUpdate to mark task as "completed"
   - Move to next task

#### Test Immutability Rule

**CRITICAL: Tests are sacred and MUST NOT be modified during build phase.**

Tests were written during the `/plan` phase from the user's perspective. They define the contract and expected behavior. During `/build`, you may ONLY modify implementation code (in `src/`), NEVER test code (in `tests/`).

**If tests fail:**
- ✅ Fix the implementation to match test expectations
- ❌ NEVER change tests to match implementation

**If tests are incorrect or incomplete:**
- Stop the build phase
- Return to planning phase
- Update the plan with corrected tests
- Restart the build with correct tests

**User Perspective in Tests:**
The tests were written from the actual user's perspective:
- **Claude Code as user**: Tests should invoke skills, check file outputs, verify Claude's behavior
- **Human as user**: Tests should simulate human interactions (CLI commands, file edits, API calls)
- **External system as user**: Tests should simulate API requests, webhook calls, etc.

Tests define HOW the feature will actually be used. Implementation must match this contract exactly.

#### Implementation Guidelines

**DO:**
- Write minimal code to make tests pass AS WRITTEN
- Follow the plan's technical approach
- Respect spec constraints
- Handle errors appropriately
- Add comments for complex logic
- Keep functions focused and small
- Fix implementation when tests fail

**DON'T:**
- ❌ MODIFY TESTS to make them pass (CRITICAL RULE)
- ❌ Comment out failing tests
- ❌ Skip tests to "save time"
- ❌ Change test expectations or assertions
- ❌ Add features not in the spec
- ❌ Ignore security constraints
- ❌ Over-engineer solutions
- ❌ Copy-paste without understanding
- ❌ Leave TODO comments

### 3. Validation Loop

After all tasks are implemented:

1. **Run full test suite**
   ```bash
   npm test
   ```
   - All tests must pass
   - If any fail: fix before proceeding

2. **Run /validate**
   - Automatically invoke the /validate skill
   - Check all validation layers pass
   - Address any issues found

3. **Iterate if needed**
   - If validation fails: fix issues and re-run
   - If validation passes: proceed to completion

### 4. Completion Phase

Once all validation passes:

1. **Update TaskList**
   - Verify all tasks marked as "completed"
   - Check no tasks are blocked or in-progress

2. **Final validation**
   - Run /validate one more time
   - Ensure all layers pass (including AI self-review)

3. **Offer git commit**
   - Ask user if they want to create a commit
   - If yes, create a descriptive commit message based on:
     - Spec goal
     - Implementation summary
     - Tests added/modified
   - Example commit message:
     ```
     Add Telegram bot integration

     Implements async messaging via Telegram bot:
     - Bot authentication and connection
     - Message routing to Claude
     - Response delivery to users
     - User authentication and rate limiting

     Tests: 12 added (all passing)
     Spec: specs/20260127-telegram-bot.spec.md

     Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
     ```

4. **Summary output**
   ```
   ✅ Build Complete!

   Implementation summary:
   - 5 tasks completed
   - 3 files created
   - 2 files modified
   - 12 tests passing
   - All validation layers passed

   Files changed:
   - src/telegram-bot.ts (created)
   - src/message-router.ts (created)
   - tests/telegram-bot.test.ts (created)
   - src/config.ts (modified)
   - package.json (modified)

   Next steps:
   1. Test manually: [instructions from spec]
   2. Review changes: git diff
   3. Commit if satisfied: git commit
   ```

## Error Handling

### Test Failures
If tests fail during implementation:
1. Read the test output carefully
2. Identify which test is failing and why
3. Check implementation against test expectations
4. Fix the code
5. Re-run tests
6. Repeat until green

### Validation Failures
If /validate fails:
1. Identify which validation layer failed
2. Read the detailed error message
3. Fix the issue (could be missing tests, incomplete coverage, etc.)
4. Re-run /validate
5. Don't proceed until validation passes

### Build Errors
If code won't compile or has runtime errors:
1. Read the error message
2. Check syntax and types
3. Verify imports and dependencies
4. Fix the error
5. Re-run tests

## Best Practices

1. **Red-Green-Refactor**
   - Red: Tests fail initially
   - Green: Write code to make tests pass
   - Refactor: Clean up code while keeping tests green

2. **Small iterations**
   - Complete one task at a time
   - Commit after each major task if desired
   - Don't try to implement everything at once

3. **Follow the plan**
   - The plan is your roadmap
   - If you need to deviate, update the plan first
   - Don't add unplanned features

4. **Trust the tests**
   - If tests pass, the feature works
   - If tests fail, the feature is broken
   - Don't bypass tests

5. **Security first**
   - Always respect security constraints
   - Validate inputs
   - Handle errors safely
   - Don't expose sensitive data

## Integration with Hooks

The pre-build hook automatically validates before build starts:
- Runs `scripts/validate-spec.ts`
- Runs `scripts/validate-plan.ts`
- Exits with error if validation fails

This ensures you never start building with an incomplete or invalid plan.

## TaskList Integration

The build phase heavily uses TaskList:
- **Read tasks**: Get implementation tasks from plan
- **Update status**: Mark tasks in_progress and completed
- **Check dependencies**: Ensure blocked tasks don't start early
- **Track progress**: User can see what's done and what's remaining

## Example Flow

```bash
User: /build plans/20260127-telegram-bot.plan.md

Claude:
1. ✓ Pre-build validation passed
2. ✓ Read spec: specs/20260127-telegram-bot.spec.md
3. ✓ Read plan: plans/20260127-telegram-bot.plan.md
4. ✓ Tests currently failing (red state): 12 tests

Implementing 5 tasks:

Task 1/5: Set up Telegram bot connection
  - Creating src/telegram-bot.ts
  - Implementing bot authentication
  - Running tests... ✓ 3 tests passing
  ✓ Task 1 complete

Task 2/5: Implement message routing
  - Creating src/message-router.ts
  - Implementing routing logic
  - Running tests... ✓ 5 tests passing
  ✓ Task 2 complete

[... continue for all tasks ...]

All tasks complete!

Running validation:
✓ Layer 1: All tests passing (12/12)
✓ Layer 2: Spec coverage 100%
✓ Layer 3: Plan complete
✓ Layer 4: AI self-review passed
⚠ Layer 5: Manual review needed

✅ Build complete! Ready for manual review.

Create git commit? [yes/no]
```

## Notes

- This is the THIRD phase of the spec-driven workflow (after /spec and /plan)
- Implementation should be straightforward if planning was thorough
- Tests guide the implementation - they define "done"
- All validation must pass before considering the build complete
- The build phase can be paused and resumed (via TaskList)
