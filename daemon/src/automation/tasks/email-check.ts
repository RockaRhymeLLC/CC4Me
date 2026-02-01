/**
 * Email Check — checks for unread emails and prompts Claude to reply.
 *
 * Replaces: email-reminder.sh + com.bmo.email-reminder launchd job
 *
 * Uses the unified email providers instead of shelling out to graph.js/jmap.js.
 */

import { checkAllUnread } from '../../comms/adapters/email/index.js';
import { injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('email-check');

async function run(): Promise<void> {
  const results = await checkAllUnread();

  let totalUnread = 0;
  const details: string[] = [];

  for (const result of results) {
    if (result.messages.length > 0) {
      totalUnread += result.messages.length;
      details.push(`${result.messages.length} on ${result.provider}`);
    }
  }

  if (totalUnread === 0) {
    log.debug('No unread emails');
    return;
  }

  const detailStr = details.join(', ');
  log.info(`${totalUnread} unread email(s) (${detailStr})`);

  const reminder = `[System] You have ${totalUnread} unread email(s) (${detailStr}). Run /email check, read each unread email, and reply to any from approved senders in safe-senders.json. Be helpful and on-brand. Ignore spam or unknown senders.`;
  injectText(reminder);
}

registerTask({ name: 'email-check', run });
