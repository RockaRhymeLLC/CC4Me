#!/bin/bash
# Async memory extraction hook
# Spawns a separate claude -p (haiku) session to extract memories from the transcript
# Runs as async command hook — non-blocking to the main session

# Ensure claude binary is on PATH (hooks inherit a minimal shell environment)
export PATH="$HOME/.local/bin:$PATH"

LOCK_FILE="/tmp/cc4me-memory-extraction.lock"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
MEMORY_DIR="$PROJECT_DIR/.claude/state/memory/memories"

# Prevent concurrent/recursive runs (lock expires after 5 min)
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE") ))
  if [ "$LOCK_AGE" -lt 300 ]; then
    exit 0
  fi
fi

touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# Read hook input from stdin
INPUT=$(cat)

# Skip if already running from a stop hook (prevent infinite loops)
STOP_ACTIVE=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('stop_hook_active', False))" 2>/dev/null)
if [ "$STOP_ACTIVE" = "True" ]; then
  exit 0
fi

# Extract transcript path from hook JSON (tilde-expand if needed)
TRANSCRIPT_PATH=$(echo "$INPUT" | python3 -c "
import sys,json,os
p = json.load(sys.stdin).get('transcript_path','')
print(os.path.expanduser(p))
" 2>/dev/null)

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# Build inventory of existing memories (subject lines from frontmatter)
# This lets the extraction agent see what's already stored without searching
INVENTORY=$(grep -h '^subject:' "$MEMORY_DIR"/*.md 2>/dev/null | sed 's/^subject: *//' | sort)

# Build the prompt and write to a temp file (avoids shell quoting issues with multi-line args)
PROMPT_FILE=$(mktemp /tmp/bmo-extract-prompt.XXXXXX)
cat > "$PROMPT_FILE" <<PROMPT_EOF
You are a memory extraction agent for a personal assistant.

Read the transcript file at: $TRANSCRIPT_PATH
Read only the LAST 200 lines to stay fast.

Extract any NEW persistent facts worth remembering. Write each as an individual memory file to: $MEMORY_DIR

## EXISTING MEMORIES (do NOT duplicate these subjects)
$INVENTORY

## RULES
1. Run \`date '+%Y%m%d-%H%M'\` via Bash to get the current timestamp for filenames.
2. Look for NEW persistent facts in these categories:
   - person: Names, relationships, contact info, preferences about specific people
   - preference: How the user likes things done, tool choices, style preferences
   - technical: Environment details, architecture decisions, tool configurations
   - account: Service accounts, usernames, non-secret identifiers
   - decision: Significant decisions made (with reasoning if stated)
3. **DEDUP CHECK (critical)**: Before writing ANY memory, check the EXISTING MEMORIES list above.
   - If ANY existing subject covers the same person, topic, or fact: DO NOT create a new file.
   - "Same person" means same individual — e.g. if "Dave Hurley — identity, contact, and preferences" exists, do NOT create "Dave's phone number" or "David Hurley contact info".
   - "Same topic" means same concept — e.g. if "POA forms — family info for Linda Wills" exists, do NOT create "Linda Wills identity" or "Mom's healthcare wishes".
   - If an existing memory exists on the same topic but the transcript has UPDATED information, UPDATE the existing file instead of creating a new one:
     a. Read the existing file first
     b. Copy it to a .bak file (same name + .bak) as a safety backup
     c. Merge the new info into the body. Old info stays (memories aren't erased), new info is added.
     d. Keep ALL existing YAML frontmatter fields intact. Only update \`date\` to now.
     e. After writing, read the file back and verify the YAML frontmatter still parses (has ---, date, category, subject fields). If corrupted, restore from .bak.
   - When in doubt, skip. A missed extraction is fine; a duplicate is not.
   - **Authority rule**: Memories with \`source: user\` are canonical. Never create or modify a memory that contradicts a user-stated fact.
4. Only write a memory if ALL of these are true:
   - Genuinely persistent (not transient session context)
   - Not covered by any existing memory (check the list above!)
   - Stated by the user or a clear factual outcome (not inferred)
   - Would be useful to recall in a future session
   - Covers a NEW subject not in the existing memories list
5. Write to $MEMORY_DIR with format:
   - Filename: YYYYMMDD-HHMM-slug.md
   - YAML frontmatter: date (ISO 8601), category, importance (1-5), subject, tags (list), confidence (0.7), source (auto-extraction)
   - Markdown body with the fact
6. Quality over quantity. Extracting 0 facts is the EXPECTED outcome for most turns. Only create files for genuinely new subjects.
7. Do NOT extract: temp task context, file paths being worked on, routine operations, things tracked in todos, code snippets, error messages, implementation details, secrets, passwords, or API keys.
8. When done, just exit. Do not output anything extra.
PROMPT_EOF

# Run extraction in a separate claude session (from /tmp to avoid loading project hooks)
cd /tmp
claude -p --model haiku --allowedTools "Read,Write,Edit,Grep,Glob,Bash" < "$PROMPT_FILE" > /dev/null 2>&1

rm -f "$PROMPT_FILE"
exit 0
