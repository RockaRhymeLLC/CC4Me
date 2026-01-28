# Validate Reference

Detailed documentation for multi-layer validation to ensure spec, plan, and implementation are aligned.

## Purpose
Validate that:
1. Tests pass (or fail appropriately in planning phase)
2. All spec requirements are covered
3. Tests haven't been modified during build (test integrity)
4. Implementation matches spec intent
5. No gaps or inconsistencies exist

## Usage
```bash
/validate [plan-file-path]
```

Examples:
- `/validate` - Validate current state (finds most recent plan)
- `/validate plans/20260127-telegram-bot.plan.md` - Validate specific plan

## Validation Layers

The validation runs in multiple layers, all of which must pass:

### Layer 1: Automated Tests
**Purpose**: Verify code works correctly

**Process**:
1. Run `npm test` to execute all tests
2. Check exit code and output
3. In planning phase: Tests should FAIL (red state is expected)
4. In build phase: Tests should PASS (green state is required)

**Output**:
```
✓ Layer 1: Automated Tests
  - Ran 12 tests
  - 12 passed, 0 failed
  - Coverage: 87%
```

### Layer 2: Spec Coverage Check
**Purpose**: Ensure all requirements are addressed

**Process**:
1. Read the spec file
2. Parse all requirements (must-have, should-have)
3. Check each requirement has:
   - A corresponding task in TaskList OR
   - A test that validates it OR
   - A completed implementation
4. Identify any gaps

**Output**:
```
✓ Layer 2: Spec Coverage
  - 5 must-have requirements
  - 5 requirements covered
  - 0 requirements missing coverage
  - 2 should-have requirements (optional)
```

### Layer 3: Plan Validation
**Purpose**: Ensure plan is complete and consistent

**Process**:
1. Read the plan file
2. Check that:
   - All tasks in plan match tasks in TaskList
   - Test files referenced in plan exist
   - No unresolved open questions
   - Rollback plan is documented
   - Dependencies are valid (no circular deps)

**Output**:
```
✓ Layer 3: Plan Validation
  - 5 tasks defined
  - 5 tasks in TaskList
  - 1 test file created
  - 0 open questions
  - Rollback plan documented
```

### Layer 4: Test Integrity Check
**Purpose**: Ensure tests haven't been modified since plan phase (during build)

**Process**:
1. Check if we're in build phase (implementation exists in `src/`)
2. If yes, verify test files haven't been modified:
   - Compare test file modification times to implementation files
   - Check git history for test file changes during build
   - Verify test assertions are unchanged from plan phase
3. If no (still in plan phase), skip this layer

**Why This Matters**:
Tests define the contract and must remain immutable during build. If tests are modified during implementation, it breaks the TDD contract and allows "cheating" to make tests pass.

**Output (Plan Phase)**:
```
○ Layer 4: Test Integrity (skipped - no implementation yet)
```

**Output (Build Phase - Tests Unchanged)**:
```
✓ Layer 4: Test Integrity
  - tests/feature.test.ts: Unchanged since plan phase
  - No test modifications detected
  - Tests remain immutable ✓
```

**Output (Build Phase - Tests Modified)**:
```
✗ Layer 4: Test Integrity FAILED
  - tests/feature.test.ts: MODIFIED during build phase
  - Line 23: Assertion changed from expect(x).toBe(5) to expect(x).toBe(3)
  - Line 45: Test commented out

  ❌ CRITICAL VIOLATION: Tests must not be modified during build phase.

  If tests are wrong:
  1. Stop the build
  2. Return to plan phase
  3. Fix tests in the plan
  4. Restart build with corrected tests

  Tests define the contract. Implementation must match tests, not vice versa.
```

### Layer 5: AI Self-Review
**Purpose**: Check implementation matches spec intent

**Process**:
1. Read the original spec file
2. Read the plan file
3. Read the implementation (git diff or file contents)
4. Perform self-review:
   - Does implementation solve the problem stated in spec?
   - Are all success criteria met?
   - Are constraints respected (security, performance)?
   - Are edge cases handled?
   - Is error handling appropriate?
5. Generate discrepancy report if issues found

**Output**:
```
✓ Layer 5: AI Self-Review
  - Spec goal: "Enable Telegram bot integration for async messaging"
  - Implementation review:
    ✓ Bot connects and authenticates
    ✓ Messages are routed to Claude correctly
    ✓ Responses sent back to Telegram
    ✓ Security: User authentication implemented
    ✓ Error handling: Connection failures handled
  - No discrepancies found
```

### Layer 6: Manual Review Checklist
**Purpose**: Human verification of quality

**Process**:
1. Generate a checklist for human review
2. Display checklist to user
3. Request sign-off

**Output**:
```
⚠ Layer 6: Manual Review Required

Please verify the following:
[ ] Feature works as expected manually
[ ] UI/UX is acceptable (if applicable)
[ ] Documentation is updated
[ ] No obvious bugs or issues
[ ] Code quality is maintainable

Type 'approved' to sign off, or describe any issues found.
```

## Workflow Integration

### Called from /plan
When /plan completes, it automatically runs /validate to check:
- Spec is complete (no unresolved questions)
- All requirements mapped to tasks
- Test files created
- Tests are failing (red state)

### Called from /build
When /build completes, it automatically runs /validate to check:
- All tests passing (green state)
- Implementation covers all spec requirements
- Tests haven't been modified (test integrity)
- AI self-review passes
- Ready for manual review

### Called manually
User can run /validate at any time to check current state.

## Validation States

### Planning Phase (before /build)
Expected validation results:
- Layer 1: Tests exist but FAIL (red state) ✓
- Layer 2: Spec coverage complete ✓
- Layer 3: Plan complete ✓
- Layer 4: Test integrity (skipped - no implementation yet)
- Layer 5: AI self-review (skipped - no implementation yet)
- Layer 6: Manual review (skipped - not ready yet)

### Build Phase (during /build)
Expected validation results:
- Layer 1: Tests progressively passing (red → green)
- Layer 2: Spec coverage tracking
- Layer 3: Plan tasks being completed
- Layer 4: Test integrity (checking tests unchanged)
- Layer 5: Implementation in progress
- Layer 6: Not yet ready

### Completion Phase (after /build)
Expected validation results:
- Layer 1: All tests passing (green state) ✓
- Layer 2: Spec coverage 100% ✓
- Layer 3: Plan tasks complete ✓
- Layer 4: Test integrity verified (tests unchanged) ✓
- Layer 5: AI self-review passes ✓
- Layer 6: Manual review pending ⚠️

## Error Handling

If any validation layer fails:
1. Stop validation process
2. Report which layer failed and why
3. Provide actionable guidance for fixing
4. Do NOT proceed to next phase

Example:
```
✗ Validation Failed at Layer 2: Spec Coverage

Missing coverage for requirements:
- "Bot must authenticate users" (no task or test found)
- "Bot must rate limit requests" (no task or test found)

Action needed:
1. Add tasks for these requirements, OR
2. Add tests for these requirements, OR
3. Update spec to remove these requirements

Run /validate again after addressing these issues.
```

## Best Practices

1. **Run early and often**: Validate after spec, after plan, during build
2. **Fix issues immediately**: Don't proceed with failed validation
3. **Trust the layers**: Each layer catches different types of issues
4. **Human review is critical**: AI can't catch everything
5. **Update as you go**: If spec changes, re-run validation

## Output Format

The validation should produce a clear, structured report:

```
🔍 Running Multi-Layer Validation
  Plan: plans/20260127-telegram-bot.plan.md
  Spec: specs/20260127-telegram-bot.spec.md

✓ Layer 1: Automated Tests (12/12 passed)
✓ Layer 2: Spec Coverage (5/5 requirements covered)
✓ Layer 3: Plan Validation (complete)
✓ Layer 4: Test Integrity (tests unchanged since plan)
✓ Layer 5: AI Self-Review (no discrepancies)
⚠ Layer 6: Manual Review (pending user approval)

Status: Ready for manual review
Next: Review the implementation and type 'approved' to continue
```

## Implementation Notes

For the validation scripts:
- `scripts/validate-spec.ts` - Implements Layer 2 (spec coverage)
- `scripts/validate-plan.ts` - Implements Layer 3 (plan validation)
- Layer 1 is `npm test`
- Layer 4 is automated check (git diff, file timestamps)
- Layer 5 is AI-powered (Claude reads and reviews)
- Layer 6 is interactive user prompt

The /validate skill orchestrates all layers and presents unified results.

## Notes

- Validation is a GATE between workflow phases
- Failed validation means "not ready to proceed"
- Validation can be run multiple times as issues are fixed
- Each layer adds a different quality check
- All layers must pass for true validation success
- Layer 4 (Test Integrity) is CRITICAL for maintaining TDD discipline
- Tests are immutable during build - this is enforced by Layer 4
