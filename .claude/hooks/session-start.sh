#!/bin/bash
#
# SessionStart Hook (v2)
#
# Loads state and context when Claude Code starts or resumes.
# Injects: autonomy mode, identity, pending tasks, calendar, saved state.
#
# v2 changes:
# - No longer starts transcript watcher (daemon handles that now)
# - Loads memory briefing instead of full memory.md
#
# Fires on: startup, resume, clear, compact

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/.claude/state"

# Read hook input from stdin (consume stdin so it doesn't block)
HOOK_INPUT=$(cat)

# Check if daemon is running
DAEMON_RUNNING=false
if curl -s --connect-timeout 1 --max-time 2 "http://localhost:3847/status" > /dev/null 2>&1; then
  DAEMON_RUNNING=true
fi

# Output will be added to Claude's context
echo "## Session Context"
echo ""

# Load identity if exists
if [ -f "$STATE_DIR/identity.json" ]; then
  NAME=$(cat "$STATE_DIR/identity.json" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
  if [ -n "$NAME" ]; then
    echo "### Identity"
    echo "Assistant name: $NAME"
    echo ""
  fi
fi

# Load autonomy mode if exists
if [ -f "$STATE_DIR/autonomy.json" ]; then
  MODE=$(cat "$STATE_DIR/autonomy.json" | grep -o '"mode"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
  if [ -n "$MODE" ]; then
    echo "### Autonomy Mode"
    echo "Current mode: $MODE"
    case "$MODE" in
      yolo)
        echo "- Take any action without asking"
        echo "- Full autonomy enabled"
        ;;
      confident)
        echo "- Ask for permission on destructive actions only"
        echo "- git push, file deletes, etc need confirmation"
        ;;
      cautious)
        echo "- Ask before any state-changing operation"
        echo "- Read operations are autonomous"
        ;;
      supervised)
        echo "- Ask for confirmation on every action"
        echo "- Maximum oversight mode"
        ;;
    esac
    echo ""
  fi
fi

# Load high-priority to-dos
TODOS_DIR="$STATE_DIR/todos"
if [ -d "$TODOS_DIR" ]; then
  # Count critical and high priority open to-dos
  CRITICAL=$(ls "$TODOS_DIR" 2>/dev/null | grep "^1-.*-open-\|^1-.*-in-progress-" | wc -l | tr -d ' ')
  HIGH=$(ls "$TODOS_DIR" 2>/dev/null | grep "^2-.*-open-\|^2-.*-in-progress-" | wc -l | tr -d ' ')

  if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
    echo "### Pending To-Dos"

    # List critical to-dos
    for f in "$TODOS_DIR"/1-*-open-*.json "$TODOS_DIR"/1-*-in-progress-*.json 2>/dev/null; do
      if [ -f "$f" ]; then
        TITLE=$(cat "$f" | grep -o '"title"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
        ID=$(cat "$f" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
        echo "- CRITICAL [$ID]: $TITLE"
      fi
    done

    # List high priority to-dos
    for f in "$TODOS_DIR"/2-*-open-*.json "$TODOS_DIR"/2-*-in-progress-*.json 2>/dev/null; do
      if [ -f "$f" ]; then
        TITLE=$(cat "$f" | grep -o '"title"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
        ID=$(cat "$f" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
        echo "- HIGH [$ID]: $TITLE"
      fi
    done
    echo ""
  fi
fi

# Check today's calendar
if [ -f "$STATE_DIR/calendar.md" ]; then
  TODAY=$(date +%Y-%m-%d)
  TOMORROW=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "+1 day" +%Y-%m-%d 2>/dev/null)

  # Look for today's date in calendar
  if grep -q "### $TODAY" "$STATE_DIR/calendar.md" 2>/dev/null; then
    echo "### Today's Calendar ($TODAY)"
    # Extract entries for today (lines after ### TODAY until next ### or ##)
    awk "/### $TODAY/{found=1; next} /^##/{found=0} found && /^-/{print}" "$STATE_DIR/calendar.md"
    echo ""
  fi
fi

# Load saved state if exists
if [ -f "$STATE_DIR/assistant-state.md" ]; then
  echo "### Saved State"
  echo "Previous state saved. Run \`/save-state\` or check .claude/state/assistant-state.md for details."

  # Extract just the Current Task and Next Steps sections
  if grep -q "## Current Task" "$STATE_DIR/assistant-state.md"; then
    awk '/## Current Task/{found=1} /## Progress/{found=0} found{print}' "$STATE_DIR/assistant-state.md" | head -5
  fi
  if grep -q "## Next Steps" "$STATE_DIR/assistant-state.md"; then
    echo ""
    echo "**Next Steps:**"
    awk '/## Next Steps/{found=1; next} /^##/{found=0} found && /^[0-9]/{print}' "$STATE_DIR/assistant-state.md" | head -3
  fi
  echo ""
fi

# Load memory briefing (v2) or fall back to memory.md (v1)
if [ -f "$STATE_DIR/memory/briefing.md" ]; then
  echo "### Memory Briefing"
  cat "$STATE_DIR/memory/briefing.md"
  echo ""
elif [ -f "$STATE_DIR/memory.md" ]; then
  echo "### Memory"
  cat "$STATE_DIR/memory.md"
  echo ""
fi

# Daemon status
if [ "$DAEMON_RUNNING" = "true" ]; then
  echo "### Daemon"
  echo "CC4Me daemon is running (port 3847). Transcript watching, Telegram, email, and scheduled tasks are managed by the daemon."
else
  echo "### Daemon"
  echo "CC4Me daemon is NOT running. Using fallback v1 transcript watcher. Start daemon: \`launchctl load ~/Library/LaunchAgents/com.bmo.daemon.plist\`"
fi
echo ""

# Check for CLAUDE.md reminders
if [ -f "$PROJECT_DIR/.claude/CLAUDE.md" ]; then
  # Check if there are specific session reminders
  if grep -q "## Session Reminders" "$PROJECT_DIR/.claude/CLAUDE.md"; then
    echo "### Reminders"
    awk '/## Session Reminders/{found=1; next} /^##/{found=0} found && /^-/{print}' "$PROJECT_DIR/.claude/CLAUDE.md"
    echo ""
  fi
fi

echo "---"
echo "Use \`/todo list\` to see all to-dos, \`/memory lookup\` to check facts, \`/calendar show\` for schedule."

exit 0
