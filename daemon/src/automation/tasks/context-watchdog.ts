/**
 * Context Watchdog — monitors context usage, nudges Claude to save + clear.
 *
 * Replaces: context-watchdog.sh + legacy launchd job
 *
 * When context drops below the configured threshold (default 35% remaining):
 * - If Claude is idle: injects /save-state + /clear directly
 * - If Claude is busy: injects a reminder so Claude can find a good
 *   stopping point and save/clear on its own terms
 *
 * Only sends one reminder per low-context episode to avoid spamming.
 */

import fs from 'node:fs';
import { resolveProjectPath, loadConfig } from '../../core/config.js';
import { isBusy, injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('context-watchdog');

const STALE_SECONDS = 300; // Ignore data older than 5 minutes

let reminderSentForSession: string | null = null;

async function run(): Promise<void> {
  const stateFile = resolveProjectPath('.claude', 'state', 'context-usage.json');

  if (!fs.existsSync(stateFile)) return;

  // Check freshness
  const stats = fs.statSync(stateFile);
  const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
  if (ageSeconds > STALE_SECONDS) return;

  // Parse context usage
  let data: { remaining_percentage?: number; used_percentage?: number; session_id?: string; timestamp?: number };
  try {
    data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return;
  }

  const remaining = data.remaining_percentage ?? 100;
  const used = data.used_percentage ?? 0;
  const sessionId = data.session_id ?? 'unknown';

  // Get threshold from scheduler config
  const config = loadConfig();
  const taskConfig = config.scheduler.tasks.find(t => t.name === 'context-watchdog');
  const threshold = (taskConfig?.config?.threshold_percent as number) ?? 35;

  if (remaining >= threshold) {
    // Context is healthy — reset reminder tracking if session changed or context recovered
    if (reminderSentForSession !== null && reminderSentForSession !== sessionId) {
      reminderSentForSession = null;
    }
    return;
  }

  log.info(`Context low: ${used}% used, ${remaining}% remaining (threshold: ${threshold}%)`);

  if (isBusy()) {
    // Claude is busy — send a reminder instead of skipping entirely
    if (reminderSentForSession === sessionId) {
      log.debug('Reminder already sent for this session, skipping');
      return;
    }

    log.info('Claude is busy — injecting context reminder');
    injectText(
      `[System] Context is at ${used}% used (${remaining}% remaining). ` +
      `Find a good stopping point, then /save-state and /clear.`,
    );
    reminderSentForSession = sessionId;
    return;
  }

  // Claude is idle — inject save-state + clear directly
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

  // Reset reminder tracking (session will change after clear)
  reminderSentForSession = null;
}

registerTask({ name: 'context-watchdog', run });
