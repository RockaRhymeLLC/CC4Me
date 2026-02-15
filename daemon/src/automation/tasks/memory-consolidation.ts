/**
 * Memory Consolidation — rotate stale 24hr entries to timeline/ daily files.
 *
 * Runs the rotation directly in the daemon (no prompt injection) so it's
 * deterministic and reliable. Steps:
 *   1. Parse entries from 24hr.md
 *   2. Identify stale entries (>24 hours old)
 *   3. Group by date, create/update timeline/YYYY-MM-DD.md files
 *   4. Remove processed entries from 24hr.md
 *
 * Timeline files use YAML frontmatter (date, sessions, topics, todos, highlights)
 * and a simple `### HH:MM — reason` body format. The entries are transferred
 * as-is from 24hr.md (condensed state snapshots), preserving all detail.
 *
 * Does NOT require Claude to be idle — purely file operations.
 */

import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { resolveProjectPath } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('memory-consolidation');

const SUMMARIES_DIR = '.claude/state/memory/summaries';
const TIMELINE_DIR = '.claude/state/memory/timeline';

const FILE_HEADER = `# 24-Hour State Log

Rolling log of state snapshots. Entries older than 24 hours rotate to timeline/ daily files.
`;

interface FullEntry {
  date: Date;
  dateStr: string;   // "YYYY-MM-DD"
  timeStr: string;   // "HH:MM"
  reason: string;    // Text after the "—" in the header
  body: string;      // Everything after the header line until next separator
  raw: string;       // Full raw text of the entry block (including separators)
}

/**
 * Parse full entries from 24hr.md content. Each entry is delimited by `---`
 * lines and starts with `### YYYY-MM-DD HH:MM — reason`.
 */
function parseFullEntries(content: string): FullEntry[] {
  const entries: FullEntry[] = [];

  // Split into blocks by --- separators. Entries look like:
  // ---\n### 2026-02-09 07:01 — reason\n\nbody content\n\n---
  const blocks = content.split(/^---$/m);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Look for the entry header pattern
    const headerMatch = trimmed.match(
      /^###\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*(?:—\s*(.*))?$/m,
    );
    if (!headerMatch) continue;

    const dateStr = headerMatch[1]!;
    const timeStr = headerMatch[2]!;
    const reason = headerMatch[3]?.trim() || '';
    const parsed = new Date(`${dateStr}T${timeStr}`);
    if (isNaN(parsed.getTime())) continue;

    // Body is everything after the header line
    const headerEnd = trimmed.indexOf('\n', trimmed.indexOf(headerMatch[0]));
    const body = headerEnd >= 0 ? trimmed.slice(headerEnd).trim() : '';

    entries.push({
      date: parsed,
      dateStr,
      timeStr,
      reason,
      body,
      raw: trimmed,
    });
  }

  return entries;
}

/**
 * Extract todo IDs from entry text. Matches [NNN], #NNN, [todo:NNN] patterns.
 */
function extractTodoIds(text: string): string[] {
  const ids = new Set<string>();
  // Match [NNN] where NNN is a number — common todo reference
  for (const m of text.matchAll(/\[(\d{2,3})\]/g)) ids.add(m[1]!);
  // Match #NNN for todo references (but not hex colors)
  for (const m of text.matchAll(/(?:^|[\s(])#(\d{2,3})(?=[\s).,;:]|$)/gm)) ids.add(m[1]!);
  // Match [todo:NNN]
  for (const m of text.matchAll(/\[todo:(\d+)\]/g)) ids.add(m[1]!);
  return [...ids].sort();
}

/**
 * Extract topic keywords from entry reasons and body text.
 * Returns lowercase kebab-case topics.
 */
function extractTopics(entries: FullEntry[]): string[] {
  const topics = new Set<string>();
  for (const entry of entries) {
    // Use the reason part of the header as the primary topic source
    if (entry.reason) {
      // Convert reason to a topic slug
      const slug = entry.reason
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, 4) // First 4 words
        .join('-');
      if (slug.length > 3) topics.add(slug);
    }
  }
  return [...topics];
}

/**
 * Build a condensed timeline body entry from a 24hr entry.
 * Format: ### HH:MM — reason\nCondensed body text
 */
function buildTimelineEntry(entry: FullEntry): string {
  const lines: string[] = [];
  lines.push(`### ${entry.timeStr} — ${entry.reason || 'checkpoint'}`);

  // Extract the key info from the structured body
  // Body typically has ## Current Task, ## Next Steps, ## Context sections
  if (entry.body) {
    // Pull out the current task line
    const taskMatch = entry.body.match(/(?:^|\n)\*\*.*?\*\*.*?(?:—|\.)\s*(.+)/);
    // Pull key bullet points (first 3 meaningful lines)
    const bullets = entry.body
      .split('\n')
      .filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'))
      .map(l => l.trim().replace(/^[-*]\s*/, ''))
      .filter(l => l.length > 10)
      .slice(0, 3);

    if (taskMatch) {
      lines.push(taskMatch[0].trim());
    }
    if (bullets.length > 0 && !taskMatch) {
      lines.push(bullets.join('. ').slice(0, 200));
    }
    if (!taskMatch && bullets.length === 0) {
      // Fall back to first non-empty, non-header line
      const firstLine = entry.body
        .split('\n')
        .find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
      if (firstLine) lines.push(firstLine.trim().slice(0, 200));
    }
  }

  return lines.join('\n');
}

interface TimelineFrontmatter {
  date: string;
  sessions: number;
  topics: string[];
  todos: string[];
  highlights: string;
}

/**
 * Parse YAML frontmatter from a timeline file.
 */
function parseFrontmatter(content: string): TimelineFrontmatter | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1]!;
  const dateMatch = fm.match(/^date:\s*(.+)$/m);
  const sessionsMatch = fm.match(/^sessions:\s*(\d+)$/m);
  const topicsMatch = fm.match(/^topics:\s*\[([^\]]*)\]$/m);
  const todosMatch = fm.match(/^todos:\s*\[([^\]]*)\]$/m);
  const highlightsMatch = fm.match(/^highlights:\s*"(.+)"$/m);

  return {
    date: dateMatch?.[1]?.trim() || '',
    sessions: parseInt(sessionsMatch?.[1] || '0', 10),
    topics: topicsMatch?.[1]
      ? topicsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
      : [],
    todos: todosMatch?.[1]
      ? todosMatch[1].split(',').map(t => t.trim()).filter(Boolean)
      : [],
    highlights: highlightsMatch?.[1] || '',
  };
}

/**
 * Build YAML frontmatter string.
 */
function buildFrontmatter(fm: TimelineFrontmatter): string {
  return [
    '---',
    `date: ${fm.date}`,
    `sessions: ${fm.sessions}`,
    `topics: [${fm.topics.join(', ')}]`,
    `todos: [${fm.todos.join(', ')}]`,
    `highlights: "${fm.highlights.replace(/"/g, '\\"')}"`,
    '---',
  ].join('\n');
}

/**
 * Create or update a timeline file for a specific date.
 */
function writeTimeline(
  dateStr: string,
  entries: FullEntry[],
): void {
  const timelinePath = resolveProjectPath(TIMELINE_DIR, `${dateStr}.md`);
  const exists = fs.existsSync(timelinePath);

  // Extract metadata from entries
  const allText = entries.map(e => `${e.reason}\n${e.body}`).join('\n');
  const todoIds = extractTodoIds(allText);
  const topics = extractTopics(entries);
  const highlights = entries
    .map(e => e.reason)
    .filter(Boolean)
    .slice(-3) // Last 3 reasons as highlight
    .join('. ');

  if (exists) {
    // Append to existing timeline file
    const existing = fs.readFileSync(timelinePath, 'utf8');
    const existingFm = parseFrontmatter(existing);

    if (existingFm) {
      // Merge frontmatter
      existingFm.sessions += entries.length;
      existingFm.topics = [
        ...new Set([...existingFm.topics, ...topics]),
      ];
      existingFm.todos = [
        ...new Set([...existingFm.todos, ...todoIds]),
      ];
      if (highlights) {
        existingFm.highlights += `. ${highlights}`;
        // Trim to reasonable length
        if (existingFm.highlights.length > 300) {
          existingFm.highlights = existingFm.highlights.slice(0, 297) + '...';
        }
      }

      // Replace frontmatter and append entries
      const bodyStart = existing.indexOf('---', existing.indexOf('---') + 1);
      const existingBody = bodyStart >= 0
        ? existing.slice(bodyStart + 3).trim()
        : '';

      const newEntries = entries.map(buildTimelineEntry).join('\n\n');
      const newContent = [
        buildFrontmatter(existingFm),
        '',
        existingBody,
        '',
        newEntries,
        '',
      ].join('\n');

      fs.writeFileSync(timelinePath, newContent);
      log.info(`Updated timeline: ${dateStr} (+${entries.length} entries)`);
    }
  } else {
    // Create new timeline file
    const fm: TimelineFrontmatter = {
      date: dateStr,
      sessions: entries.length,
      topics,
      todos: todoIds,
      highlights: highlights || 'Automated rotation from 24hr log',
    };

    const body = entries.map(buildTimelineEntry).join('\n\n');
    const content = [
      buildFrontmatter(fm),
      '',
      `# ${dateStr}`,
      '',
      body,
      '',
    ].join('\n');

    fs.writeFileSync(timelinePath, content);
    log.info(`Created timeline: ${dateStr} (${entries.length} entries)`);
  }
}

const CLAUDE_BIN = `${process.env.HOME}/.local/bin/claude`;
const MEMORIES_DIR = '.claude/state/memory/memories';

/**
 * Curate the memory store — spawn a haiku session to review memories for
 * duplicates, related facts to merge, and conflicts to resolve.
 * Runs after rotation, non-blocking to the daemon.
 */
function curateMemories(): void {
  const memoriesPath = resolveProjectPath(MEMORIES_DIR);

  // Build inventory of all memories with subjects and categories
  const files = fs.readdirSync(memoriesPath).filter(f => f.endsWith('.md'));
  if (files.length === 0) return;

  const inventory: string[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(`${memoriesPath}/${file}`, 'utf8');
      const subjMatch = content.match(/^subject:\s*(.+)$/m);
      const catMatch = content.match(/^category:\s*(.+)$/m);
      const subj = subjMatch?.[1]?.trim() || file;
      const cat = catMatch?.[1]?.trim() || 'unknown';
      inventory.push(`- ${file} [${cat}] ${subj}`);
    } catch { /* skip unreadable files */ }
  }

  const prompt = `You are a memory curator for a personal assistant.

MEMORY DIRECTORY: ${memoriesPath}

## EXISTING MEMORIES (${files.length} files)
${inventory.join('\n')}

## TASK

Review the memory inventory above and perform housekeeping:

### 1. Merge duplicates
Find memories with the same or very similar subjects. Read both files, merge the content into one (keeping the richer/newer file), and delete the other.

### 2. Consolidate related facts
Find small memories about the same person or topic that would be better as a single file. Merge them, keeping all facts. For example, 3 separate memories about the same person's contacts should become one.

### 3. Update stale inline history
If a memory has a "Previous" section where the old value is no longer useful, remove it.

### 4. Flag conflicts
If two memories disagree on the same fact, pick the one with higher authority (source: user > observation > extraction; newer > older) and update the other.

## RULES
- **Never modify memories with \`source: user\` and \`confidence: 0.9+\`** — those are canonical and human-curated. Only merge auto-extracted memories into them, never overwrite their content.
- **Quality over quantity** — doing nothing is fine if the store is clean. Most runs should result in 0-2 merges.
- When merging, keep the filename of the more authoritative/comprehensive file and delete the other.
- Update the \`date\` field to today when modifying a file.
- Do NOT create new memory files — only merge, edit, or delete existing ones.
- Work quickly. This is a housekeeping pass, not a deep analysis.

When done, exit silently.`;

  // Write prompt to temp file to avoid shell quoting issues
  const promptFile = `/tmp/cc4me-curation-prompt-${Date.now()}.txt`;
  fs.writeFileSync(promptFile, prompt);

  // Spawn claude -p in the background — fire and forget
  const child = execFile(
    CLAUDE_BIN,
    ['-p', '--model', 'haiku', '--allowedTools', 'Read,Write,Edit,Grep,Glob,Bash'],
    { timeout: 120_000, cwd: '/tmp' },
    (err) => {
      if (err) {
        log.warn('Memory curation failed', { error: err.message });
      } else {
        log.info('Memory curation complete');
      }
      // Clean up prompt file
      try { fs.unlinkSync(promptFile); } catch { /* ignore */ }
    },
  );

  // Pipe the prompt to stdin
  if (child.stdin) {
    child.stdin.write(fs.readFileSync(promptFile, 'utf8'));
    child.stdin.end();
  }
}

async function run(): Promise<void> {
  const hr24Path = resolveProjectPath(SUMMARIES_DIR, '24hr.md');

  if (!fs.existsSync(hr24Path)) {
    log.debug('No 24hr.md file found');
    return;
  }

  const content = fs.readFileSync(hr24Path, 'utf8');
  const entries = parseFullEntries(content);

  if (entries.length === 0) {
    log.debug('No entries in 24hr.md');
    return;
  }

  // Use date-based cutoff: anything from before today rotates out.
  // A strict 24-hour window misses entries created during the workday
  // because when the task fires at 5am, those entries are only 5-19 hours old.
  const todayStr = new Date().toISOString().slice(0, 10);

  const stale = entries.filter(e => e.dateStr < todayStr);
  const fresh = entries.filter(e => e.dateStr >= todayStr);

  if (stale.length === 0) {
    log.debug('No stale entries — all from today');
    return;
  }

  log.info(`Consolidating ${stale.length} stale entries (keeping ${fresh.length} fresh)`);

  // Ensure timeline directory exists
  const timelineDir = resolveProjectPath(TIMELINE_DIR);
  if (!fs.existsSync(timelineDir)) {
    fs.mkdirSync(timelineDir, { recursive: true });
  }

  // Group stale entries by date
  const byDate = new Map<string, FullEntry[]>();
  for (const entry of stale) {
    const existing = byDate.get(entry.dateStr) || [];
    existing.push(entry);
    byDate.set(entry.dateStr, existing);
  }

  // Write timeline files
  for (const [dateStr, dateEntries] of byDate) {
    try {
      writeTimeline(dateStr, dateEntries);
    } catch (err) {
      log.error(`Failed to write timeline for ${dateStr}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Rewrite 24hr.md with only fresh entries
  const freshBlocks = fresh.map(e => `---\n${e.raw}\n\n---`);
  const newContent = FILE_HEADER + '\n' + freshBlocks.join('\n\n') + '\n\n';
  fs.writeFileSync(hr24Path, newContent);

  log.info(
    `Consolidation complete: ${stale.length} entries → ${byDate.size} timeline file(s), ${fresh.length} entries kept`,
  );

  // Phase 2: Curate memory store (async, non-blocking)
  try {
    curateMemories();
  } catch (err) {
    log.warn('Failed to start memory curation', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

registerTask({
  name: 'memory-consolidation',
  run,
  requiresSession: false, // Rotation is file ops; curation spawns a background claude -p
});
