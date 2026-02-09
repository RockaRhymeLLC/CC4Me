/**
 * Context Watchdog — monitors context usage, reminds Claude to save + clear.
 *
 * When context drops below the configured threshold (default 35% remaining):
 * - Injects a reminder so Claude can save state and clear at a good stopping point
 * - Only sends one reminder per low-context episode to avoid spamming
 *
 * Claude is responsible for managing the save + clear cycle. This task
 * just provides the nudge.
 */

import fs from 'node:fs';
import { resolveProjectPath, loadConfig } from '../../core/config.js';
import { injectText } from '../../core/session-bridge.js';
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
  let data: { remaining_percentage?: number; used_percentage?: number; session_id?: string };
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
    // Context is healthy — reset reminder tracking
    if (reminderSentForSession !== null) {
      log.debug('Context healthy again — resetting reminder tracking');
      reminderSentForSession = null;
    }
    return;
  }

  // Already sent reminder for this session — don't spam
  if (reminderSentForSession === sessionId) {
    log.debug(`Already reminded for session ${sessionId}`);
    return;
  }

  log.info(`Context low: ${used}% used, ${remaining}% remaining (threshold: ${threshold}%)`);

  injectText(
    `[System] Context is at ${used}% used (${remaining}% remaining). ` +
    `Find a good stopping point, then /save-state and /clear.`,
  );
  reminderSentForSession = sessionId;
}

registerTask({ name: 'context-watchdog', run });
