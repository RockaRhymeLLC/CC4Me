/**
 * Memory Consolidation — cascading state log summarization.
 *
 * Checks if consolidation is needed (24hr.md has entries older than 24h,
 * or 30day.md has entries older than 30 days) and injects a prompt for
 * Claude to do the actual summarization work.
 *
 * Claude handles: reviewing entries, extracting memories, writing summaries,
 * cleaning up processed entries. The daemon just schedules and checks.
 *
 * If Claude isn't idle when the job fires, defers until next run.
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../../core/config.js';
import { isBusy, injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('memory-consolidation');

const SUMMARIES_DIR = '.claude/state/memory/summaries';

/**
 * Parse timestamped entries from a cascade file.
 * Entries are separated by `---` and start with `### YYYY-MM-DD HH:MM`.
 */
function parseEntryDates(filePath: string): Date[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf8');
  const dates: Date[] = [];

  // Match entry headers: ### 2026-02-03 09:15 — reason
  const headerPattern = /^### (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)/gm;
  let match;
  while ((match = headerPattern.exec(content)) !== null) {
    const parsed = new Date(match[1]!);
    if (!isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  return dates;
}

/**
 * Check if any entries in a file are older than the given age in milliseconds.
 */
function hasStaleEntries(filePath: string, maxAgeMs: number): boolean {
  const dates = parseEntryDates(filePath);
  if (dates.length === 0) return false;

  const cutoff = Date.now() - maxAgeMs;
  return dates.some(d => d.getTime() < cutoff);
}

async function run(): Promise<void> {
  const hr24Path = resolveProjectPath(SUMMARIES_DIR, '24hr.md');
  const day30Path = resolveProjectPath(SUMMARIES_DIR, '30day.md');

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTH_MS = 30 * DAY_MS;

  const needs24hConsolidation = hasStaleEntries(hr24Path, DAY_MS);
  const needs30dConsolidation = hasStaleEntries(day30Path, MONTH_MS);

  if (!needs24hConsolidation && !needs30dConsolidation) {
    log.debug('No consolidation needed — all entries are fresh');
    return;
  }

  log.info(`Consolidation needed: 24h=${needs24hConsolidation}, 30d=${needs30dConsolidation}`);

  if (isBusy()) {
    log.info('Claude is busy — deferring consolidation to next run');
    return;
  }

  // Build the consolidation prompt based on what needs processing
  const parts: string[] = [
    '[System] Nightly memory consolidation is due. Please process the following:',
  ];

  if (needs24hConsolidation) {
    parts.push(
      '',
      '1. Review `.claude/state/memory/summaries/24hr.md` for entries older than 24 hours:',
      '   - Summarize each day\'s entries into 2-4 sentences in `30day.md` (highlights, decisions, accomplishments — skip routine ops)',
      '   - Include snapshot count in header: e.g., "### 2026-02-03 (from 8 snapshots)"',
      '   - Extract any important new facts (people, decisions, tools, preferences) as individual memory files in `memories/`',
      '   - Add back-references: `[mem:YYYYMMDD-HHMM-slug]` in summaries, `source:` field in memory frontmatter',
      '   - Remove the processed entries from `24hr.md` (keep the file header and any entries from the last 24 hours)',
    );
  }

  if (needs30dConsolidation) {
    parts.push(
      '',
      `${needs24hConsolidation ? '2' : '1'}. Review \`.claude/state/memory/summaries/30day.md\` for entries older than 30 days:`,
      '   - Summarize each month\'s entries into 3-5 sentences in the yearly file (e.g., `2026.md`)',
      '   - Focus on themes, milestones, and significant changes',
      '   - Reference key memory files',
      '   - Remove the processed entries from `30day.md`',
    );
  }

  parts.push(
    '',
    'This is a high-priority maintenance task. Complete it before moving to other work.',
  );

  const prompt = parts.join('\n');

  log.info('Injecting consolidation prompt');
  injectText(prompt);
}

registerTask({ name: 'memory-consolidation', run });
