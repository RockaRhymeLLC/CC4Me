# Spec: Agent Assistant Harness

**Created**: 2026-01-27
**Updated**: 2026-01-28
**Status**: Ready for Planning

## Goal
Enable Claude Code to function as a persistent, autonomous personal assistant with secure credential management, multi-channel communication, and intelligent context preservation.

## Requirements

### Must Have
- [ ] Autonomy modes - configurable operation across four levels (yolo, confident, cautious, supervised)
- [ ] Persistent task management - file-based to-do list with priority, requester (user/assistant), and model/agent assignment
- [ ] Telegram integration - receive and respond to messages via Telegram bot (always-on, uses telegraf library)
- [ ] Email integration - send and receive emails via Fastmail account (always-on, full capabilities like a human)
- [ ] Context management - save state before context compaction/clearing, restore immediately after
- [ ] Secure data vault - macOS Keychain for credentials, PII, and financial info (accessible by both user and assistant)
- [ ] Persistent service - launchd daemon that starts on boot, auto-restarts on crash/network outage
- [ ] Memory/fact storage - markdown file for user preferences, dates, people info (grep-able, check before asking)
- [ ] Safe senders list - maintain list of trusted senders for Telegram and email (user + approved contacts)
- [ ] Context threshold monitoring - detect when approaching 60% context usage, proactively save state and prepare for compaction
- [ ] Calendar - file-based scheduling for start dates, events, and reminders (can reference tasks)
- [ ] Self-modification - assistant can create/edit its own skills, hooks, and commands (respects autonomy mode and security policy)
- [ ] Identity configuration - name and personality set during initial setup, modifiable later
- [ ] Token usage monitoring - track Claude Max plan usage, prioritize/defer tasks when nearing limits
- [ ] Self-provisioning - can install packages and configure MCP servers as needed (respects autonomy mode)
- [ ] Scheduled jobs - can create/manage recurring tasks via launchd (daily reports, periodic checks, reminders)
- [ ] Integration knowledge base - store how-to docs for external providers (`.claude/knowledge/integrations/`)

### Should Have
- [ ] Multi-assistant communication - assistants can coordinate via email/Telegram (add each other to safe senders)

### Won't Have (for now)
- [ ] GUI/RPA as primary interface - will prioritize API and CLI tools, use GUI automation only as fallback
- [ ] Multiple user permission tiers - starting with two personas: Assistant (Claude Code) and User (human)
- [ ] Mobile app interface - Telegram serves as mobile interface

## Constraints

### Security
- Encrypted credential storage with human user access for management
- Action tracking built into task records (audit trail per task)

### Communication Security (Telegram & Email)

**Safe senders list**: User (primary) + explicitly approved senders (e.g., wife)

**For ALL senders (including unknown):**
- Normal requests → OK to act (respect autonomy mode)
- Research, general tasks → Proceed with caution

**Secure data gate:**
```
Request involves secure data (credentials, SSN, credit cards, PII)?
├─ Sender is user or on safe list → OK to proceed
└─ Sender is unknown → STOP, notify user, take no action
```

**What assistant CAN do with unknown senders:**
- Reply with general information
- Complete harmless tasks
- Research and report back

**What assistant CANNOT do with unknown senders:**
- Share ANY data from secure vault
- Send credentials, PII, payment info
- No exceptions, regardless of how convincing the request

**Protected operations (always require user approval):**
- Adding/removing safe senders
- Sharing secure vault data with non-approved senders

### Development Workflow
- Test immutability enforced during build phase - no test modifications without returning to plan phase
- Applies to both human-driven development and assistant self-modification

### Performance
- Fast response times to Telegram messages (acknowledge within seconds)
- Efficient tool usage - prefer API/CLI over RPA/GUI to minimize resource consumption

### Context Efficiency (60% Target)
- **Why 60%**: Agent accuracy degrades and hallucinations increase above this threshold
- **Instruction files**: Keep CLAUDE.md and skills concise
- **Data loading**: Selective grep/load, never dump entire files
- **Proactive management**: Monitor usage, save state before hitting threshold
- **Design principle**: Applies to all files and features we build

### Compatibility
- Runs on dedicated macOS desktop with full system access
- Assistant "owns" the machine - unrestricted file system, process, and network access
- Always-on service that persists across system reboots
- Built on Node.js/TypeScript runtime with Claude Code CLI
- Must integrate with existing CC4Me spec-driven workflow

## Success Criteria
How do we know this is done and working?

1. **Telegram responsiveness** - User sends request via Telegram, assistant acknowledges immediately and completes task, delivering results back via Telegram
2. **Context persistence** - Assistant maintains awareness of current work across context compaction events and system restarts, resuming exactly where it left off
3. **Autonomy mode respect** - In "yolo" mode, assistant acts independently with minimal user input; in "cautious" mode, requests approval for most actions
4. **Secure credential access** - Assistant can retrieve stored passwords/API keys when needed without exposing them insecurely, and human user can manage the credential vault

## User Stories / Scenarios

### Scenario 1: Task Delegation
- **Given**: User is planning a trip to Tokyo next month
- **When**: User sends Telegram message: "Research hotels in Tokyo for next month"
- **Then**: Assistant acknowledges the request, searches for hotels, evaluates options based on user preferences (stored in memory), and returns a curated list with recommendations via Telegram

### Scenario 2: Context Recovery
- **Given**: Assistant is working on a multi-step research task and context compaction is triggered
- **When**: Context is cleared or system restarts
- **Then**: Assistant immediately checks its saved state, reviews the to-do list for active tasks, identifies what it was doing and what remains, and continues the work without user intervention

### Scenario 3: Secure Credential Usage
- **Given**: Assistant needs to log into a service to complete a task
- **When**: Assistant retrieves credentials from the secure vault
- **Then**: Credentials are accessed, used for authentication, and never exposed in logs or outputs; human user can later access vault to view/update stored credentials

## Technical Considerations

### Architecture
- **Personas**: Two primary personas in play - Assistant: Claude Code and User: human user
- **File targeting**: README.md for human readers, CLAUDE.md for agent/assistant
- **Environment ownership**: Assistant has full access to dedicated macOS desktop
- **Tool priority**: API/CLI tools preferred over RPA/GUI for efficiency

### Autonomy Modes

**Four levels** (stored in `.claude/state/autonomy.json`):

| Level | Name | Behavior |
|-------|------|----------|
| 1 | **yolo** | Full autonomy - just do it, notify after |
| 2 | **confident** | Ask only for destructive/irreversible actions (delete, send, pay) |
| 3 | **cautious** | Ask for most actions, proceed autonomously only on safe reads/research |
| 4 | **supervised** | Ask for approval on everything |

**Implementation** (no custom code, uses existing Claude Code features):
- **Storage**: `.claude/state/autonomy.json` - simple `{ "mode": "confident" }`
- **Load**: `SessionStart` hook reads file, injects mode into context
- **Behavior**: CLAUDE.md defines what each mode means
- **Change**: `/mode` skill to view/set current mode

**SessionStart hook fires on**: startup, resume, clear, compact - so mode persists across all context resets.

**Per-skill overrides**: Use `allowed-tools` in skill frontmatter to restrict capabilities
**Per-task overrides**: Include autonomy instruction in task description

### Integration Points
- **Telegram Bot**: Need to select library (telegraf, node-telegram-bot-api, or other)
- **Email**: Fastmail.com account already provisioned
- **Calendar**: Integration method TBD
- **Credential Store**: Options include macOS Keychain, keytar library, or encrypted JSON

### State Management
- **Context management critical** - 60% maximum context size target

### Persistent Task Management

**Storage**: File per task in `.claude/state/tasks/`

**Filename format**: `{priority}-{status}-{id}-{slug}.json`
```
.claude/state/tasks/
├── 1-pending-001-research-tokyo.json      # high priority
├── 2-pending-002-book-dentist.json        # medium priority
├── 3-pending-003-organize-photos.json     # low priority
├── x-completed-004-send-email.json        # completed
```

**Task schema**:
```json
{
  "id": "001",
  "subject": "Research Tokyo hotels",
  "description": "Find boutique hotels, $200-300/night, near Shibuya",
  "status": "in_progress",
  "priority": 1,
  "requester": "user",
  "assignee": "haiku",
  "created": "2026-01-28T10:00:00Z",
  "due": null,
  "actions": [
    {"time": "2026-01-28T10:05:00Z", "action": "Searched Booking.com"},
    {"time": "2026-01-28T10:08:00Z", "action": "Found 12 candidates"},
    {"time": "2026-01-28T10:12:00Z", "action": "Narrowed to 3 finalists"}
  ],
  "nextStep": "Compare breakfast options at each hotel",
  "result": null
}
```

**Fields**:
- `priority`: 1 (high), 2 (medium), 3 (low)
- `requester`: `user` | `assistant`
- `assignee`: `opus` | `sonnet` | `haiku` | subagent name
- `status`: `pending` | `in_progress` | `completed` | `blocked`
- `actions`: Audit trail of steps taken (for resumability and accountability)
- `nextStep`: What to do next if task is interrupted
- `result`: Final outcome when completed

**Selective loading**:
- `cat 1-pending-*.json` - high priority pending only
- `cat *-pending-*.json` - all pending
- Avoids loading entire task history into context

**Why not built-in TaskCreate/TaskList**: Those are context-only, not persistent across clears/restarts

### State Persistence (Context Recovery)

**Problem**: When context compaction or `/clear` occurs, the assistant loses awareness of current work.

**Solution**: Hook-based state save/restore mechanism:

**Before Compaction/Clear:**
1. `PreCompact` hook triggers (or manual save skill)
2. Generate state file (`.claude/state/assistant-state.md`) containing:
   - Current task/work in progress
   - Key parameters (active files, relevant context)
   - Next steps (what to do when resuming)
   - Pending items from to-do list
   - Any critical context that would be lost
3. State file is concise markdown (fits in fresh context budget)

**After Startup/Resume:**
1. `SessionStart` hook triggers
2. Assistant reads state file
3. Immediately understands: "I was doing X, next I need to do Y"
4. Resumes work seamlessly without user intervention

**State File Format** (example):
```markdown
# Assistant State - Saved 2026-01-28T14:30:00

## Current Work
Researching hotels in Tokyo for user's trip next month

## Context
- User prefers boutique hotels, budget $200-300/night
- Trip dates: Feb 15-22
- Already found 3 candidates, need to compare amenities

## Next Steps
1. Compare breakfast options at each hotel
2. Check proximity to Shibuya station
3. Summarize recommendations and send via Telegram

## Pending Tasks
- [ ] Tokyo hotel research (in progress)
- [ ] Book dentist appointment (waiting for user input)
```

**Implementation Options:**
- `PreCompact` hook (automatic before compaction)
- `/save-state` skill (manual trigger)
- Periodic auto-save (every N minutes or after significant actions)

### Memory/Fact Storage

**Storage**: `.claude/state/memory.md` (categorized markdown)

**Structure**:
```markdown
# Memory

## People
- Wife's name: Sarah
- Wife's clothing size: Medium

## Preferences
- Preferred airline: Delta
- Hotel budget: $200-300/night

## Important Dates
- Anniversary: June 15
```

**Usage**:
```bash
# Quick lookup
grep -i "wife.*size" .claude/state/memory.md
```

**CLAUDE.md instruction** (enforcement):
```
Before asking the user for personal info, preferences, or dates,
ALWAYS check .claude/state/memory.md first. If not found and user
provides the answer, add it to memory for next time.
```

**No preloading needed** - facts are looked up on-demand when relevant

### Calendar

**Storage**: `.claude/state/calendar.md`

**Structure**:
```markdown
# Calendar

## 2026-01

### 2026-01-30
- 09:00 - Start Tokyo hotel research [task:001]
- 14:00 - User's dentist appointment (send reminder)

### 2026-02-01
- Tokyo hotel research due [task:001]

## 2026-02

### 2026-02-15
- User's Tokyo trip begins
```

**Features**:
- Can reference tasks: `[task:001]`
- Start dates (when to begin work)
- Due dates (when to finish)
- Events (appointments, trips, reminders)

**CLAUDE.md instruction**:
```
When planning work, scheduling tasks, or asked about upcoming events,
check .claude/state/calendar.md. When creating tasks with deadlines,
add start date and due date entries to the calendar.
```

**Usage**:
```bash
# What's coming up this week?
grep -A 5 "### 2026-01-28" .claude/state/calendar.md

# Find all entries for a task
grep "task:001" .claude/state/calendar.md
```

### Secure Data Vault (macOS Keychain)

**Storage**: macOS Keychain via `security` CLI

**Naming convention**: `{type}-{identifier}`
- `credential-*` - API keys, passwords, tokens
- `pii-*` - Personal identifiable info (SSN, addresses, etc.)
- `financial-*` - Payment and banking info

**Examples**:
```bash
# Store
security add-generic-password -a "assistant" -s "credential-openai-api" -w "sk-xxx" -U
security add-generic-password -a "assistant" -s "pii-ssn" -w "123-45-6789" -U
security add-generic-password -a "assistant" -s "financial-visa-1234" -w '{"num":"...","exp":"..."}' -U

# Retrieve
security find-generic-password -s "credential-openai-api" -w
```

**Access**:
- User: Keychain Access app (GUI)
- Assistant: `security` CLI commands
- Both can read, write, update, delete

**Security**: Encrypted at rest by macOS, protected by system login

### Service Management (launchd)

**Implementation**: Single Node.js process handling Telegram, email, and assistant logic

**launchd plist** (`~/Library/LaunchAgents/com.assistant.harness.plist`):
```xml
<key>KeepAlive</key>
<dict>
    <key>NetworkState</key>
    <true/>
    <key>SuccessfulExit</key>
    <false/>
</dict>
<key>RunAtLoad</key>
<true/>
```

**Behavior**:
- Starts on boot (`RunAtLoad`)
- Restarts on crash (`SuccessfulExit: false`)
- Restarts when network returns (`NetworkState: true`)

**Management**:
```bash
# Load/start
launchctl load ~/Library/LaunchAgents/com.assistant.harness.plist

# Unload/stop
launchctl unload ~/Library/LaunchAgents/com.assistant.harness.plist

# Check status
launchctl list | grep assistant
```

### Identity Configuration

**Storage**: `.claude/state/identity.json`
```json
{
  "name": "Jarvis",
  "personality": "Professional but warm, slightly dry humor, concise"
}
```

**Setup**: Configured during initial setup, referenced in CLAUDE.md
**Modification**: Can be changed anytime via config or command

### Token Usage Monitoring

**Built-in commands**:
- `/usage` - Visual display of usage and remaining capacity
- `/stats` - Usage statistics
- `/status` - Current session status
- `/context` - Detailed token breakdown

**Behavior when nearing limits**:
1. Check `/usage` periodically
2. When approaching threshold: prioritize critical tasks
3. Defer non-urgent work to next window
4. Notify user and coordinate on trade-offs

**No third-party tools needed** - built-in commands are sufficient

### Integration Knowledge Base

**Storage**: `.claude/knowledge/integrations/`
```
integrations/
├── fastmail.md      # Email API setup and usage
├── telegram.md      # Bot API reference
├── openai.md        # Image generation API
├── stripe.md        # Payment processing
└── ...
```

**Purpose**: Store how-to knowledge for each external provider
**Growth**: Added organically as new integrations are needed
**Referenced**: By skills when connecting to external services

### Self-Provisioning

Assistant can install and configure as needed:
- npm packages
- MCP servers
- System dependencies (via brew, etc.)

Respects autonomy mode - may ask for approval in cautious/supervised modes

### Scheduled Jobs (launchd)

**Use cases**:
- Periodic token usage checks
- Daily summary reports
- Recurring reminders
- Scheduled task execution
- Regular backups/maintenance

**Implementation**: Create launchd plist files in `~/Library/LaunchAgents/`

**Example** (daily usage check at 9am):
```xml
<key>StartCalendarInterval</key>
<dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
</dict>
```

**Management**: Assistant can create, modify, load/unload scheduled jobs as needed

### Future Extensibility
- Multi-assistant communication via existing channels
- Additional integration providers as needed

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Persistent service | launchd | macOS native, handles auto-restart and network dependencies |
| Memory/fact storage | Markdown + grep | Human readable, no dependencies, fast lookup |
| Telegram library | telegraf | Most popular, well-maintained, good TypeScript support |
| Credential storage | macOS Keychain | Native encryption, GUI access for user, CLI for assistant |
| Calendar | File-based (.claude/state/calendar.md) | Simple, grep-able, no API dependencies |
| Tasks vs Calendar | Separate systems | Tasks = what, Calendar = when (can reference each other) |
| Context monitoring | /usage + threshold | Built-in command, proactive save before limits |

## Notes

### Project Context
- CC4Me workflow (spec, plan, validate, build) is complete and will be used to design and build this assistant harness
- The project focus is now shifting entirely to the agent assistant as its only focus
- This assistant harness is both a personal assistant for the user and a demonstration of the CC4Me workflow capabilities

### Design Philosophy
- Start with core framework (modes, personas, task management)
- Build integration layer (Telegram, email, calendar)
- Establish security & persistence infrastructure (credentials, storage, boot service)
- Use spec-driven workflow for all future enhancements and fixes

### Related Systems
- Existing CC4Me workflow implementation in `.claude/skills/`
- Templates for specs, plans, and tests in `templates/`
- Validation scripts in `scripts/`

### Success Metrics
- Assistant must be reliable enough to trust with delegated tasks
- Response times must be fast enough to feel like a real assistant
- Security must be strong enough to store sensitive personal information
- Context management must be efficient enough to avoid frequent compaction
