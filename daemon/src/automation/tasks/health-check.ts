/**
 * Health Check task — periodic system health check.
 *
 * Replaces: health-check.sh + com.assistant.health-check launchd job
 *
 * Runs the unified health check and injects a summary into Claude's
 * session if there are warnings or errors.
 */

import { runHealthCheck, formatReport } from '../../core/health.js';
import { injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('health-check-task');

async function run(): Promise<void> {
  const report = await runHealthCheck();

  // Only bother Claude if there are warnings or errors
  if (report.summary.warnings === 0 && report.summary.errors === 0) {
    log.info('Health check passed: all OK');
    return;
  }

  const summary = formatReport(report, true); // quiet mode = only problems
  log.info(`Health issues found: ${report.summary.warnings} warnings, ${report.summary.errors} errors`);

  injectText(`[System] Health check found issues:\n${summary}`);
}

registerTask({ name: 'health-check', run });
