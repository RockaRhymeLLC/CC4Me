#!/bin/bash
# Spawn a worker agent in a new tmux window
# Usage: spawn.sh <name> <project_dir> <profile> <mission> [tmux_session]

set -e

NAME="$1"
PROJECT_DIR="$2"
PROFILE="${3:-default}"
MISSION="$4"
TMUX_SESSION="${5:-$(tmux display-message -p '#S' 2>/dev/null || echo 'cc4me')}"

if [ -z "$NAME" ] || [ -z "$PROJECT_DIR" ] || [ -z "$MISSION" ]; then
  echo "Usage: spawn.sh <name> <project_dir> <profile> <mission> [tmux_session]"
  echo "  name:          Worker name (alphanumeric, dashes)"
  echo "  project_dir:   Absolute path to project directory"
  echo "  profile:       Permission profile (default|research|isolated)"
  echo "  mission:       Mission description"
  echo "  tmux_session:  Parent tmux session name (default: auto-detect or 'cc4me')"
  exit 1
fi

# Validate name
if ! echo "$NAME" | grep -qE '^[a-z0-9][a-z0-9-]*$'; then
  echo "Error: Worker name must be lowercase alphanumeric with dashes"
  exit 1
fi

# Check tmux session exists
if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "Error: tmux session '$TMUX_SESSION' not found"
  exit 1
fi

# Check worker doesn't already exist
if tmux list-windows -t "$TMUX_SESSION" -F '#{window_name}' 2>/dev/null | grep -q "^worker-${NAME}$"; then
  echo "Error: Worker window 'worker-${NAME}' already exists"
  exit 1
fi

# Create directories
mkdir -p "$PROJECT_DIR/.claude" "$PROJECT_DIR/.worker" "$PROJECT_DIR/output"

# Generate settings.local.json based on profile
case "$PROFILE" in
  default)
    cat > "$PROJECT_DIR/.claude/settings.local.json" << 'SETTINGS'
{
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(node *)",
      "Bash(python3 *)",
      "Bash(pip *)",
      "Bash(git status)",
      "Bash(git log *)",
      "Bash(git diff *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git checkout *)",
      "Bash(git branch *)",
      "Bash(git stash *)",
      "Bash(ls *)",
      "Bash(mkdir *)",
      "Bash(cp *)",
      "Bash(mv *)",
      "Bash(cat *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(wc *)",
      "Bash(sort *)",
      "Bash(diff *)",
      "Bash(find *)",
      "Bash(which *)",
      "Bash(echo *)",
      "Bash(date)",
      "Bash(date *)",
      "Bash(pwd)",
      "Bash(test *)",
      "Bash([ *)",
      "Bash(true)",
      "Bash(false)",
      "Bash(curl -s http://localhost:3847/*)",
      "Bash(curl -s -X POST http://localhost:3847/*)"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(rm -rf ~)",
      "Bash(rm -rf /*)",
      "Bash(sudo *)",
      "Bash(git push *)",
      "Bash(git remote *)",
      "Bash(ssh *)",
      "Bash(scp *)",
      "Bash(curl * --upload-file *)",
      "Bash(open *)",
      "Bash(osascript *)",
      "Bash(launchctl *)",
      "Bash(security *)",
      "Read(//Users/*/.ssh/**)",
      "Read(//etc/shadow)",
      "Read(//etc/master.passwd)",
      "Edit(//.env)",
      "Edit(//**/credentials*)",
      "Edit(//**/secrets/**)"
    ]
  }
}
SETTINGS
    ;;
  research)
    cat > "$PROJECT_DIR/.claude/settings.local.json" << 'SETTINGS'
{
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Edit(//.worker/**)",
      "Write(//.worker/**)",
      "Edit(//output/**)",
      "Write(//output/**)",
      "Bash(curl *)",
      "Bash(date)",
      "Bash(date *)",
      "Bash(pwd)",
      "Bash(wc *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(echo *)"
    ],
    "deny": [
      "Edit",
      "Write",
      "Bash(rm *)",
      "Bash(sudo *)",
      "Bash(git *)",
      "Bash(ssh *)",
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(security *)",
      "Read(//Users/*/.ssh/**)"
    ]
  }
}
SETTINGS
    ;;
  isolated)
    cat > "$PROJECT_DIR/.claude/settings.local.json" << 'SETTINGS'
{
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash(npm run *)",
      "Bash(npm test *)",
      "Bash(node *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(pwd)",
      "Bash(echo *)",
      "Bash(date)",
      "Bash(date *)",
      "Bash(mkdir *)",
      "Bash(cp *)"
    ],
    "deny": [
      "Bash(curl *)",
      "Bash(wget *)",
      "Bash(git *)",
      "Bash(ssh *)",
      "Bash(sudo *)",
      "Bash(rm -rf *)",
      "Bash(open *)",
      "Bash(osascript *)",
      "Bash(security *)",
      "Bash(launchctl *)",
      "Read(//Users/*/.ssh/**)",
      "Read(//etc/**)"
    ]
  }
}
SETTINGS
    ;;
  *)
    echo "Error: Unknown profile '$PROFILE'. Use: default, research, isolated"
    exit 1
    ;;
esac

# Generate CLAUDE.local.md with mission brief
cat > "$PROJECT_DIR/CLAUDE.local.md" << MISSION
# Worker Agent: ${NAME}

You are a worker agent. Your job is to complete the mission below, then report your results.

## Mission

${MISSION}

## Communication Protocol

### Progress Updates
Write progress updates to \`.worker/progress.md\` as you work. Use this format:

\`\`\`markdown
## Progress

### Status: working

### Current Step
What you're doing right now.

### Completed
- [x] Step 1

### Remaining
- [ ] Step 2

### Notes
Any blockers or decisions.
\`\`\`

Update this file after completing each major step.

### Signaling Completion
When you finish or get stuck, notify the parent agent:

\`\`\`bash
curl -s -X POST http://localhost:3847/worker/signal \\
  -H 'Content-Type: application/json' \\
  -d '{"worker":"${NAME}","status":"done","message":"Task complete. Results in output/"}'
\`\`\`

Replace "done" with "stuck" if you need help. If curl fails, just update .worker/progress.md — the parent agent checks periodically.

### Output
Put deliverables in the \`output/\` directory. If your mission produces code changes, commit them locally (do NOT push).

## Rules

- Stay focused on your mission
- Write clean, tested code (if coding)
- Commit frequently with clear messages
- Update .worker/progress.md after each major step
- Signal when done or stuck
- Do NOT push to any remote
- Do NOT access credentials or secrets
- Do NOT modify files outside your project (unless explicitly part of the mission)
- Manage your own context — save state and restart if needed
MISSION

# Create initial progress file
cat > "$PROJECT_DIR/.worker/progress.md" << EOF
## Progress

### Status: starting

### Current Step
Initializing — reading mission brief.

### Completed
(none yet)

### Remaining
(reading mission brief)

### Notes
Worker just spawned at $(date -u +%Y-%m-%dT%H:%M:%SZ).
EOF

# Create worker metadata
python3 -c "
import json, sys
config = {
    'name': '$NAME',
    'spawned_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'project_dir': '$PROJECT_DIR',
    'profile': '$PROFILE',
    'mission': '''$MISSION''',
    'tmux_session': '$TMUX_SESSION',
    'tmux_window': 'worker-$NAME'
}
with open('$PROJECT_DIR/.worker/config.json', 'w') as f:
    json.dump(config, f, indent=2)
"

# Add .worker/ to .gitignore if applicable
if [ -f "$PROJECT_DIR/.gitignore" ]; then
  grep -q '^\.worker/' "$PROJECT_DIR/.gitignore" 2>/dev/null || echo ".worker/" >> "$PROJECT_DIR/.gitignore"
  grep -q '^\.claude/settings\.local\.json' "$PROJECT_DIR/.gitignore" 2>/dev/null || echo ".claude/settings.local.json" >> "$PROJECT_DIR/.gitignore"
  grep -q '^CLAUDE\.local\.md' "$PROJECT_DIR/.gitignore" 2>/dev/null || echo "CLAUDE.local.md" >> "$PROJECT_DIR/.gitignore"
fi

# Launch in new tmux window
tmux new-window -t "$TMUX_SESSION" -n "worker-${NAME}" -c "$PROJECT_DIR"
sleep 1

# Use -p (print mode) for clean startup — worker starts immediately on the mission.
# --dangerously-skip-permissions because settings.local.json deny rules are the guardrails.
# --max-turns caps the session length as a safety net.
KICK_OFF="Read CLAUDE.local.md for your mission brief and complete the task described there. Update .worker/progress.md as you go. Signal when done."
tmux send-keys -t "${TMUX_SESSION}:worker-${NAME}" "claude -p --dangerously-skip-permissions --max-turns 50 \"${KICK_OFF}\"" Enter

echo "Worker '${NAME}' spawned in tmux window 'worker-${NAME}'"
echo "  Directory: $PROJECT_DIR"
echo "  Profile: $PROFILE"
echo "  Monitor: tmux select-window -t ${TMUX_SESSION}:worker-${NAME}"
