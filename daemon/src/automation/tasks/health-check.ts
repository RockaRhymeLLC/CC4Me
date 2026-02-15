/**
 * Health Check task — periodic system health check.
 *
 * Replaces: health-check.sh + legacy launchd job
 *
 * Runs the unified health check and injects a summary into Claude's
 * session if there are warnings or errors. Sends a Telegram alert
 * when errors are detected so the user gets notified even when away.
 */

import { runHealthCheck, formatReport } from '../../core/health.js';
import { injectText } from '../../core/session-bridge.js';
import { sendMessage as sendTelegram } from '../../comms/adapters/telegram.js';
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

  // Send Telegram alert for errors so the user gets notified when away
  if (report.summary.errors > 0) {
    const errorItems = report.results
      .filter((r: { severity: string }) => r.severity === 'error')
      .map((r: { category: string; message: string }) => `  - ${r.category}: ${r.message}`)
      .join('\n');
    sendTelegram(`[Health Alert] ${report.summary.errors} error(s) detected:\n${errorItems}`);
  }
}

registerTask({ name: 'health-check', run });
