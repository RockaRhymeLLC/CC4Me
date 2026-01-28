---
name: memory
description: Look up and add facts to persistent memory. Use before asking the user questions they may have already answered.
argument-hint: [lookup "query" | add "fact" | list | search "term"]
---

# Memory Management

Store and retrieve persistent facts about the user and their preferences in `.claude/state/memory.md`.

## Philosophy

**Check memory before asking.** If you need information that the user may have provided before (preferences, names, accounts, etc.), search memory first. Only ask if it's not there.

## Commands

Parse $ARGUMENTS to determine the action:

### Lookup
- `lookup "query"` - Search memory for matching facts
- `"query"` - If argument looks like a search query, treat as lookup

Examples:
- `/memory lookup "email"` - Find email-related facts
- `/memory "preferred name"` - What do they like to be called?

### Add
- `add "fact"` - Add a new fact to memory
- `add "fact" category:preferences` - Add with category tag

Examples:
- `/memory add "Prefers dark mode in all applications"`
- `/memory add "Wife's name is Sarah" category:family`

### List
- `list` - Show all memory entries
- `list category:work` - Show entries in category

### Search
- `search "term"` - Full-text search across all entries

## File Format

Memory is stored in `.claude/state/memory.md` as a simple markdown file:

```markdown
# Memory

## Preferences
- Prefers dark mode in all applications
- Likes concise responses, not verbose
- Time zone: America/Los_Angeles

## Personal
- Wife's name is Sarah
- Has two dogs: Max (golden retriever) and Luna (beagle)
- Birthday: March 15

## Work
- Works at Acme Corp as Senior Engineer
- Manager is James Chen
- Team uses Slack for communication

## Technical
- Primary language: TypeScript
- Editor: VS Code with Vim keybindings
- Shell: zsh with oh-my-zsh

## Accounts
- GitHub: @username
- Preferred email for notifications: work@example.com
```

## Workflow

### Adding a Fact
1. Read current memory.md
2. Determine appropriate category (or create new one)
3. Append fact under category
4. Write updated file
5. Confirm what was added

### Looking Up
1. Read memory.md
2. Search for matching text (case-insensitive)
3. Return matching lines with context
4. If nothing found, say so (don't guess)

## Integration with CLAUDE.md

CLAUDE.md should include an instruction like:

```markdown
## Memory

Before asking the user for information they may have provided before,
check `.claude/state/memory.md`:
- User preferences
- Names of people they mention often
- Account information
- Technical preferences

Use grep or read the file directly. If the information isn't there,
ask the user and then add it to memory for next time.
```

## Best Practices

### What to Remember
- Stated preferences
- Names of people they mention
- Account identifiers (not passwords!)
- Technical preferences and setup
- Important dates
- Frequently referenced information

### What NOT to Remember
- Passwords or secrets (use Keychain)
- Temporary information
- One-time context
- Sensitive data without permission

### Categories
Keep categories simple and intuitive:
- `Preferences` - How they like things
- `Personal` - Family, pets, hobbies
- `Work` - Job, colleagues, projects
- `Technical` - Dev environment, tools
- `Accounts` - Usernames, non-secret identifiers
- Custom categories as needed

## Output Format

### Lookup Result
```
## Memory Lookup: "email"

Found 2 entries:

**Accounts**
- Preferred email for notifications: work@example.com

**Work**
- Team uses email for formal communication, Slack for quick questions
```

### Add Confirmation
```
Added to memory (Preferences):
"Prefers morning standup at 9am"
```

## Notes

- Memory file is human-readable and editable
- User can modify directly via text editor
- Keep entries concise - one fact per line
- Use consistent formatting for easy grep
