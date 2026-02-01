/**
 * Context Watchdog — monitors context usage, triggers save + clear.
 *
 * Replaces: context-watchdog.sh + com.bmo.context-watchdog launchd job
 *
 * At the configured threshold (default 35% remaining), injects /save-state
 * into Claude's session, waits, then sends /clear.
 */

import fs from 'node:fs';
import { resolveProjectPath, loadConfig } from '../../core/config.js';
import { isBusy, injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('context-watchdog');

const STALE_SECONDS = 300; // Ignore data older than 5 minutes

async function run(): Promise<void> {
  const stateFile = resolveProjectPath('.claude', 'state', 'context-usage.json');

  if (!fs.existsSync(stateFile)) return;

  // Check freshness
  const stats = fs.statSync(stateFile);
  const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
  if (ageSeconds > STALE_SECONDS) return;

  // Parse context usage
  let data: { remaining_percentage?: number; used_percentage?: number; timestamp?: number };
  try {
    data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return;
  }

  const remaining = data.remaining_percentage ?? 100;
  const used = data.used_percentage ?? 0;

  // Get threshold from scheduler config
  const config = loadConfig();
  const taskConfig = config.scheduler.tasks.find(t => t.name === 'context-watchdog');
  const threshold = (taskConfig?.config?.threshold_percent as number) ?? 35;

  if (remaining >= threshold) return;

  log.info(`Context low: ${used}% used, ${remaining}% remaining (threshold: ${threshold}%)`);

  // Double-check Claude isn't busy
  if (isBusy()) {
    log.info('Skipping: Claude is busy');
    return;
  }

  // Inject save-state
  log.info('Triggering /save-state');
  injectText(`/save-state "Auto-save: context at ${used}% used"`);

  // Wait for save-state to complete
  await new Promise(resolve => setTimeout(resolve, 15_000));

  // Re-check busy
  if (isBusy()) {
    log.info('Save-state still running, waiting...');
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }

  // Send /clear
  log.info('Sending /clear');
  injectText('/clear');
}

registerTask({ name: 'context-watchdog', run });
