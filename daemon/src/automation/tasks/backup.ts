/**
 * Weekly Backup task — backs up the project directory.
 *
 * Calls the existing scripts/backup.sh which handles:
 * - Zip creation (excluding node_modules, .venv, .git, logs, models, dist)
 * - Integrity verification
 * - Size sanity check
 * - Rotation (keeps last 2 backups)
 *
 * Results are logged to ~/Documents/backups/ and the daemon log.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getProjectDir } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('backup');

async function run(): Promise<void> {
  const scriptPath = path.join(getProjectDir(), 'scripts', 'backup.sh');
  log.info('Starting weekly backup');

  try {
    const output = execFileSync('bash', [scriptPath], {
      encoding: 'utf8',
      timeout: 300_000, // 5 minute timeout for large zips
      cwd: getProjectDir(),
    });

    // Parse output for the summary line
    const sizeLine = output.match(/Backup created: (.+)/);
    if (sizeLine) {
      log.info(`Backup complete: ${sizeLine[1]}`);
    } else {
      log.info('Backup script completed');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Backup failed', { error: msg });
  }
}

registerTask({ name: 'backup', run, requiresSession: false });
