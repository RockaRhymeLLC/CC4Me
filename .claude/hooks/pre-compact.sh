#!/bin/bash
#
# PreCompact Hook
#
# Saves current state before context compaction.
# Captures: active task, progress, next steps, context.
# Writes to .claude/state/assistant-state.md for recovery.
#
# Fires on: manual (/compact), auto (context full)

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/.claude/state"
STATE_FILE="$STATE_DIR/assistant-state.md"

# Ensure state directory exists
mkdir -p "$STATE_DIR"

# Get current timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Read input from stdin (contains session info)
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
TRIGGER=$(echo "$INPUT" | grep -o '"trigger"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')

# Write state file
cat > "$STATE_FILE" << EOF
# Assistant State

**Saved**: $TIMESTAMP
**Session**: $SESSION_ID
**Trigger**: $TRIGGER (compaction)

## Current Task
(State auto-saved before context compaction. Review transcript for details.)

## Progress
- Context was compacted at $TIMESTAMP
- Previous work is summarized in the compacted context

## Next Steps
1. Review the compacted summary for continuity
2. Check \`/task list\` for pending tasks
3. Resume work from where you left off

## Context
- Auto-saved by PreCompact hook
- Full transcript available at: ~/.claude/projects/.../$SESSION_ID.jsonl

## Notes
This state file was automatically created before context compaction.
If you were in the middle of work, the compacted context summary
should contain the relevant details. Use \`/task list\` and
\`/memory lookup\` to restore full context.
EOF

# Output confirmation (shown in verbose mode)
echo "State saved to $STATE_FILE before compaction"

exit 0
