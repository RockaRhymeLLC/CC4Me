---
name: spec
description: Create or update specification documents using the spec-driven workflow. Use when starting a new feature or adding requirements.
argument-hint: [feature-name or update description]
---

# /spec - Specification Management

This skill handles both creating new specifications and updating existing ones. The workflow adapts based on the arguments you provide.

## Purpose

Define WHAT we're building and WHY, before planning HOW to build it. Specifications are the source of truth for requirements, constraints, and success criteria.

## Usage Patterns

### Create New Specification
```bash
/spec [feature-name]
```
Examples:
- `/spec telegram-integration`
- `/spec state-manager`
- `/spec breakfast-maker`

**When to use**: Starting a new feature from scratch

### Update Existing Specification
```bash
/spec <natural language description>
```
Examples:
- `/spec add breakfast feature`
- `/spec security constraint: must encrypt data`
- `/spec success criteria: responds within 500ms`
- `/spec nice to have: coffee brewing`

**When to use**: Quick additions to an existing spec

## How It Works

**I infer your intent** based on:
1. **Argument format**:
   - Single word/slug → Create new spec
   - Natural sentence → Update existing spec
2. **Conversation context**: What spec are we working on?
3. **File system**: What specs exist in `specs/`?

If ambiguous, I'll ask you to clarify.

## Workflows

### Creation Workflow
1. Parse feature name
2. Interview you to gather requirements
3. Use template structure
4. Create `specs/YYYYMMDD-feature-name.spec.md`
5. Set as active spec (context tracker)
6. Suggest next steps: `/plan`

### Update Workflow
1. Parse your description
2. Determine target spec (from context or ask)
3. Categorize content (requirement, constraint, success criteria, etc.)
4. Update the appropriate section
5. Log change to history
6. Confirm what was added

## Best Practices

**For Creation**:
- Be thorough in the interview
- Clarify vague requirements
- Keep specs user-focused (behavior, not implementation)
- Document uncertainties as open questions
- One feature per spec

**For Updates**:
- Use natural language - I'll categorize correctly
- Trust the inference - I'll find the right spec
- Quick iterations - add multiple items in sequence
- If I get it wrong, you can manually edit

## Integration

**Context Tracker**: Remembers which spec is active across conversation
**History Logger**: Records all spec changes for audit
**Validation**: Specs are validated before moving to plan phase

See `reference.md` for detailed step-by-step workflows.
