/**
 * Context Watchdog — monitors context usage with escalating warnings.
 *
 * Three tiers of alerts as context fills up:
 * - 50% used → gentle heads-up
 * - 65% used → firmer nudge to wrap up
 * - 80% used → urgent, restart now
 *
 * Each tier fires once per session. BMO decides when to act.
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../../core/config.js';
import { injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('context-watchdog');

const STALE_SECONDS = 600; // Ignore data older than 10 minutes

interface Tier {
  threshold: number; // used percentage to trigger
  message: (used: number, remaining: number) => string;
}

const TIERS: Tier[] = [
  {
    threshold: 50,
    message: (used, remaining) =>
      `[System] Context at ${used}% used (${remaining}% remaining). Start thinking about a good save point.`,
  },
  {
    threshold: 65,
    message: (used, remaining) =>
      `[System] Context at ${used}% used (${remaining}% remaining). Wrap up your current task soon.`,
  },
  {
    threshold: 80,
    // At 80%, inject the save-state command directly — don't just warn
    message: (used, remaining) =>
      `/save-state "Auto-save: context at ${used}% (${remaining}% remaining)"`,
  },
  {
    threshold: 90,
    // At 90%, force a restart — state should already be saved from 80% tier
    // Using /restart instead of /clear (which has issues)
    message: () => `/restart`,
  },
];

// Track which tiers have fired for the current session
let firedTiers: Set<number> = new Set();
let currentSessionId: string | null = null;

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

  // New session — reset tracking
  if (sessionId !== currentSessionId) {
    firedTiers = new Set();
    currentSessionId = sessionId;
  }

  // Find the highest tier we've crossed that hasn't fired yet
  for (const tier of TIERS) {
    if (used >= tier.threshold && !firedTiers.has(tier.threshold)) {
      log.info(`Context ${used}% used — firing tier ${tier.threshold}%`);
      injectText(tier.message(used, remaining));
      firedTiers.add(tier.threshold);
    }
  }
}

registerTask({ name: 'context-watchdog', run });
