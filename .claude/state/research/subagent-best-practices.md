# Subagent Best Practices for Token Optimization

**Research Date**: 2026-01-29
**Context**: CC4Me personal assistant running on Opus, looking to reduce token costs by delegating to cheaper models via subagents.

---

## Table of Contents

1. [Claude Code Subagent Capabilities](#1-claude-code-subagent-capabilities)
2. [Model Tier Strengths and Pricing](#2-model-tier-strengths-and-pricing)
3. [Best Practices](#3-best-practices)
4. [CC4Me-Specific Recommendations](#4-ccme-specific-recommendations)
5. [Token Cost Analysis](#5-token-cost-analysis)
6. [Prioritized Recommendations](#6-prioritized-recommendations)

---

## 1. Claude Code Subagent Capabilities

### How Subagents Work

Subagents are specialized AI instances that run in their own context window with:
- A custom system prompt (the markdown body of the agent definition)
- Specific tool access (configurable allowlist/denylist)
- Independent permissions (can override the parent's permission mode)
- Their own model selection (can differ from the parent conversation)

When Claude encounters a task matching a subagent's description, it delegates to that subagent. The subagent works independently and returns results (a summary) to the parent conversation.

**Key architectural point**: Subagents do NOT receive the parent's conversation history. Context must be explicitly provided in the delegation prompt. They also cannot spawn other subagents (no nesting).

### The `model` Parameter

Available values for the `model` field in subagent configuration:

| Value | Behavior |
|-------|----------|
| `haiku` | Uses Claude Haiku 4.5 (fast, cheap) |
| `sonnet` | Uses Claude Sonnet 4.5 (balanced) |
| `opus` | Uses Claude Opus 4.5 (most capable) |
| `inherit` | Uses the same model as the parent conversation |
| *(omitted)* | Defaults to `inherit` |

The model can also be overridden globally via the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable.

Model aliases map to specific model versions controlled by environment variables:
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` -- overrides what `haiku` resolves to
- `ANTHROPIC_DEFAULT_SONNET_MODEL` -- overrides what `sonnet` resolves to
- `ANTHROPIC_DEFAULT_OPUS_MODEL` -- overrides what `opus` resolves to

### Built-in Subagent Types

| Agent | Default Model | Tools | Purpose |
|-------|--------------|-------|---------|
| **Explore** | Haiku | Read-only (Glob, Grep, Read) | Fast codebase search and analysis |
| **Plan** | Inherits | Read-only | Research for plan mode |
| **General-purpose** | Inherits | All tools | Complex multi-step tasks |
| **Bash** | Inherits | Bash only | Terminal commands in separate context |
| **Claude Code Guide** | Haiku | - | Answering Claude Code feature questions |

### Tool Access

Subagents can be configured with:
- **`tools`** field (allowlist): Only these tools are available
- **`disallowedTools`** field (denylist): These tools are removed from the inherited set
- **Default**: Inherits all tools from the parent conversation, including MCP tools

Available internal tools: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `WebSearch`, `Task` (though subagents cannot use Task -- no nesting).

### MCP Server Access

- **Foreground subagents**: Inherit MCP tool access from the parent conversation
- **Background subagents**: MCP tools are NOT available (this is a documented limitation)
- **Known bugs** (as of late 2025): Custom plugin subagents and project-scoped MCP servers may have issues with MCP tool access in subagents. User-scoped MCP servers work more reliably.

### Creating Custom Subagents

Subagents are defined as Markdown files with YAML frontmatter:

**File locations** (in priority order):
1. `--agents` CLI flag (session only, highest priority)
2. `.claude/agents/` (project-level)
3. `~/.claude/agents/` (user-level, all projects)
4. Plugin `agents/` directory (lowest priority)

**Example configuration**:
```markdown
---
name: quick-lookup
description: Fast file search and simple code questions. Use proactively for lookups.
tools: Read, Grep, Glob
model: haiku
---

You are a fast lookup assistant. Search the codebase and answer questions concisely.
Focus on finding specific information quickly. Return only the relevant results.
```

### Skills in Subagents

The `skills` field preloads skill content into a subagent's context at startup:
```yaml
---
name: api-developer
skills:
  - api-conventions
  - error-handling-patterns
---
```

Subagents do NOT inherit skills from the parent -- they must be listed explicitly.

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Standard permission checking |
| `acceptEdits` | Auto-accept file edits |
| `dontAsk` | Auto-deny permission prompts |
| `bypassPermissions` | Skip all permission checks |
| `plan` | Read-only exploration |

### Foreground vs Background Execution

| Aspect | Foreground | Background |
|--------|-----------|------------|
| Blocking | Yes -- blocks main conversation | No -- runs concurrently |
| Permission prompts | Passed through to user | Pre-approved before launch |
| MCP tools | Available | NOT available |
| Clarifying questions | Supported | Fail silently |
| Best for | Tasks needing interaction | Independent parallel work |

Background can be triggered by asking Claude to "run in the background" or pressing Ctrl+B.

---

## 2. Model Tier Strengths and Pricing

### Pricing Comparison (per million tokens)

| Model | Input Cost | Output Cost | Relative to Haiku (Input) | Relative to Haiku (Output) |
|-------|-----------|-------------|--------------------------|---------------------------|
| **Haiku 4.5** | $1.00 | $5.00 | 1x (baseline) | 1x (baseline) |
| **Sonnet 4.5** | $3.00 | $15.00 | 3x | 3x |
| **Opus 4.5** | $5.00 | $25.00 | 5x | 5x |

**Prompt caching** (applies to all tiers):
- 5-minute cache write: 1.25x base input price
- 1-hour cache write: 2x base input price
- Cache read: 0.1x base input price (massive savings)

**Extended thinking**: Billed as output tokens at standard rates. The default budget is 31,999 tokens per turn, which can add significant cost at Opus rates ($0.80 per turn at max budget).

### Model Strengths

#### Haiku 4.5 -- The Speed Specialist
- **Best for**: File searches, simple lookups, code exploration, pattern matching, quick questions, formatting, data extraction, repetitive tasks
- **Speed**: Fastest response times, ~2x faster than Sonnet
- **Quality**: Comparable to Sonnet 4 (previous generation) for coding tasks
- **Cost efficiency**: 3-5x cheaper than Opus
- **Limitations**: Less capable at complex reasoning, nuanced judgment, multi-step planning
- **Note**: Does NOT support MCP Tool Search feature

#### Sonnet 4.5 -- The Workhorse
- **Best for**: Feature implementation, bug fixing, test writing, code review, moderate complexity reasoning, most daily coding tasks, agentic workflows
- **Speed**: Good balance of speed and capability
- **Quality**: Excellent for coding and agentic tasks; recommended default by Anthropic
- **Cost efficiency**: 1.67x cheaper than Opus
- **Supports**: 1M token context window (at premium pricing above 200K tokens)

#### Opus 4.5 -- The Expert
- **Best for**: Complex architectural decisions, multi-step reasoning, tricky debugging, security analysis, nuanced judgment calls, understanding complex systems, creative problem-solving
- **Speed**: Slowest of the three
- **Quality**: State-of-the-art across all dimensions
- **When truly necessary**: Problems that require deep reasoning chains, tasks where getting it wrong is costly, situations needing nuanced human-like judgment

### The `opusplan` Mode

A hybrid approach available as a model alias:
- Uses **Opus** during plan mode (complex reasoning and architecture)
- Automatically switches to **Sonnet** for execution (code generation)

This is relevant for our spec/plan/build workflow -- planning could use Opus while implementation uses Sonnet.

---

## 3. Best Practices

### When to Use Subagents vs Direct Work

**Use subagents when**:
- The task produces verbose output (test results, logs, documentation fetching)
- Work is self-contained and can return a summary
- You want to enforce specific tool restrictions
- Parallel independent investigations are needed
- Context isolation prevents pollution of the main conversation
- You want to use a cheaper model for part of the work

**Stay in main conversation when**:
- The task needs frequent back-and-forth or iterative refinement
- Multiple phases share significant context (planning then implementing)
- Making a quick, targeted change
- Latency matters (subagents start fresh and need time to gather context)
- MCP tools are needed AND work must run in background

### Writing Effective Subagent Prompts

1. **Provide explicit context**: Subagents do not see conversation history. Include file paths, error messages, and relevant background directly in the prompt.
2. **Use absolute paths**: Relative paths are less reliable across contexts.
3. **Be specific about deliverables**: Tell the subagent exactly what to return ("list only failing tests with error messages" vs "run the tests").
4. **Keep tasks focused**: One subagent = one clear task. Avoid multi-purpose instructions.
5. **Specify thoroughness**: The Explore agent accepts levels: `quick`, `medium`, `very thorough`.

### Limitations and Gotchas

1. **No nesting**: Subagents cannot spawn other subagents.
2. **No conversation history**: Must provide all context explicitly.
3. **Background MCP restriction**: MCP tools unavailable in background mode.
4. **Context consumption on return**: When subagents complete, their results enter the main conversation context. Many detailed subagent results can consume significant context.
5. **Token constraints**: Large explorations may hit context limits within the subagent itself.
6. **Plugin subagent MCP bugs**: Custom plugin subagents may not access MCP tools correctly (known issue as of late 2025).
7. **Project-scoped MCP**: Subagents may have trouble with project-scoped `.mcp.json` MCP servers; user-scoped servers are more reliable.
8. **Startup latency**: Subagents start fresh and may need time to gather context before being productive.
9. **Skills not inherited**: Parent conversation's skills are not passed to subagents; use the `skills` field to explicitly preload them.

### Cost Optimization Strategies (from Official Docs)

1. **Choose the right model for subagents**: Use `model: haiku` for exploration, `model: sonnet` for implementation.
2. **Use `/clear` between unrelated tasks**: Prevents stale context from inflating costs.
3. **Move specialized instructions from CLAUDE.md to skills**: Skills load on-demand; CLAUDE.md is always in context.
4. **Reduce MCP server overhead**: Disable unused servers; prefer CLI tools (`gh`, `aws`) over MCP equivalents.
5. **Delegate verbose operations to subagents**: Keep test output, logs, and documentation fetches out of main context.
6. **Write specific prompts**: Vague requests trigger broad scanning.
7. **Use prompt caching**: Automatic in Claude Code; cache reads are 10x cheaper.
8. **Adjust extended thinking**: Lower or disable for simple tasks (`MAX_THINKING_TOKENS=8000`).

---

## 4. CC4Me-Specific Recommendations

### Task Delegation Map

Here is how each CC4Me capability maps to model tiers:

| Task Category | Current (Opus) | Recommended Model | Rationale |
|--------------|---------------|-------------------|-----------|
| **Todo management** | Opus | **Haiku** | Simple CRUD on markdown files; no complex reasoning needed |
| **Calendar management** | Opus | **Haiku** | Reading/writing structured data to markdown |
| **Memory lookups** | Opus | **Haiku** | Simple file reads and pattern matching |
| **Telegram message reading** | Opus | **Haiku** | Parsing and summarizing incoming messages |
| **Telegram message sending** | Opus | **Sonnet** | Needs judgment for tone/content; involves MCP (foreground only) |
| **Email reading/triage** | Opus | **Sonnet** | Needs judgment for spam detection, priority assessment |
| **Email composing** | Opus | **Sonnet** | Needs good writing quality and tone matching |
| **Web research** | Opus | **Sonnet** | Needs synthesis and judgment; multi-step |
| **File management** | Opus | **Haiku** | Simple operations, listing, searching |
| **System maintenance** | Opus | **Haiku/Sonnet** | Haiku for checks; Sonnet for decisions about what to clean/update |
| **Spec writing** | Opus | **Opus** | Requires deep understanding and creative structuring |
| **Plan creation** | Opus | **Opus** (or `opusplan`) | Architectural reasoning, test design |
| **Build/implementation** | Opus | **Sonnet** | Code generation is Sonnet's strength |
| **Validation** | Opus | **Sonnet** | Systematic comparison; moderate complexity |
| **Orchestration/routing** | Opus | **Opus** | The main agent must stay Opus for complex judgment |

### Proposed Subagent Configurations

#### 1. `quick-lookup` (Haiku)
```markdown
---
name: quick-lookup
description: Fast file lookups, todo operations, calendar checks, and memory reads. Use proactively for any simple data retrieval.
tools: Read, Grep, Glob
model: haiku
permissionMode: plan
---

You are a fast lookup assistant for a personal assistant system.
Your working directory contains state files in .claude/state/:
- todos/ -- Todo files in markdown
- calendar.md -- Calendar events
- memory.md -- Facts about the user
- safe-senders.json -- Trusted contacts

When asked to look something up:
1. Search the relevant files
2. Return only the specific information requested
3. Be concise -- the main agent will handle interpretation
```

#### 2. `file-ops` (Haiku)
```markdown
---
name: file-ops
description: File management operations like searching, listing, organizing, and simple edits. Use for routine file system tasks.
tools: Read, Write, Edit, Glob, Grep, Bash
model: haiku
---

You are a file management assistant. Perform file operations as instructed.
Return a brief summary of what was done.
Use absolute paths. Be careful with deletions -- confirm before removing.
```

#### 3. `message-composer` (Sonnet)
```markdown
---
name: message-composer
description: Compose emails and messages with appropriate tone and content. Use when drafting communications.
tools: Read, Grep, Glob
model: sonnet
---

You are a message composition assistant for a personal assistant.
When composing messages:
1. Match the appropriate tone for the recipient and context
2. Be clear and concise
3. Check .claude/state/memory.md for relevant facts about the recipient
4. Return the composed message for the main agent to send
```

#### 4. `code-builder` (Sonnet)
```markdown
---
name: code-builder
description: Implement code changes, write tests, and fix bugs. Use for all code implementation tasks.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
permissionMode: acceptEdits
---

You are a code implementation assistant. Follow test-driven development:
1. Read the plan/spec provided
2. Write tests first
3. Implement to pass tests
4. Run tests to verify
5. Report results

Follow existing code patterns. Do not modify test files unless explicitly told.
```

#### 5. `system-checker` (Haiku)
```markdown
---
name: system-checker
description: Check system health, disk space, updates, and maintenance status. Use for routine system checks.
tools: Bash, Read, Glob
model: haiku
permissionMode: dontAsk
---

You are a system maintenance checker. Run diagnostic commands and report status.
Check: disk space, brew outdated, system updates, log sizes, temp files.
Return a structured report with any items needing attention.
```

### Delegation Patterns

#### Pattern 1: Parallel Information Gathering
When the user asks a question that requires checking multiple sources:
```
Main Agent (Opus): Receives user question
  -> Subagent 1 (Haiku): Check todos
  -> Subagent 2 (Haiku): Check calendar
  -> Subagent 3 (Haiku): Check memory
Main Agent (Opus): Synthesizes results and responds
```

#### Pattern 2: Compose-Then-Send
For sending messages:
```
Main Agent (Opus): Determines what to communicate
  -> Subagent (Sonnet): Drafts the message
Main Agent (Opus): Reviews and sends via MCP (must be foreground for MCP)
```

#### Pattern 3: Research-Then-Decide
For tasks requiring investigation:
```
Main Agent (Opus): Identifies the question
  -> Subagent (Sonnet): Performs web research / code exploration
Main Agent (Opus): Makes the decision based on findings
```

#### Pattern 4: Build Delegation
For the spec/plan/build workflow:
```
Main Agent (Opus): Creates spec (stays in main context)
Main Agent (Opus): Creates plan (stays in main context, or uses opusplan)
  -> Subagent (Sonnet): Implements each story from the plan
Main Agent (Opus): Validates implementation
```

---

## 5. Token Cost Analysis

### Current Cost Profile (All Opus)

Assuming a typical session with ~100K input tokens and ~20K output tokens per interaction:
- Input: 100K * $5.00/M = $0.50 per interaction
- Output: 20K * $25.00/M = $0.50 per interaction
- **Total: ~$1.00 per interaction**

With extended thinking at default budget (31,999 tokens):
- Thinking output: 32K * $25.00/M = $0.80 per turn
- **Total with thinking: ~$1.80 per interaction**

### Optimized Cost Profile (Delegated)

If 60% of work is delegated to Haiku and 25% to Sonnet:

**Haiku tasks (60% of interactions)**:
- Input: 50K * $1.00/M = $0.05
- Output: 10K * $5.00/M = $0.05
- **Haiku total: ~$0.10 per interaction**

**Sonnet tasks (25% of interactions)**:
- Input: 80K * $3.00/M = $0.24
- Output: 15K * $15.00/M = $0.23
- **Sonnet total: ~$0.47 per interaction**

**Opus tasks (15% of interactions -- orchestration, specs, complex decisions)**:
- Input: 100K * $5.00/M = $0.50
- Output: 20K * $25.00/M = $0.50
- **Opus total: ~$1.00 per interaction** (but only 15% of the time)

### Estimated Savings

| Scenario | Avg Cost/Interaction | Daily (50 interactions) | Monthly |
|----------|---------------------|------------------------|---------|
| All Opus | ~$1.00 | ~$50 | ~$1,500 |
| All Opus + thinking | ~$1.80 | ~$90 | ~$2,700 |
| Optimized delegation | ~$0.30 | ~$15 | ~$450 |
| **Savings** | **~70%** | **~$35-75/day** | **~$1,050-2,250/mo** |

These are rough estimates. Actual savings depend on:
- How much context each interaction requires
- Extended thinking usage patterns
- Prompt caching hit rates (can reduce costs by up to 90% for cached content)
- The ratio of simple vs complex tasks in your usage

### Quick Wins for Immediate Savings

1. **Set `CLAUDE_CODE_SUBAGENT_MODEL=haiku`**: Makes all default subagent delegation use Haiku instead of inheriting Opus.
2. **Lower extended thinking for simple tasks**: Set `MAX_THINKING_TOKENS=8000` or disable when not doing complex reasoning.
3. **Use `/clear` between tasks**: Prevents context bloat.
4. **Move specialized CLAUDE.md content to skills**: Reduces base context size.

---

## 6. Prioritized Recommendations

### Priority 1 -- Immediate, High Impact

1. **Create a `quick-lookup` Haiku subagent** for todo, calendar, and memory reads. These are the most frequent operations and require zero complex reasoning.

2. **Set `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`** as the global default so that any auto-delegated subagent work uses Sonnet instead of inheriting Opus.

3. **Lower extended thinking budget** for the main agent to ~8,000 tokens for routine operations. Keep higher budgets only for spec/plan work.

### Priority 2 -- Medium-Term, Moderate Impact

4. **Create a `code-builder` Sonnet subagent** for the `/build` skill. Implementation is Sonnet's sweet spot and the build phase generates the most tokens.

5. **Create a `system-checker` Haiku subagent** for all maintenance tasks (disk space, updates, log rotation). These are simple diagnostic operations.

6. **Create a `message-composer` Sonnet subagent** for drafting emails and Telegram messages. Good writing quality without Opus costs.

7. **Move detailed skill instructions out of CLAUDE.md** into on-demand skills to reduce base context size.

### Priority 3 -- Longer-Term Optimization

8. **Explore `opusplan` mode** for the spec/plan/build workflow: Opus for planning, automatic switch to Sonnet for implementation.

9. **Create a `file-ops` Haiku subagent** for routine file management tasks.

10. **Implement parallel subagent patterns** for multi-source information gathering (checking todos + calendar + memory simultaneously with Haiku subagents).

11. **Audit MCP server usage** -- disable any MCP servers not actively used to reduce context overhead. Prefer CLI equivalents (`gh` over GitHub MCP) where possible.

12. **Consider reducing prompt caching costs** by evaluating whether 1-hour cache writes (2x cost) are worth it vs 5-minute cache writes (1.25x cost) based on session patterns.

### Implementation Notes

- Subagent files go in `.claude/agents/` (project-level) or `~/.claude/agents/` (user-level)
- Subagents are loaded at session start; restart required after adding new files (or use `/agents`)
- Test each subagent individually before relying on auto-delegation
- Monitor costs with `/cost` to measure actual savings
- Subagents that need MCP tools (Telegram, email) MUST run in foreground, not background
- The main orchestrating agent should remain Opus for its judgment on routing and complex decisions

---

## Sources

- [Claude Code Subagents Documentation](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Claude Code Cost Management](https://code.claude.com/docs/en/costs)
- [Claude Code Model Configuration](https://code.claude.com/docs/en/model-config)
- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp)
- [Claude Code Documentation Index](https://code.claude.com/docs/llms.txt)
- [Anthropic API Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [The Task Tool: Claude Code's Agent Orchestration System (DEV Community)](https://dev.to/bhaidar/the-task-tool-claude-codes-agent-orchestration-system-4bf2)
- [Agentic Coding with Claude Haiku 4.5 (Skywork)](https://skywork.ai/blog/agentic-coding-claude-haiku-4-5-beginners-guide-sub-agent-orchestration/)
- [Claude Haiku 4.5 Deep Dive (Caylent)](https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity)
- [Background subagents MCP bug (GitHub Issue #13254)](https://github.com/anthropics/claude-code/issues/13254)
- [Plugin subagents MCP bug (GitHub Issue #13605)](https://github.com/anthropics/claude-code/issues/13605)
- [Claude AI Pricing Guide 2026 (aifreeapi)](https://www.aifreeapi.com/en/posts/claude-api-pricing-per-million-tokens)
