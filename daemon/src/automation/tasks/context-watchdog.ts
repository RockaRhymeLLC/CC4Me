/**
 * Context Watchdog — monitors context usage with escalating actions.
 *
 * Four tiers as context fills up:
 * - 50% used → gentle heads-up
 * - 65% used → auto /save-state (save early!)
 * - 80% used → auto /restart (only if 65% already fired in a PREVIOUS run)
 * - 90% used → emergency fallback if restart didn't happen
 *
 * Each tier fires once per session. The 80%/90% tiers have a safety gate to
 * prevent race conditions where save and restart fire in the same loop.
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
    // At 65%, auto-save — gives plenty of buffer before restart
    message: (used, remaining) =>
      `/save-state "Auto-save: context at ${used}% (${remaining}% remaining)"`,
  },
  {
    threshold: 80,
    // At 80%, restart — state should already be saved from 65% tier
    message: () => `/restart`,
  },
  {
    threshold: 90,
    // Emergency fallback if restart didn't happen at 80%
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

  // Capture which tiers had already fired BEFORE this loop iteration
  // This prevents the race condition where 80% and 90% both fire in the same run
  const previouslyFired = new Set(firedTiers);

  // Process tiers
  for (const tier of TIERS) {
    if (used >= tier.threshold && !firedTiers.has(tier.threshold)) {
      // Special gate for restart tiers (80%, 90%): only fire if 65% (save-state)
      // already fired in a PREVIOUS run. This ensures state is saved before restart.
      if ((tier.threshold === 80 || tier.threshold === 90) && !previouslyFired.has(65)) {
        log.info(`Context ${used}% — skipping ${tier.threshold}% tier (65% save hasn't fired in a previous run yet)`);
        continue;
      }

      log.info(`Context ${used}% used — firing tier ${tier.threshold}%`);
      injectText(tier.message(used, remaining));
      firedTiers.add(tier.threshold);
    }
  }
}

registerTask({ name: 'context-watchdog', run });
