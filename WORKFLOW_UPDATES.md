# Workflow Updates: Test Immutability & User-Perspective Testing

**Date**: 2026-01-27
**Changes**: Enhanced workflow to enforce test immutability and user-perspective testing

## Summary of Changes

The workflow has been updated to ensure true test-driven development practices by:
1. **Enforcing test immutability** during the build phase
2. **Requiring user-perspective testing** during the plan phase
3. **Adding test integrity validation** as a new validation layer

## Why These Changes Matter

### Problem Addressed

In traditional TDD, tests can be inadvertently modified during implementation to make them "pass" more easily. This defeats the purpose of TDD:
- Tests should define the contract (WHAT we're building)
- Implementation should fulfill the contract (HOW we build it)
- If tests change during build, they're no longer defining the contract

Additionally, tests often focus on internal implementation details rather than how users actually interact with features, leading to:
- Brittle tests that break when refactoring
- Tests that pass but features that don't work as users expect
- Poor simulation of real-world usage

### Solution

**Test Immutability**: Tests written during `/plan` phase are **locked** during `/build` phase. The agent can only modify implementation code (`src/`), never test code (`tests/`). If tests are wrong, the build stops and returns to planning.

**User-Perspective Testing**: Tests are written from the actual user's point of view:
- **Claude Code as user**: Tests invoke skills, check file outputs
- **Human as user**: Tests run CLI commands, check stdout
- **External system as user**: Tests send API requests, check responses

This ensures tests simulate real usage patterns, not just internal APIs.

## Files Modified

### 1. `.claude/skills/build.md` ✅
**Changes**:
- Added "Test Immutability Rule" section (CRITICAL section)
- Updated implementation guidelines with strict DON'Ts about modifying tests
- Added "Test Integrity Check" section in verification phase
- Emphasized fixing implementation to match tests, not vice versa

**Key Additions**:
```markdown
**CRITICAL: Tests are sacred and MUST NOT be modified during build phase.**

**If tests fail:**
- ✅ Fix the implementation to match test expectations
- ❌ NEVER change tests to match implementation
```

### 2. `.claude/skills/plan.md` ✅
**Changes**:
- Added new step "5. Identify the user perspective"
- Added detailed user types section (Claude Code, Human, External System, Hybrid)
- Updated test generation section with user-perspective examples
- Added test immutability warning
- Updated best practices with user-perspective principles
- Updated validation checklist

**Key Additions**:
```markdown
## User Types

**1. Claude Code (AI as User)**
- Tests should invoke skills, check file outputs, verify Claude's behavior

**2. Human User**
- Tests should simulate CLI commands, check stdout, verify file changes

**3. External System**
- Tests should simulate HTTP requests, check responses, verify integrations

**4. Hybrid**
- Tests should cover all user perspectives
```

### 3. `.claude/skills/validate.md` ✅
**Changes**:
- Added new "Layer 4: Test Integrity Check"
- Renumbered existing Layer 4 → Layer 5, Layer 5 → Layer 6
- Updated all references to validation layers throughout document
- Updated validation states for all 6 layers
- Updated output format examples
- Added test integrity notes

**Key Additions**:
```markdown
### Layer 4: Test Integrity Check
**Purpose**: Ensure tests haven't been modified since plan phase (during build)

**Output (Build Phase - Tests Modified)**:
✗ Layer 4: Test Integrity FAILED
  - tests/feature.test.ts: MODIFIED during build phase

  ❌ CRITICAL VIOLATION: Tests must not be modified during build phase.
```

### 4. `templates/plan.template.md` ✅
**Changes**:
- Added new "User Perspective" section after "Technical Approach"
- Updated test plan section with immutability warning
- Updated validation checklist with user-perspective items

**Key Additions**:
```markdown
## User Perspective

**Primary User**: [Claude Code | Human | External System | Hybrid]

**How They Interact**:
- [Describe how the user will actually use this feature]

**Test Approach**:
Tests will simulate the user's actual interaction pattern
```

### 5. `.claude/CLAUDE.md` ✅
**Changes**:
- Updated `/plan` workflow to include user perspective identification
- Updated `/validate` workflow to show 6 layers
- Updated `/build` workflow with test immutability emphasis
- Expanded "Key Principles" with test immutability and user perspective
- Updated validation layers section
- Added "Test Integrity Check" subsection
- Updated file modification guidelines

**Key Additions**:
```markdown
4. **Tests are IMMUTABLE during build**: This is CRITICAL
   - During `/build` phase, you may ONLY modify implementation code (`src/`)
   - You may NEVER modify test code (`tests/`) during build
   - If tests are wrong, STOP build and return to planning

5. **User-perspective testing**: Tests simulate how actual users interact
```

### 6. `README.md` ✅
**Changes**:
- Updated "Multi-Layer Validation" section to show 6 layers
- Enhanced "Test-Driven Development" section with immutability rules
- Added new "User-Perspective Testing" subsection
- Updated "Best Practices" section with new items

**Key Additions**:
```markdown
### Multi-Layer Validation

CC4Me validates at 6 distinct levels:
1. Automated tests
2. Spec coverage
3. Plan consistency
4. Test integrity (NEW!)
5. AI review
6. Human review

### User-Perspective Testing
Tests simulate how actual users interact with features:
- **Claude Code as user**: Tests invoke skills and check outputs
- **Human as user**: Tests run CLI and verify stdout
- **External system as user**: Tests send API requests
```

## New Validation Layer

### Layer 4: Test Integrity Check

**When**: During `/build` phase only (skipped in `/plan` phase)

**What it checks**:
- Test files haven't been modified since plan phase
- No changes to test assertions
- No commented-out tests
- Implementation exists but tests are unchanged

**How it works**:
- Compare test file modification times to implementation files
- Check git history for test modifications during build
- Verify test content matches plan phase

**On failure**:
- Report which tests were modified and how
- Stop the build immediately
- Instruct to return to planning phase
- Do NOT allow build to proceed

## Workflow Impact

### Planning Phase (`/plan`)
- **NEW**: Identify user perspective first
- **NEW**: Document user perspective in plan
- Write tests from user's point of view
- Tests simulate actual user interactions
- Tests are now marked as "immutable" from this point forward

### Build Phase (`/build`)
- **NEW**: Test integrity check during verification
- **NEW**: Cannot modify test files at all
- Implementation must match test expectations exactly
- If tests are wrong, stop and return to planning
- Layer 4 validation checks test immutability

### Validation Phase (`/validate`)
- **NEW**: Layer 4 (Test Integrity) added
- Renumbered existing layers 4-5 → 5-6
- Now 6 layers total instead of 5
- Test integrity is enforced during build validation

## Example User Perspectives

### Example 1: Claude Code as User

**Feature**: `/spec` skill that creates specifications

**User Perspective**:
- Primary User: Claude Code (AI)
- Interaction: Claude invokes `/spec` skill with feature name
- Expected: Spec file created in `specs/` directory

**Test Approach**:
```typescript
it('should create spec file when /spec is invoked', async () => {
  // Simulate Claude invoking the skill
  await invokeSkill('spec', ['my-feature']);

  // Check user-visible outcome
  expect(fs.existsSync('specs/20260127-my-feature.spec.md')).toBe(true);
});
```

### Example 2: Human as User

**Feature**: `init.sh` setup script

**User Perspective**:
- Primary User: Human developer
- Interaction: Human runs `./scripts/init.sh` in terminal
- Expected: Success message displayed, dependencies installed

**Test Approach**:
```typescript
it('should display success message to user', async () => {
  // Simulate human running CLI command
  const result = await execBash('./scripts/init.sh');

  // Check what human sees
  expect(result.stdout).toContain('✅ Setup Complete!');
});
```

### Example 3: External System as User

**Feature**: Telegram bot webhook handler

**User Perspective**:
- Primary User: Telegram servers (external system)
- Interaction: POST request to `/webhook` endpoint
- Expected: 200 OK response with JSON body

**Test Approach**:
```typescript
it('should respond to webhook POST', async () => {
  // Simulate external system sending request
  const response = await fetch('/webhook', {
    method: 'POST',
    body: JSON.stringify({ message: 'Hello' })
  });

  // Check what external system receives
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'received' });
});
```

## Benefits

### 1. True Test-Driven Development
- Tests define the contract and never change
- Implementation must match tests exactly
- No cheating by modifying tests to pass
- Forces correct design from the start

### 2. Real-World Usage Testing
- Tests simulate actual user interactions
- Features work as users expect, not just internally
- Better coverage of integration points
- Tests are less brittle during refactoring

### 3. Quality Enforcement
- Test integrity layer catches violations
- Build stops if tests are modified
- Automatic validation of immutability
- Clear guidance when tests are wrong

### 4. Clear Responsibilities
- Planning phase: Define contract (tests)
- Build phase: Fulfill contract (implementation)
- Validation phase: Verify contract met (test integrity)

## Migration for Existing Plans

If you have existing plans created before this update:

1. **Add User Perspective section** to plan document
2. **Review tests** to ensure they're from user's perspective
3. **Mark tests as immutable** (add note to plan)
4. **Re-run /validate** to confirm compliance

## For Future Features

When creating new features:

1. During `/spec`: Think about who the user is
2. During `/plan`:
   - Document user perspective
   - Write tests simulating user interactions
   - Remember tests are now immutable
3. During `/build`:
   - Only modify `src/` directory
   - Never touch `tests/` directory
   - Fix implementation to match tests
4. During `/validate`:
   - Test integrity layer will check immutability
   - All 6 layers must pass

## Commands to Verify Updates

```bash
# Check that all skills are updated
ls -lh .claude/skills/

# Check template is updated
cat templates/plan.template.md | grep "User Perspective"

# Verify documentation mentions 6 layers
grep "Layer 4" .claude/skills/validate.md
grep "6 layers" README.md

# All should show updated content
```

## Summary

These updates ensure:
- ✅ Tests are truly immutable during build
- ✅ Tests are written from user's perspective
- ✅ Test integrity is automatically validated
- ✅ True test-driven development is enforced
- ✅ Features work as users expect
- ✅ Clear separation between planning and building
- ✅ 6-layer validation catches all issues

The workflow now embodies best practices for TDD and user-centric development!
