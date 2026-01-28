---
skill: spec
description: Create a new specification document using the spec-driven workflow
tags: [workflow, specification, planning]
---

# /spec - Create Specification

This skill helps you create a new specification document following the spec-driven workflow.

## Purpose
Create a detailed specification that defines WHAT we're building and WHY, before planning HOW to build it.

## Usage
```bash
/spec [feature-name]
```

Example: `/spec telegram-integration`

## Workflow

When this skill is invoked, you should:

### 1. Parse the feature name
- Extract the feature name from the arguments
- Generate a filename: `specs/YYYYMMDD-[feature-name].spec.md`
- Example: `specs/20260127-telegram-integration.spec.md`

### 2. Read the template
- Read `templates/spec.template.md` to get the structure

### 3. Interview the user
Use AskUserQuestion to gather information for each section of the spec. Conduct this as an interactive interview:

#### Goal Section
Ask: "In one sentence, what problem does this feature solve?"

#### Requirements
Ask: "What are the must-have requirements? (List them one by one, or type 'done' when finished)"
- Repeat until user says "done"
- Then ask: "Any should-have requirements? (nice to have but not critical)"
- Then ask: "Anything that's explicitly out of scope for now?"

#### Constraints
Ask: "Are there any specific security constraints or requirements?"
Ask: "Are there any performance requirements?"
Ask: "Are there any compatibility requirements? (platforms, dependencies, etc.)"

#### Success Criteria
Ask: "How will we know this feature is complete and working? What observable behaviors should we see?"
- Gather 2-5 success criteria

#### User Stories
Ask: "Can you describe 1-2 scenarios where this feature would be used?"
For each scenario:
- "What's the context? (Given...)"
- "What action happens? (When...)"
- "What's the expected outcome? (Then...)"

#### Technical Considerations
Ask: "Any technical notes, dependencies, or architectural considerations we should be aware of?"

#### Open Questions
Ask: "Are there any open questions or uncertainties we need to resolve before planning?"

### 4. Create the specification file
- Use the template structure from `templates/spec.template.md`
- Fill in all sections with the information gathered from the user
- Replace `[YYYY-MM-DD]` with today's date
- Replace `[Feature Name]` with the properly formatted feature name
- Convert all user responses into well-formatted markdown

### 5. Save and confirm
- Write the file to `specs/YYYYMMDD-[feature-name].spec.md`
- Display a summary of what was created
- Suggest next steps: "Specification created! Next steps:
  1. Review and refine the spec if needed
  2. Resolve any open questions
  3. Run `/plan specs/YYYYMMDD-[feature-name].spec.md` to create an implementation plan"

## Best Practices

1. **Be thorough**: Don't skip sections. Even if the user says "no constraints", document that as "None specified"
2. **Clarify vague requirements**: If a requirement is unclear, ask follow-up questions
3. **Keep it user-focused**: Specs should focus on behavior and outcomes, not implementation details
4. **Document uncertainties**: If there are open questions, capture them explicitly
5. **One feature per spec**: Keep specs focused on a single, coherent feature

## Example Output

After running `/spec telegram-bot`, the skill should:
1. Create `specs/20260127-telegram-bot.spec.md`
2. Populate it with information gathered from the user
3. Confirm creation and suggest next steps

## Notes

- This is the FIRST phase of the spec-driven workflow
- The spec should be approved before moving to the plan phase
- Specs can be updated as understanding evolves
- The spec becomes the source of truth for what we're building
