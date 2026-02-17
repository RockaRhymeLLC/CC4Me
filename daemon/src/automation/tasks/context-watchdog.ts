/**
 * Context Watchdog — monitors context usage with escalating actions.
 *
 * Two tiers:
 * - 50% used → gentle heads-up ("start wrapping up")
 * - 65% used → auto /restart (which saves state first, then restarts)
 *
 * /save-state and /restart are always paired — there's no reason to save
 * without restarting (context is full), and no reason to restart without
 * saving (lose context). The /restart skill handles both.
 *
 * Each tier fires once per session.
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
      `[System] Context at ${used}% used (${remaining}% remaining). Start wrapping up your current task.`,
  },
  {
    threshold: 65,
    // /restart saves state first, then creates restart flag for the watcher.
    // One command, both steps, no gap.
    message: (used, remaining) =>
      `[System] Context at ${used}% used (${remaining}% remaining). Run /restart now.`,
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

  // Process tiers
  for (const tier of TIERS) {
    if (used >= tier.threshold && !firedTiers.has(tier.threshold)) {
      log.info(`Context ${used}% used — firing tier ${tier.threshold}%`);
      injectText(tier.message(used, remaining));
      firedTiers.add(tier.threshold);
    }
  }
}

registerTask({ name: 'context-watchdog', run });
