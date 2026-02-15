/**
 * Email Check with Smart Triage
 *
 * Checks unread emails across all providers and automatically sorts them:
 * - VIP senders → leave in inbox, notify via session
 * - Junk senders → move to Unsubscribe folder, mark read
 * - Newsletter senders → move to Newsletters folder, mark read
 * - Receipt senders → move to Receipts folder, mark read
 * - Security alerts → mark read, no notification
 * - Unknown senders → leave for manual review, include in notification
 *
 * Only notifies the session about emails that actually need attention.
 */

import { checkAllUnread, getEmailProviders } from '../../comms/adapters/email/index.js';
import type { EmailMessage, EmailProvider } from '../../comms/adapters/email/index.js';
import { injectText } from '../../core/session-bridge.js';
import { sendMessage as sendTelegram } from '../../comms/adapters/telegram.js';
import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('email-check');

interface TriageRules {
  vip: string[];
  junk: string[];
  newsletters: string[];
  receipts: string[];
  auto_read: string[];
}

/**
 * Load triage rules from cc4me.config.yaml (single source of truth).
 * Config is re-read each call so pattern changes take effect without restart.
 */
function loadTriageRules(): TriageRules {
  const appConfig = loadConfig();
  return appConfig.channels.email.triage ?? { vip: [], junk: [], newsletters: [], receipts: [], auto_read: [] };
}

interface TriageResult {
  vip: { provider: string; msg: EmailMessage }[];
  junk: number;
  newsletters: number;
  receipts: number;
  autoRead: number;
  unknown: { provider: string; msg: EmailMessage }[];
}

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(p => {
    // Support basic regex patterns (e.g., "maryland.*youth.*soccer")
    if (p.includes('*') || p.includes('(') || p.includes('[')) {
      try {
        return new RegExp(p, 'i').test(lower);
      } catch {
        return lower.includes(p.toLowerCase());
      }
    }
    return lower.includes(p.toLowerCase());
  });
}

async function triageEmail(
  provider: EmailProvider,
  msg: EmailMessage,
  config: { vip: string[]; junk: string[]; newsletters: string[]; receipts: string[]; auto_read: string[] },
): Promise<'vip' | 'junk' | 'newsletter' | 'receipt' | 'auto_read' | 'unknown'> {
  const text = `${msg.from} ${msg.subject}`;

  // VIP check first — these always stay in inbox
  if (matchesAny(text, config.vip)) return 'vip';

  // Junk — move to Unsubscribe
  if (matchesAny(text, config.junk)) return 'junk';

  // Newsletters — move to Newsletters
  if (matchesAny(text, config.newsletters)) return 'newsletter';

  // Receipts — move to Receipts
  if (matchesAny(text, config.receipts)) return 'receipt';

  // Security alerts — just mark read
  if (matchesAny(text, config.auto_read)) return 'auto_read';

  return 'unknown';
}

async function moveAndMark(provider: EmailProvider, id: string, folder: string): Promise<void> {
  try {
    if (provider.moveEmail) {
      await provider.moveEmail(id, folder);
    } else {
      // Fallback: just mark as read if provider doesn't support move
      await provider.markAsRead(id);
    }
  } catch (err) {
    log.warn(`Failed to move email ${id} to ${folder} on ${provider.name}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    // Still try to mark as read so it doesn't keep surfacing
    try { await provider.markAsRead(id); } catch { /* ignore */ }
  }
}

async function run(): Promise<void> {
  const appConfig = loadConfig();
  const triageEnabled = appConfig.channels.email.triage?.enabled;

  // If triage is disabled, fall back to the old behavior
  if (!triageEnabled) {
    return legacyCheck();
  }

  // Load triage rules fresh from file (no restart needed to update)
  const triageRules = loadTriageRules();

  const results = await checkAllUnread();
  const providers = getEmailProviders();
  const providerMap = new Map(providers.map(p => [p.name, p]));

  const triage: TriageResult = {
    vip: [], junk: 0, newsletters: 0, receipts: 0, autoRead: 0, unknown: [],
  };

  for (const result of results) {
    const provider = providerMap.get(result.provider);
    if (!provider) continue;

    for (const msg of result.messages) {
      const category = await triageEmail(provider, msg, triageRules);

      switch (category) {
        case 'vip':
          triage.vip.push({ provider: result.provider, msg });
          break;
        case 'junk':
          await moveAndMark(provider, msg.id, 'Unsubscribe');
          triage.junk++;
          break;
        case 'newsletter':
          await moveAndMark(provider, msg.id, 'Newsletters');
          triage.newsletters++;
          break;
        case 'receipt':
          await moveAndMark(provider, msg.id, 'Receipts');
          triage.receipts++;
          break;
        case 'auto_read':
          try { await provider.markAsRead(msg.id); } catch { /* ignore */ }
          triage.autoRead++;
          break;
        case 'unknown':
          triage.unknown.push({ provider: result.provider, msg });
          // Mark as read after first detection so it doesn't re-notify every cycle
          try { await provider.markAsRead(msg.id); } catch { /* ignore */ }
          break;
      }
    }
  }

  // Log triage results
  const sorted = triage.junk + triage.newsletters + triage.receipts + triage.autoRead;
  const important = triage.vip.length + triage.unknown.length;
  if (sorted > 0) {
    log.info(`Email triage: ${sorted} auto-sorted (${triage.junk} junk, ${triage.newsletters} newsletters, ${triage.receipts} receipts, ${triage.autoRead} auto-read)`);
  }

  // Only notify if there are VIP or unknown emails that need attention
  if (important === 0) {
    if (sorted > 0) {
      log.info('No emails requiring attention — all auto-sorted');
    } else {
      log.debug('No unread emails');
    }
    return;
  }

  // Build notification for VIP and unknown emails only
  const lines: string[] = [];

  if (triage.vip.length > 0) {
    lines.push(`**${triage.vip.length} important email(s):**`);
    for (const { provider, msg } of triage.vip) {
      lines.push(`  - [${provider}] ${msg.from}: ${msg.subject}`);
    }
  }

  if (triage.unknown.length > 0) {
    lines.push(`**${triage.unknown.length} email(s) from new/unknown senders:**`);
    for (const { provider, msg } of triage.unknown) {
      lines.push(`  - [${provider}] ${msg.from}: ${msg.subject}`);
    }
  }

  if (sorted > 0) {
    lines.push(`_(${sorted} other emails auto-sorted)_`);
  }

  const notification = `[System] Email triage complete:\n${lines.join('\n')}\n\nFor important emails: read them with /email read <account> <id> and notify the user if they need attention. For unknown senders: read the email content to categorize — if it's personal/important, flag for the user; if junk, mark as read.`;
  injectText(notification);

  // Send VIP emails directly to Telegram so the user gets notified even when away
  if (triage.vip.length > 0) {
    const vipLines = triage.vip.map(({ provider, msg }) =>
      `  ${msg.from}\n  ${msg.subject} [${provider}]`
    ).join('\n\n');
    sendTelegram(`[Email] ${triage.vip.length} important email(s):\n\n${vipLines}`);
  }
}

/** Legacy check for when triage is disabled */
async function legacyCheck(): Promise<void> {
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

  const reminder = `[System] You have ${totalUnread} unread email(s) (${detailStr}). Run /email check, read each unread email, and reply to any from approved senders in safe-senders.json. Be helpful and on-brand. Ignore spam or unknown senders. IMPORTANT: After reviewing, mark emails as read (use mark-all-read command on each provider script) so they don't keep showing up.`;
  injectText(reminder);
}

registerTask({ name: 'email-check', run });
