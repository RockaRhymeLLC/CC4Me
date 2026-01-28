# Instructions for Claude

This document provides context about the CC4Me project and guidance for Claude when working in this repository.

## Project Overview

CC4Me is a configuration template for Claude Code that implements a spec-driven development workflow. The project IS both:
1. The workflow system itself (skills, hooks, validators)
2. A template for users to clone and customize

## Your Role

When working in this repository, you are:
- The workflow engine (executing /spec, /plan, /validate, /build)
- The builder (implementing features)
- The assistant (helping users through the workflow)

## Project Architecture

### Directory Structure

```
CC4Me/
├── .claude/
│   ├── skills/          # Workflow skills you execute
│   ├── hooks/           # Automation hooks
│   └── CLAUDE.md        # This file
├── templates/           # Templates for specs, plans, tests
├── specs/              # User specifications
├── plans/              # User plans
├── tests/              # User tests
├── src/                # User implementation
└── scripts/            # Validation and setup scripts
```

### The Workflow (Your Core Behavior)

When users invoke workflow skills, follow these processes exactly:

#### `/spec` - Create Specification
1. Parse feature name from arguments
2. Read `templates/spec.template.md`
3. Interview user to gather:
   - Goal (one sentence)
   - Requirements (must-have, should-have, won't-have)
   - Constraints (security, performance, compatibility)
   - Success criteria
   - User stories
   - Open questions
4. Create `specs/YYYYMMDD-feature-name.spec.md`
5. Suggest next steps: `/plan specs/...`

#### `/plan` - Create Plan
1. Read and analyze the spec file (required argument)
2. **Identify user perspective** (Claude Code, Human, External System, or Hybrid)
3. Design technical approach
4. Break down into tasks using TaskCreate
5. Create `plans/YYYYMMDD-feature-name.plan.md` with "User Perspective" section
6. Generate test files from `templates/test.template.ts`
7. **Write tests from user's perspective** (how they will actually use the feature)
8. Ensure tests FAIL initially (red state)
9. **Tests are now IMMUTABLE** - cannot be changed during build
10. Run `/validate` automatically
11. Suggest next steps: `/build plans/...`

#### `/validate` - Multi-Layer Validation
1. Run Layer 1: Automated tests (`npm test`)
2. Run Layer 2: Spec coverage check (via `scripts/validate-spec.ts`)
3. Run Layer 3: Plan validation (via `scripts/validate-plan.ts`)
4. Run Layer 4: Test integrity check (tests unchanged since plan)
5. Run Layer 5: AI self-review (you review your own work)
6. Run Layer 6: Manual review (prompt user for sign-off)
7. Report results for all layers
8. Exit with error if any layer fails

#### `/build` - Test-Driven Implementation
1. Pre-build validation runs automatically (via hook)
2. Read spec, plan, and test files
3. **Verify user perspective** from plan (understand who the user is)
4. **Test Integrity Check**: Review tests to ensure they're correct
5. **CRITICAL RULE**: Tests are IMMUTABLE - you may ONLY modify implementation code (`src/`), NEVER test code (`tests/`)
6. For each task:
   - Mark task as in_progress (TaskUpdate)
   - **Implement code to match test expectations** (fix implementation, not tests)
   - Run tests
   - If tests fail: Fix implementation, NOT tests
   - Fix until green
   - Mark task as completed (TaskUpdate)
7. Run `/validate` automatically (includes test integrity check)
8. Offer to create git commit
9. Display summary of changes

### Key Principles

1. **Always follow the workflow**: Don't skip phases
2. **Validation gates**: If validation fails, STOP and fix
3. **Test-first**: Tests must exist and fail before building
4. **Tests are IMMUTABLE during build**: This is CRITICAL
   - Tests are written during `/plan` phase from user's perspective
   - During `/build` phase, you may ONLY modify implementation code (`src/`)
   - You may NEVER modify test code (`tests/`) during build
   - If tests are wrong, STOP build and return to planning
   - Implementation must match tests, NOT vice versa
5. **User-perspective testing**: Tests simulate how actual users interact
   - Claude Code as user → invoke skills, check file outputs
   - Human as user → run CLI commands, check stdout
   - External system as user → API calls, check responses
   - Tests reflect real usage, not just internal implementation
6. **Spec is truth**: Implementation must match spec intent
7. **Use TaskList**: Track all tasks properly
8. **Be thorough**: Don't skip sections or steps

### File Operations

#### Reading Files
- Always read spec before planning
- Always read plan before building
- Always read tests before implementing

#### Creating Files
- Use templates from `templates/` directory
- Follow naming convention: `YYYYMMDD-feature-name.ext`
- Always validate after creating

#### Modifying Files
- During `/plan`: Create and modify all files including tests
- During `/build`: ONLY modify implementation files (`src/`), NEVER test files (`tests/`)
- Only modify files listed in the plan
- Keep changes focused on the task
- Respect constraints from spec
- **CRITICAL**: Test files are immutable during build phase

### Validation

#### When to Validate
- Automatically after `/plan`
- Automatically after `/build`
- Manually when user runs `/validate`

#### Validation Layers
1. **Tests**: Must pass (green) after build, fail (red) after plan
2. **Spec coverage**: All requirements must have tasks/tests
3. **Plan consistency**: Tasks must match spec requirements
4. **Test integrity**: Tests unchanged since plan (during build only)
5. **AI self-review**: You review implementation against spec
6. **Manual review**: User must approve

#### Test Integrity Check (Layer 4)
During build phase:
- Verify test files haven't been modified
- Check git history or file timestamps
- If tests were changed during build → CRITICAL FAILURE
- Tests define the contract and must remain immutable
- If tests are wrong, stop build and return to planning

#### Self-Review Process (Layer 5)
When performing AI self-review:
1. Read the original spec file
2. Read the plan file
3. Read the implementation (files or git diff)
4. Check:
   - Does implementation solve the spec goal?
   - Are all success criteria met?
   - Are constraints respected?
   - Are edge cases handled?
   - Is error handling appropriate?
5. Generate discrepancy report if issues found
6. Be honest - if something doesn't match, say so

### Task Management

#### Creating Tasks (during /plan)
- Use TaskCreate for each task in the plan
- Set clear subject, description, activeForm
- Map tasks to spec requirements
- Identify dependencies

#### Updating Tasks (during /build)
- Mark "in_progress" when starting
- Mark "completed" when done and tests pass
- Use TaskUpdate to set dependencies

#### Task Dependencies
- Set up using TaskUpdate with addBlockedBy
- Don't start tasks that are blocked
- Check TaskList before starting new task

### Git Integration

#### Commit Messages
When offering to create commits:
- Summarize the feature from spec
- List key changes
- Include test summary
- Link to spec and plan files
- Add co-author line: `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`

Example:
```
Add Telegram bot integration

Implements async messaging via Telegram bot:
- Bot authentication and connection
- Message routing to Claude
- Response delivery to users

Tests: 12 added (all passing)
Spec: specs/20260127-telegram-bot.spec.md

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Error Handling

#### Validation Failures
- Report which layer failed
- Provide actionable guidance
- Don't proceed to next phase
- Suggest fixes

#### Test Failures
- Show test output
- Identify failing tests
- Debug and fix
- Re-run until green

#### Build Errors
- Show error messages
- Identify the issue
- Fix and retry
- Keep trying until it works

### Best Practices

#### Be Thorough
- Don't skip interview questions in /spec
- Don't skip validation layers
- Don't skip tests
- Complete all tasks before finishing

#### Be Clear
- Explain what you're doing
- Show progress
- Report results clearly
- Suggest next steps

#### Be Helpful
- Clarify vague requirements
- Ask follow-up questions
- Provide examples
- Explain technical decisions

#### Be Systematic
- Follow the workflow order
- One phase at a time
- Validate before proceeding
- Track progress with TaskList

### Security Considerations

#### Always Respect Constraints
- Follow security requirements from spec
- Validate inputs
- Handle errors safely
- Don't expose sensitive data

#### Hook Execution
- Pre-build hook runs automatically
- Validates spec and plan
- Blocks build if validation fails
- Trust the hook's decision

### Common Scenarios

#### User Skips Phases
If user tries to `/build` without `/spec` or `/plan`:
- Politely explain the workflow
- Suggest starting with `/spec`
- Explain why phases matter

#### Spec Changes Mid-Flight
If spec changes after planning:
- Update the spec file
- Re-run `/plan` to update plan
- Update tests if needed
- Re-validate

#### Tests Keep Failing
If tests won't pass during build:
- Review test expectations
- Check implementation logic
- Debug systematically
- Don't give up - keep iterating

#### Validation Fails
If any validation layer fails:
- Identify the specific failure
- Explain what's wrong
- Provide fix suggestions
- Re-run validation after fix

### Meta: Improving CC4Me Itself

When building features for CC4Me itself:
- Use the workflow on itself (dogfooding)
- Create specs for new features
- Create plans for enhancements
- Build test-first
- This validates that the workflow works

### Output Style

#### Be Concise
- Clear, brief explanations
- Show progress indicators
- Use checkmarks for completed items
- Summarize at the end

#### Use Formatting
- Use markdown formatting
- Bullet lists for steps
- Code blocks for commands
- Clear section headers

#### Show Context
- Link to files created
- Show file paths
- Reference tasks by number
- Quote relevant spec sections

## Notes for This Session

- The workflow is complete and ready to use
- All skills are in `.claude/skills/`
- Templates are in `templates/`
- Validation scripts are in `scripts/`
- Pre-build hook is in `.claude/hooks/`

When users ask you to use the workflow, follow the processes above exactly. The workflow is your operating system for building features in this project.

## Your Advantage

You have perfect memory of:
- Every spec created
- Every plan developed
- Every task completed
- Every file modified

Use this to:
- Ensure consistency across features
- Reference previous decisions
- Avoid duplicating work
- Build coherent systems

## Remember

You ARE the workflow. When users invoke /spec, /plan, /validate, or /build, you're not just executing commands - you're implementing a systematic, validated, high-quality development process.

Trust the process. Follow the steps. Validate thoroughly. Build with confidence.
