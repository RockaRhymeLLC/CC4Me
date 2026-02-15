/**
 * Transcript Cleanup task — removes old Claude Code JSONL transcript files.
 *
 * Claude Code creates a new .jsonl transcript per session in the project
 * directory (~/.claude/projects/...). These pile up at ~100/day and 100+ MB/week.
 * This task deletes files older than 7 days.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../core/logger.js';
import { getProjectDir } from '../../core/config.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('transcript-cleanup');

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function run(): Promise<void> {
  // Claude Code stores transcripts in ~/.claude/projects/<slug> where slug
  // is the project path with / replaced by -
  const slug = getProjectDir().replace(/\//g, '-');
  const projectDir = path.join(
    process.env.HOME || os.homedir(),
    '.claude/projects',
    slug,
  );

  if (!fs.existsSync(projectDir)) {
    log.warn(`Project dir not found: ${projectDir}`);
    return;
  }

  const now = Date.now();
  let deleted = 0;
  let freedBytes = 0;

  const entries = fs.readdirSync(projectDir);
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;

    const fullPath = path.join(projectDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        freedBytes += stat.size;
        fs.unlinkSync(fullPath);
        deleted++;
      }
    } catch {
      // File may have been deleted between readdir and stat — skip
    }
  }

  if (deleted > 0) {
    const mb = (freedBytes / (1024 * 1024)).toFixed(1);
    log.info(`Cleaned up ${deleted} old transcripts (${mb} MB freed)`);
  } else {
    log.info('No old transcripts to clean up');
  }
}

registerTask({ name: 'transcript-cleanup', run, requiresSession: false });
