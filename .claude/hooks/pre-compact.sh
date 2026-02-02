#!/bin/bash
#
# PreCompact Hook (v2)
#
# Key insight: Claude has the context, this hook doesn't.
# Instead of writing a generic placeholder, we output an instruction
# that tells Claude to save its own state — which will be much more
# useful since Claude knows what it was working on.
#
# Fires on: manual (/compact), auto (context full)

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/.claude/state"

# Read input from stdin
INPUT=$(cat)

# Output instruction to Claude (this appears in Claude's context)
cat << 'EOF'
CRITICAL: Context compaction is about to happen. You are about to lose most of your conversation context.

IMMEDIATELY write your current state to .claude/state/assistant-state.md with:
1. **Current Task**: What you're working on right now (be specific)
2. **Progress**: What you've completed so far (files changed, decisions made)
3. **Next Steps**: Exactly what to do next when you resume
4. **Key Context**: Any important details that would be lost (variable names, error messages, user preferences expressed in this session)
5. **Open Questions**: Anything you were uncertain about

Then check /todo list and update any in-progress todos.

This is your last chance to preserve context before compaction. Be thorough.
EOF

exit 0
