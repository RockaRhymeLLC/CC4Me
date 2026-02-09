/**
 * Memory Consolidation — rotate stale 24hr entries to timeline/ daily files.
 *
 * Checks if 24hr.md has entries older than 24 hours. If so, injects a prompt
 * for Claude to:
 *   1. Read the stale entries
 *   2. Condense them into timeline/YYYY-MM-DD.md daily files (with frontmatter)
 *   3. Extract any new persistent facts as individual memory files
 *   4. Remove processed entries from 24hr.md
 *
 * No more cascade compression (30day→yearly). Timeline files are append-only
 * with full detail preserved. Facts go in memories/, timeline is the index.
 *
 * If Claude isn't idle when the job fires, defers until next run.
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../../core/config.js';
import { isAgentIdle, injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('memory-consolidation');

const SUMMARIES_DIR = '.claude/state/memory/summaries';
const TIMELINE_DIR = '.claude/state/memory/timeline';

interface EntryInfo {
  date: Date;
  header: string;  // Full "### YYYY-MM-DD HH:MM — reason" line
  dateStr: string;  // Just the date part "YYYY-MM-DD"
}

/**
 * Parse entries from the 24hr log, returning date + header info.
 * Entries are separated by `---` and start with `### YYYY-MM-DD HH:MM`.
 */
function parseEntries(filePath: string): EntryInfo[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf8');
  const entries: EntryInfo[] = [];

  // Match entry headers: ### 2026-02-03 09:15 — reason
  const headerPattern = /^(### (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?(?: — (.*))?)/gm;
  let match;
  while ((match = headerPattern.exec(content)) !== null) {
    const dateStr = match[2]!;
    const timeStr = match[3] || '00:00';
    const parsed = new Date(`${dateStr}T${timeStr}`);
    if (!isNaN(parsed.getTime())) {
      entries.push({ date: parsed, header: match[1]!, dateStr });
    }
  }

  return entries;
}

/**
 * Check if any entries in a file are older than the given age in milliseconds.
 */
function hasStaleEntries(filePath: string, maxAgeMs: number): boolean {
  const entries = parseEntries(filePath);
  if (entries.length === 0) return false;

  const cutoff = Date.now() - maxAgeMs;
  return entries.some(e => e.date.getTime() < cutoff);
}

/**
 * Build a pre-filtered summary of stale entries, grouped by date.
 * Gives Claude a concise overview instead of making it read the full file.
 */
function summarizeStaleEntries(filePath: string, maxAgeMs: number): string {
  const entries = parseEntries(filePath);
  const cutoff = Date.now() - maxAgeMs;
  const stale = entries.filter(e => e.date.getTime() < cutoff);
  const fresh = entries.filter(e => e.date.getTime() >= cutoff);

  // Group stale entries by date
  const byDate = new Map<string, EntryInfo[]>();
  for (const e of stale) {
    const existing = byDate.get(e.dateStr) || [];
    existing.push(e);
    byDate.set(e.dateStr, existing);
  }

  // Check which dates already have timeline files
  const lines: string[] = [];
  for (const [date, dateEntries] of byDate) {
    const timelinePath = resolveProjectPath(TIMELINE_DIR, `${date}.md`);
    const exists = fs.existsSync(timelinePath);
    lines.push(`  - ${date}: ${dateEntries.length} entries${exists ? ' (timeline file exists — append)' : ' (new timeline file)'}`);
  }
  lines.push(`  - (${fresh.length} recent entries to keep)`);

  return lines.join('\n');
}

async function run(): Promise<void> {
  const hr24Path = resolveProjectPath(SUMMARIES_DIR, '24hr.md');

  const DAY_MS = 24 * 60 * 60 * 1000;

  const needsConsolidation = hasStaleEntries(hr24Path, DAY_MS);

  if (!needsConsolidation) {
    log.debug('No consolidation needed — all entries are fresh');
    return;
  }

  log.info('Consolidation needed: stale entries found in 24hr.md');

  if (!isAgentIdle()) {
    log.info('Agent is busy — deferring consolidation to next run');
    return;
  }

  // Ensure timeline directory exists
  const timelineDir = resolveProjectPath(TIMELINE_DIR);
  if (!fs.existsSync(timelineDir)) {
    fs.mkdirSync(timelineDir, { recursive: true });
  }

  const summary = summarizeStaleEntries(hr24Path, DAY_MS);

  const prompt = [
    '[System] Nightly memory consolidation is due. Rotate stale 24hr entries to timeline/ daily files.',
    '',
    'Entries to process:',
    summary,
    '',
    'Steps:',
    '1. Read the stale entries from `.claude/state/memory/summaries/24hr.md` (only the dates listed above)',
    '2. For each date, create or append to `.claude/state/memory/timeline/YYYY-MM-DD.md`:',
    '   - If creating a new file, add YAML frontmatter: date, sessions (count of entries), topics (key areas), todos (IDs worked on), highlights (one-line summary)',
    '   - If appending to existing file, update the frontmatter (increment sessions, merge topics/todos, update highlights if needed)',
    '   - Condense each entry into 2-3 sentences in the body: `### HH:MM — description`',
    '   - Preserve key details: what was done, decisions made, outcomes',
    '3. Extract any important NEW facts (people, decisions, tools, preferences) as individual memory files in `memories/`',
    '   - New memory files MUST include all frontmatter: date, category, importance, subject, tags, confidence, source',
    '   - Set `source: nightly-consolidation`',
    '   - Check the existing subjects list above. If ANY subject covers the same person or topic, UPDATE the existing file instead of creating a new one (read it, merge new info, write it back — old info stays, new info is added)',
    '   - "Same person" = same individual. "Same topic" = same concept. When in doubt, skip',
    '   - Memories with `source: user` are canonical. Never modify a user-stated memory to contradict what the user said',
    '4. Remove the processed entries from `24hr.md` (keep the file header and entries from the last 24 hours)',
    '',
    'This is a maintenance task. Complete it efficiently.',
  ].join('\n');

  log.info('Injecting consolidation prompt');
  injectText(prompt);
}

registerTask({ name: 'memory-consolidation', run });
