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

const STALE_SECONDS = 600; // Ignore data older than 10 minutes

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
    // Context is healthy — reset reminder tracking.
    // Reset on session change OR context recovery (e.g. after /clear brought usage back down).
    if (reminderSentForSession !== null) {
      log.debug('Context healthy again — resetting reminder tracking');
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

  // Poll for save-state completion instead of fixed wait.
  // Check every 5s for up to 60s — save-state involves Claude writing a file,
  // so duration varies with context size.
  const MAX_WAIT_MS = 60_000;
  const POLL_INTERVAL_MS = 5_000;
  const startTime = Date.now();

  // Initial delay to let save-state begin processing
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

  while (isBusy() && (Date.now() - startTime) < MAX_WAIT_MS) {
    log.debug(`Save-state still running, waiting... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (isBusy()) {
    log.warn(`Save-state still busy after ${MAX_WAIT_MS / 1000}s — sending reminder instead of /clear`);
    injectText(
      `[System] Context is at ${used}% used (${remaining}% remaining). ` +
      `Save-state may still be running. Please /clear when ready.`,
    );
    reminderSentForSession = sessionId;
    return;
  }

  // Send /clear
  log.info('Sending /clear');
  injectText('/clear');

  // Reset reminder tracking (session will change after clear)
  reminderSentForSession = null;
}

registerTask({ name: 'context-watchdog', run });
