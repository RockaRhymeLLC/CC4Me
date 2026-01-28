---
name: validate
description: Run multi-layer validation to ensure spec, plan, and implementation alignment. Use to check quality at any workflow phase.
argument-hint: [plan-file]
---

# /validate - Multi-Layer Validation

This skill runs comprehensive validation checks to ensure specifications, plans, and implementations are properly aligned and ready for the next phase.

## Purpose

Validate quality at every workflow phase through automated tests, coverage checks, test integrity verification, AI self-review, and manual approval gates.

## Usage

```bash
/validate [plan-file-path]
```

Examples:
- `/validate` - Validate current state (finds most recent plan)
- `/validate plans/20260127-state-manager.plan.md` - Validate specific plan

## Validation Layers

All layers must pass for true validation success:

### Layer 1: Automated Tests
**Purpose**: Verify code works correctly

- **Planning phase**: Tests should FAIL (red state expected)
- **Build phase**: Tests should PASS (green state required)
- Runs: `npm test`

### Layer 2: Spec Coverage
**Purpose**: Ensure all requirements addressed

- Parse all requirements from spec
- Check each has corresponding task or test
- Identify gaps
- Reports: X/X requirements covered

### Layer 3: Plan Validation
**Purpose**: Ensure plan is complete and consistent

- All tasks match TaskList
- Test files exist
- No unresolved open questions
- Rollback plan documented
- Dependencies valid (no circular deps)

### Layer 4: Test Integrity
**Purpose**: Ensure tests unchanged during build

- Only runs in build phase
- Verifies tests haven't been modified
- Checks git history or timestamps
- CRITICAL: Tests must remain immutable
- If tests changed → FAILURE, return to planning

### Layer 5: AI Self-Review
**Purpose**: Verify implementation matches spec intent

- Read spec, plan, implementation
- Check: solves problem, meets criteria, respects constraints
- Generate discrepancy report if issues found
- Honest assessment of quality

### Layer 6: Manual Review
**Purpose**: Human verification

- Generate checklist for user
- Request sign-off
- Final quality gate

## Validation States

### Planning Phase
Expected results:
- ✓ Tests exist but FAIL (red state)
- ✓ Spec coverage complete
- ✓ Plan complete
- ○ Test integrity (skipped - no implementation)
- ○ AI self-review (skipped - no implementation)
- ○ Manual review (skipped - not ready)

### Build Phase
Expected results:
- ✓ All tests PASS (green state)
- ✓ Spec coverage 100%
- ✓ Plan tasks complete
- ✓ Test integrity verified (unchanged)
- ✓ AI self-review passes
- ⚠ Manual review pending

## When Validation Runs

- **After /plan**: Automatically validates planning phase
- **After /build**: Automatically validates build phase
- **Manual**: Run anytime with `/validate`

## Error Handling

If any layer fails:
1. Stop validation process
2. Report which layer failed and why
3. Provide actionable guidance
4. Do NOT proceed to next phase
5. Re-run after fixing issues

## Integration

**Validation Scripts**: `scripts/validate-spec.ts`, `scripts/validate-plan.ts`
**Test Runner**: npm test
**Context Tracker**: Identifies current phase
**Task System**: Checks task completion
**Git**: Verifies test integrity

See `reference.md` for detailed layer specifications.
