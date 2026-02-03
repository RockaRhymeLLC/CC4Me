/**
 * Context Watchdog — monitors context usage, nudges Claude to save + clear.
 *
 * Replaces: context-watchdog.sh + legacy launchd job
 *
 * When context drops below the configured threshold (default 35% remaining):
 * - Sets a flag file (.claude/state/context-save-pending) so the Stop hook
 *   can inject /save-state at the right moment (when Claude is idle)
 * - If Claude is busy: injects a reminder so Claude can find a good
 *   stopping point
 * - If Claude is idle: injects /save-state directly, then sets
 *   clear-pending for the Stop hook
 *
 * The Stop hook (notify-response.sh) checks for these flags after each
 * tool use or stop event and injects /save-state or /clear when Claude
 * is between operations — solving the problem of /clear getting queued
 * as a message when injected during a blocking tool call.
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

  // Flag file paths — Stop hook checks these
  const savePendingFlag = resolveProjectPath('.claude', 'state', 'context-save-pending');
  const clearPendingFlag = resolveProjectPath('.claude', 'state', 'context-clear-pending');

  if (remaining >= threshold) {
    // Context is healthy — reset reminder tracking and clean up any stale flags.
    if (reminderSentForSession !== null) {
      log.debug('Context healthy again — resetting reminder tracking');
      reminderSentForSession = null;
    }
    // Clean up flags if context recovered (e.g., manual /clear happened)
    if (fs.existsSync(savePendingFlag)) fs.unlinkSync(savePendingFlag);
    if (fs.existsSync(clearPendingFlag)) fs.unlinkSync(clearPendingFlag);
    return;
  }

  log.info(`Context low: ${used}% used, ${remaining}% remaining (threshold: ${threshold}%)`);

  // Check if flags are already set (previous watchdog run set them)
  if (fs.existsSync(savePendingFlag) || fs.existsSync(clearPendingFlag)) {
    log.debug('Save/clear flags already pending — waiting for Stop hook to process');
    return;
  }

  if (isBusy()) {
    // Claude is busy — set the save-pending flag for the Stop hook to pick up,
    // and inject a reminder so Claude knows context is low.
    if (reminderSentForSession === sessionId) {
      // Already sent reminder, just set the flag if not already set
      if (!fs.existsSync(savePendingFlag)) {
        fs.writeFileSync(savePendingFlag, JSON.stringify({ used, remaining, sessionId, timestamp: Date.now() }));
        log.info('Set save-pending flag for Stop hook');
      }
      return;
    }

    log.info('Claude is busy — setting save-pending flag and injecting reminder');
    fs.writeFileSync(savePendingFlag, JSON.stringify({ used, remaining, sessionId, timestamp: Date.now() }));
    injectText(
      `[System] Context is at ${used}% used (${remaining}% remaining). ` +
      `Find a good stopping point, then /save-state and /clear.`,
    );
    reminderSentForSession = sessionId;
    return;
  }

  // Claude is idle — inject save-state directly, then set clear-pending
  // for the Stop hook to pick up after save-state completes.
  log.info('Claude is idle — triggering /save-state and setting clear-pending flag');
  injectText(`/save-state "Auto-save: context at ${used}% used"`);

  // Set clear-pending flag — the Stop hook will inject /clear after
  // save-state completes (when the next Stop/PostToolUse fires).
  fs.writeFileSync(clearPendingFlag, JSON.stringify({ used, remaining, sessionId, timestamp: Date.now() }));

  // Reset reminder tracking (session will change after clear)
  reminderSentForSession = null;
}

registerTask({ name: 'context-watchdog', run });
