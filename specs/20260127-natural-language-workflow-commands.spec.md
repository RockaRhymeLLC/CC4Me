# Spec: Natural Language Workflow Commands

**Created**: 2026-01-27
**Updated**: 2026-01-28
**Status**: Complete

## Goal
Enable users to interact with the spec-driven workflow using natural language commands that intelligently update specs, plans, and tasks without manual file editing.

## Requirements

### Must Have
- [x] `/spec <description>` command - parse natural language and update appropriate spec file with new requirements
- [x] `/plan <description>` command - add implementation tasks to existing plan
- [x] `/build <description>` command - request implementation and add to build queue
- [x] `/validate` command - trigger validation workflow
- [x] Simple parsing - extract action and requirement from natural language input
- [x] Smart categorization - determine which spec section to update (requirements, constraints, success criteria, user stories)
- [x] Context inference - intelligently determine which spec/plan file to update based on conversation context
- [x] User confirmation when context is ambiguous - ask "Which spec should I update?" when unsure
- [x] Preserve spec structure - maintain markdown formatting and section organization when updating

### Won't Have
- Voice input - text commands only
- Complex NLP - won't handle highly ambiguous or complex sentences
- Multi-file updates in single command - one target file per command
- Version control integration - won't auto-commit changes (user decides when to commit)
- Batch commands - user can run multiple commands sequentially
- Command aliases - full command names are clear and short enough
- Undo capability - git provides this
- Command history view - conversation scroll-back provides this

## Implementation

**Completed 2026-01-28** via skill updates:

| Skill | Capability |
|-------|------------|
| `.claude/skills/spec/SKILL.md` | Creation (`/spec feature-name`) and updates (`/spec add requirement`) |
| `.claude/skills/plan/SKILL.md` | Creation (`/plan spec-file`) and task additions (`/plan add task`) |
| `.claude/skills/build/SKILL.md` | Full builds (`/build plan-file`) and requests (`/build implement X`) |
| `.claude/skills/validate/SKILL.md` | Multi-layer validation |

**How It Works:**
- Claude's natural language understanding handles parsing, inference, and categorization
- Skills provide instructions for Claude to follow
- No complex parsing code needed - Claude does this natively
- Skills updated with proper frontmatter (name, description, argument-hint)

## Constraints

### Security
- Commands do not bypass workflow validation gates ✓
- User approval still required for destructive operations ✓

### Performance
- Command parsing is instant (Claude handles natively) ✓
- Context inference uses conversation context (no codebase scanning) ✓
- No additional code/parsing overhead ✓

### Compatibility
- Works with existing CC4Me workflow ✓
- Preserves markdown structure of spec/plan files ✓
- Integrates with TaskCreate/TaskUpdate ✓
- Works in Claude Code CLI environment ✓

## Success Criteria

All criteria met:

1. **Accurate file updates** ✓ - Skills support natural language updates to correct files
2. **Smart parsing** ✓ - Claude categorizes additions correctly (requirement vs constraint vs success criteria)
3. **Streamlined workflow** ✓ - Users can drive feature development using commands without manual file editing

## User Stories / Scenarios

### Scenario 1: Adding Requirement via Command ✓
- **Given**: User is working on a feature
- **When**: User types `/spec our assistant will need to make me breakfast`
- **Then**: Claude infers the target spec, adds requirement to correct section, confirms the update

### Scenario 2: Context Ambiguity Handling ✓
- **Given**: User has multiple specs in progress
- **When**: User types `/spec add coffee brewing capability`
- **Then**: Claude asks which spec to update, waits for selection, then updates

### Scenario 3: Plan Task Addition ✓
- **Given**: User has a plan in progress
- **When**: User types `/plan add unit tests for coffee module`
- **Then**: Claude updates plan file and creates task via TaskCreate

## Notes

### Key Insight
The original plan over-engineered this with 7 TypeScript modules. The revised approach recognized that Claude's native capabilities handle everything. No custom code was needed - just well-written skills.

### Design Philosophy
- Natural language feels conversational ✓
- Smart enough to infer, humble enough to ask ✓
- Commands streamline workflow without bypassing validation ✓

### Example Commands
```
/spec our assistant will need to make me breakfast
/spec add security constraint: must encrypt credentials
/plan add integration tests for Telegram module
/build implement credential storage first
/validate
```

### Related Features
- **State persistence** (save/restore assistant context) moved to Agent Assistant Harness spec
- This feature is now complete and closed
