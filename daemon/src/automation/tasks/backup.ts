/**
 * Backup task — weekly backup of project state.
 *
 * Runs backup.sh which creates a zip of the project (excluding
 * node_modules, .git, logs, models) and rotates old backups.
 */

import { execSync } from 'node:child_process';
import { getProjectDir } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('backup');

async function run(): Promise<void> {
  const projectDir = getProjectDir();
  const scriptPath = `${projectDir}/scripts/backup.sh`;

  try {
    log.info('Starting backup');
    const output = execSync(`bash "${scriptPath}"`, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000, // 5 minute timeout
    });

    // Script logs to its own file, but capture any stdout
    if (output.trim()) {
      log.info('Backup output', { output: output.trim() });
    }

    log.info('Backup completed successfully');
  } catch (err) {
    log.error('Backup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

registerTask({ name: 'backup', run });
