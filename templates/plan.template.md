# Plan: [Feature Name]

**Created**: [YYYY-MM-DD]
**Spec**: [link to spec file]
**Status**: Planning

## Technical Approach
[High-level architecture decisions, libraries, patterns, and design choices]

## User Perspective

**Primary User**: [Claude Code | Human | External System | Hybrid]

**How They Interact**:
- [Describe how the user will actually use this feature]
- [What commands/actions they will perform]
- [What interface they will use (CLI, API, skill invocation, etc.)]

**Expected User Experience**:
- [What the user will see/receive]
- [How they will know it worked]
- [What feedback they will get]

**Test Approach**:
Tests will simulate the user's actual interaction pattern:
- [Example: "Invoke /spec skill via Skill tool and check created file"]
- [Example: "Run CLI command via Bash and verify stdout output"]
- [Example: "Send HTTP POST to API and check response status"]

**Why This Matters**:
Tests written from the user's perspective ensure we're building what they need, not just what's technically correct internally.

## Files to Create/Modify

### New Files
- `src/new-file.ts` - [purpose and responsibilities]
- `tests/new-file.test.ts` - [test coverage scope]

### Modified Files
- `src/existing-file.ts` - [what changes and why]

## Tasks

- [ ] **Task 1**: [description] (Size: S/M/L)
  - **Dependencies**: [task numbers if any]
  - **Tests**: [which tests must pass]
  - **Acceptance**: [how to verify completion]

- [ ] **Task 2**: [description] (Size: S/M/L)
  - **Dependencies**: [task numbers if any]
  - **Tests**: [which tests must pass]
  - **Acceptance**: [how to verify completion]

- [ ] **Task 3**: [description] (Size: S/M/L)
  - **Dependencies**: [task numbers if any]
  - **Tests**: [which tests must pass]
  - **Acceptance**: [how to verify completion]

## Test Plan (Written BEFORE Build)

**Location**: `tests/feature-name.test.ts`

**IMPORTANT**: Tests are written from the user's perspective (see User Perspective section above). Tests define the contract and are IMMUTABLE during build phase. Implementation must match tests, not vice versa.

### Test Cases

#### Test 1: [description]
- **Setup**: [preconditions and test data]
- **Action**: [what operation to perform]
- **Assert**: [expected result and validation]

#### Test 2: [description]
- **Setup**: [preconditions and test data]
- **Action**: [what operation to perform]
- **Assert**: [expected result and validation]

#### Test 3: [description]
- **Setup**: [preconditions and test data]
- **Action**: [what operation to perform]
- **Assert**: [expected result and validation]

### Edge Cases
- [Edge case 1]
- [Edge case 2]

### Error Scenarios
- [Error scenario 1]
- [Error scenario 2]

## Validation Checklist

Before moving to Build phase:
- [ ] All spec requirements mapped to tasks
- [ ] User perspective identified and documented
- [ ] Tests written from user's perspective (not just internal APIs)
- [ ] Tests written and currently failing (red)
- [ ] Tests are immutable (cannot be changed during build)
- [ ] No unresolved open questions from spec
- [ ] Security implications reviewed
- [ ] Performance implications considered
- [ ] Dependencies identified and documented
- [ ] AI has reviewed plan against spec (via /validate)

## Rollback Plan
[How to undo if this breaks things - migration steps, database rollback, feature flags, etc.]

## Estimated Complexity
- **Size**: [Small/Medium/Large]
- **Risk**: [Low/Medium/High]
- **Confidence**: [High/Medium/Low]

## Notes
[Any additional context, concerns, or considerations]
