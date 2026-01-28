---
name: calendar
description: Manage calendar entries for scheduled events, task due dates, and reminders.
argument-hint: [show [date] | add "event" date [time] | remove "event" date]
---

# Calendar Management

Manage scheduled events in `.claude/state/calendar.md`. Track appointments, deadlines, and reminders.

## Commands

Parse $ARGUMENTS to determine the action:

### Show Calendar
- `show` or no arguments - Show upcoming events (next 7 days)
- `show today` - Show today's events
- `show tomorrow` - Show tomorrow's events
- `show 2026-02-01` - Show specific date
- `show week` - Show this week
- `show month` - Show this month
- `show 2026-02` - Show specific month

### Add Event
- `add "Event description" 2026-02-01` - All-day event
- `add "Event description" 2026-02-01 14:00` - Timed event
- `add "Event description" 2026-02-01 (reminder:morning)` - With reminder note

### Remove Event
- `remove "Event description" 2026-02-01` - Remove matching event

### Link to To-Do
- `add "Work on login [todo:a1b]" 2026-02-01` - Reference a to-do

## File Format

Calendar is stored in `.claude/state/calendar.md` organized by year/month:

```markdown
# Calendar

## 2026-01

### 2026-01-28
- 09:00 - Team standup
- 14:00 - Dentist appointment (send reminder morning of)
- Review PR for auth feature [task:a1b]

### 2026-01-30
- Project deadline [task:c2d]

## 2026-02

### 2026-02-01
- 10:00 - Meeting with James
- Submit expense report

### 2026-02-14
- Valentine's Day (order flowers by Feb 12)
```

## Entry Format

Each entry is a markdown list item:
- `- HH:MM - Event description` (timed event)
- `- Event description` (all-day event)
- `- Event description [todo:id]` (linked to to-do)
- `- Event description (note)` (with reminder/note)

## Workflow

### Showing Events
1. Read calendar.md
2. Parse entries into date structures
3. Filter by requested range
4. Format and display
5. Resolve to-do references to show to-do titles

### Adding Events
1. Read calendar.md
2. Find or create the appropriate year/month section
3. Find or create the date heading
4. Insert entry in time order (timed events) or at end (all-day)
5. Write updated file
6. Confirm what was added

### Removing Events
1. Read calendar.md
2. Find matching entry (by text and date)
3. Remove the line
4. Clean up empty date/month sections
5. Confirm removal

## To-Do Integration

Reference to-dos in calendar entries using `[todo:id]` syntax:

```markdown
### 2026-02-01
- Start work on authentication [todo:a1b]

### 2026-02-15
- Authentication feature due [todo:a1b]
```

When displaying, resolve to show to-do title:
```
### 2026-02-01
- Start work on authentication → [a1b] Implement login flow
```

## Output Format

### Week View
```
## This Week (Jan 27 - Feb 2, 2026)

### Monday, Jan 27
No events

### Tuesday, Jan 28
- 09:00 - Team standup
- 14:00 - Dentist appointment

### Wednesday, Jan 29
No events

### Thursday, Jan 30
- Project deadline [c2d] Write documentation

### Friday, Jan 31
No events

### Saturday, Feb 1
- 10:00 - Meeting with James

### Sunday, Feb 2
No events
```

### Add Confirmation
```
Added to calendar:
2026-02-01 at 10:00 - Meeting with James
```

## Reminders

Reminder notes in parentheses are for reference:
- `(send reminder morning of)` - Prompt to remind user
- `(order flowers by Feb 12)` - Action needed before event

The assistant should:
1. Check calendar at session start (via SessionStart hook)
2. Note upcoming events with reminder notes
3. Proactively mention relevant reminders

## Best Practices

- Use ISO dates (YYYY-MM-DD) for consistency
- Use 24-hour time (HH:MM)
- Keep descriptions concise
- Link to to-dos when relevant
- Add reminder notes for actions needed

## Notes

- Calendar file is human-readable and editable
- User can modify directly via text editor
- Empty date sections can be cleaned up
- Past events are kept for reference (can archive manually)
