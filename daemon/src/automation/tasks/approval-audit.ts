/**
 * Approval Audit — periodic review of 3rd-party sender approvals.
 *
 * Removes expired entries and notifies the primary with a summary
 * of active approvals for review.
 */

import { readState, type ThirdPartySendersState } from '../../core/access-control.js';
import { injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';
import fs from 'node:fs';
import { loadConfig, resolveProjectPath } from '../../core/config.js';

const log = createLogger('approval-audit');

async function run(): Promise<void> {
  const state = readState();

  if (state.approved.length === 0 && state.denied.length === 0 && state.blocked.length === 0) {
    log.debug('No 3rd party senders to audit');
    return;
  }

  const now = new Date();
  const expired: string[] = [];
  const active: string[] = [];

  // Check for expired approvals
  for (const sender of state.approved) {
    if (sender.expires && new Date(sender.expires) < now) {
      expired.push(`${sender.name} (${sender.channel}: ${sender.id}) — expired ${sender.expires}`);
    } else {
      const expiryNote = sender.expires
        ? `expires ${new Date(sender.expires).toLocaleDateString()}`
        : 'persistent';
      active.push(`${sender.name} (${sender.channel}: ${sender.id}) — ${expiryNote}, approved ${new Date(sender.approved_date).toLocaleDateString()}`);
    }
  }

  // Remove expired entries from approved list
  if (expired.length > 0) {
    const cleanedState: ThirdPartySendersState = {
      ...state,
      approved: state.approved.filter(
        s => !(s.expires && new Date(s.expires) < now),
      ),
    };

    const stateFile = resolveProjectPath(loadConfig().security.third_party_senders_file);
    fs.writeFileSync(stateFile, JSON.stringify(cleanedState, null, 2) + '\n', 'utf8');
    log.info(`Cleaned up ${expired.length} expired approval(s)`);
  }

  // Build summary
  const lines: string[] = ['[System] 3rd Party Approval Audit Summary:'];

  if (active.length > 0) {
    lines.push(`\nActive approvals (${active.length}):`);
    for (const a of active) {
      lines.push(`  - ${a}`);
    }
  }

  if (expired.length > 0) {
    lines.push(`\nExpired & removed (${expired.length}):`);
    for (const e of expired) {
      lines.push(`  - ${e}`);
    }
  }

  if (state.blocked.length > 0) {
    lines.push(`\nBlocked senders (${state.blocked.length}):`);
    for (const b of state.blocked) {
      lines.push(`  - ${b.name} (${b.channel}: ${b.id}) — blocked by ${b.blocked_by}: ${b.reason}`);
    }
  }

  lines.push('\nPlease review and let me know if any changes are needed.');

  const summary = lines.join('\n');
  injectText(summary);

  log.info(`Audit complete: ${active.length} active, ${expired.length} expired, ${state.blocked.length} blocked`);
}

registerTask({ name: 'approval-audit', run });
