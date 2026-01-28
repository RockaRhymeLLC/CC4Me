# CC4Me - Claude Code for Me

**Spec-Driven Development Workflow + Autonomous AI Assistant**

CC4Me configures Claude Code as a powerful spec-driven development workflow AND an autonomous assistant. Build features systematically with built-in validation, test-driven development, and quality gates.

## What is CC4Me?

CC4Me is a configuration template for [Claude Code](https://github.com/anthropics/claude-code) that implements a structured workflow for building software:

1. **Spec** - Define WHAT to build and WHY
2. **Plan** - Define HOW to build it with tasks and tests
3. **Validate** - Ensure everything aligns (multi-layer validation)
4. **Build** - Implement test-first until tests pass

This workflow ensures:
- Clear requirements before coding
- Test-driven development
- Automatic validation at every step
- No missed requirements
- High-quality, maintainable code

## Why Spec-Driven Development?

Traditional development often jumps straight to code, leading to:
- Misunderstood requirements
- Missing edge cases
- Incomplete test coverage
- Scope creep
- Validation only at the end

Spec-driven development fixes this by:
- Documenting intent BEFORE implementation
- Creating tests BEFORE code (red-green-refactor)
- Validating alignment at every phase
- Catching issues early
- Creating a paper trail for decisions

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) v18 or higher
- [Claude Code CLI](https://github.com/anthropics/claude-code)
- npm or yarn

### Installation

```bash
# Clone this repository
git clone https://github.com/your-org/CC4Me.git my-project
cd my-project

# Run one-command setup
./scripts/init.sh

# Start Claude Code
claude
```

### Your First Feature

```bash
# In Claude Code terminal:

# Step 1: Create a specification
> /spec my-first-feature

# Claude will interview you to gather requirements

# Step 2: Create a plan
> /plan specs/20260127-my-first-feature.spec.md

# Claude will create tasks, tests, and a detailed plan

# Step 3: Build it
> /build plans/20260127-my-first-feature.plan.md

# Claude will implement test-first until all tests pass
```

## The Workflow

### Phase 1: `/spec` - Specification

**Purpose**: Define WHAT we're building and WHY

**Creates**: `specs/YYYYMMDD-feature-name.spec.md`

Claude interviews you to create a complete specification:
- Goal (one sentence problem statement)
- Requirements (must-have, should-have, won't-have)
- Constraints (security, performance, compatibility)
- Success criteria (how we know it's done)
- User stories (scenarios and expected behavior)
- Open questions (what needs clarification)

**Example**:
```bash
> /spec telegram-integration

# Claude asks:
# - What problem does this solve?
# - What are the must-have requirements?
# - Any security constraints?
# - How will we know it works?
# ... etc
```

### Phase 2: `/plan` - Planning

**Purpose**: Define HOW we'll build it

**Creates**:
- `plans/YYYYMMDD-feature-name.plan.md`
- `tests/feature-name.test.ts` (failing tests)
- Tasks in TaskList

Claude analyzes the spec and creates:
- Technical approach (architecture decisions)
- File-level changes (what to create/modify)
- Task breakdown with dependencies
- Test plan with specific test cases
- Test files with failing tests (red state)

**Example**:
```bash
> /plan specs/20260127-telegram-integration.spec.md

# Claude creates:
# - Detailed plan document
# - 5 tasks in TaskList
# - Test file with 12 failing tests
# - Automatically runs /validate
```

### Phase 3: `/validate` - Validation

**Purpose**: Ensure spec, plan, and implementation align

**Runs**:
1. Automated tests (`npm test`)
2. Spec coverage check (all requirements have tasks/tests)
3. Plan validation (complete and consistent)
4. AI self-review (implementation matches spec)
5. Manual review checklist (human verification)

Called automatically by `/plan` and `/build`, or manually:

```bash
> /validate

# Runs all validation layers
# Reports pass/fail for each layer
# Blocks progress if validation fails
```

### Phase 4: `/build` - Implementation

**Purpose**: Write code to make tests pass

**Process**:
1. Pre-build validation (via hook)
2. Read spec, plan, and tests
3. Implement test-first (red → green)
4. Run tests after each task
5. Auto-validate when complete
6. Offer git commit

**Example**:
```bash
> /build plans/20260127-telegram-integration.plan.md

# Claude:
# - Verifies pre-build validation passed
# - Implements each task test-first
# - Runs tests continuously
# - Validates completion
# - Creates commit message
```

## Project Structure

```
CC4Me/
├── .claude/                    # Claude Code configuration
│   ├── skills/                 # Custom workflow skills
│   │   ├── spec.md            # /spec skill
│   │   ├── plan.md            # /plan skill
│   │   ├── validate.md        # /validate skill
│   │   └── build.md           # /build skill
│   ├── hooks/                  # Automation hooks
│   │   └── pre-build.sh       # Pre-build validation
│   └── CLAUDE.md              # Instructions for Claude
├── templates/                  # Templates for workflow
│   ├── spec.template.md
│   ├── plan.template.md
│   └── test.template.ts
├── specs/                      # Your specifications
├── plans/                      # Your plans
├── tests/                      # Your tests
├── src/                        # Your implementation
├── scripts/                    # Utility scripts
│   ├── init.sh                # One-command setup
│   ├── validate-spec.ts       # Spec validator
│   └── validate-plan.ts       # Plan validator
├── package.json               # Dependencies
└── README.md                  # This file
```

## Features

### Multi-Layer Validation

CC4Me validates at 6 distinct levels:
1. **Automated tests**: Code correctness (tests pass)
2. **Spec coverage**: All requirements addressed
3. **Plan consistency**: Tasks match requirements
4. **Test integrity**: Tests unchanged since planning (immutability enforced)
5. **AI review**: Implementation matches spec intent
6. **Human review**: Final quality gate

Each layer catches different types of issues. All must pass to proceed.

### Test-Driven Development

- **Tests written BEFORE implementation** (during planning phase)
- **Tests written from user's perspective** (how they'll actually use the feature)
- **Tests are IMMUTABLE** during build phase (cannot be modified)
- Tests start failing (red state)
- Implementation makes tests pass (green state)
- Implementation must match tests, NOT vice versa
- Refactor while keeping tests green
- Clear definition of "done"

#### User-Perspective Testing

Tests simulate how actual users interact with features:
- **Claude Code as user**: Tests invoke skills and check file outputs
- **Human as user**: Tests run CLI commands and verify stdout
- **External system as user**: Tests send API requests and check responses
- **Hybrid**: Tests cover multiple user types

This ensures features work as users expect, not just internally.

### Pre-Build Gates

The pre-build hook prevents building with:
- Incomplete specifications
- Missing test files
- Unresolved open questions
- Invalid plans

### Task Management

Integrated TaskList tracking:
- Tasks created during planning
- Dependencies managed automatically
- Progress visible in real-time
- Tasks marked complete as you build

### Git Integration

Optional automatic commits:
- Descriptive commit messages
- Links to spec and plan
- Test summary included
- Co-authored by Claude

## Configuration

### Environment Variables

Create a `.env` file (or use the one created by `init.sh`):

```bash
# Anthropic API Key (if using Claude API directly)
ANTHROPIC_API_KEY=your_api_key_here

# Future: Telegram integration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_AUTHORIZED_USERS=123456789,987654321
```

### Claude Settings

Edit `.claude/settings.json` to customize Claude Code behavior (not included in template - user-specific).

## Best Practices

1. **Start with /spec**: Always begin with a clear specification
2. **Identify the user**: Know who will use the feature (Claude, human, external system)
3. **Resolve open questions**: Don't proceed with unresolved questions
4. **Trust the validation**: If validation fails, fix it before continuing
5. **Test-first always**: Let tests guide implementation
6. **Tests are sacred**: Never modify tests during build to make them pass
7. **User-perspective testing**: Write tests from the user's actual interaction pattern
8. **Keep tasks small**: Smaller tasks are easier to complete and validate
9. **Review AI work**: Use the manual review step to verify quality
10. **Implementation matches tests**: Fix code to pass tests, not tests to pass code

## Roadmap

Future enhancements (to be built using this workflow!):

- [ ] Telegram bot integration for async messaging
- [ ] Autonomous task scheduling
- [ ] Web research capabilities
- [ ] File system operations with sandboxing
- [ ] Self-improvement (assistant proposes enhancements)

See the plan document for details on how we'll systematically add these features using spec → plan → validate → build.

## Contributing

This project is designed to be self-improving:

1. Create a spec for the enhancement: `/spec my-enhancement`
2. Create a plan: `/plan specs/YYYYMMDD-my-enhancement.spec.md`
3. Build it: `/build plans/YYYYMMDD-my-enhancement.plan.md`
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- Issues: [GitHub Issues](https://github.com/anthropics/claude-code/issues)
- Discussions: [GitHub Discussions](https://github.com/anthropics/claude-code/discussions)
- Claude Code Docs: [Official Documentation](https://docs.anthropic.com/claude-code)

## Acknowledgments

Built with [Claude Code](https://github.com/anthropics/claude-code) by Anthropic.

Inspired by the need for systematic, validated, high-quality AI-assisted development.

---

**Happy Building!** 🎉

Start with `/spec` and let the workflow guide you to high-quality implementations.
