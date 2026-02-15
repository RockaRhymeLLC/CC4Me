/**
 * Unified email interface — dispatches to Graph or JMAP provider.
 */

import { loadConfig } from '../../../core/config.js';
import { createLogger } from '../../../core/logger.js';
import { GraphProvider } from './graph-provider.js';
import { HimalayaProvider } from './himalaya-provider.js';
import { JmapProvider } from './jmap-provider.js';
import { OutlookProvider } from './outlook-provider.js';

const log = createLogger('email');

export interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  isRead: boolean;
  preview?: string;
  body?: string;
}

export interface EmailProvider {
  name: string;
  isConfigured(): boolean;
  listInbox(limit?: number, unreadOnly?: boolean): Promise<EmailMessage[]>;
  readEmail(id: string): Promise<EmailMessage | null>;
  markAsRead(id: string): Promise<void>;
  moveEmail?(id: string, folder: string): Promise<void>;
  searchEmails(query: string, limit?: number): Promise<EmailMessage[]>;
  sendEmail(to: string, subject: string, body: string, options?: SendOptions): Promise<void>;
}

export interface SendOptions {
  cc?: string[];
  bcc?: string[];
  attachments?: string[];
}

let _providers: EmailProvider[] | null = null;

/**
 * Get all configured and available email providers.
 */
export function getEmailProviders(): EmailProvider[] {
  if (_providers) return _providers;

  const config = loadConfig();
  _providers = [];

  for (const providerConfig of config.channels.email.providers) {
    let provider: EmailProvider;

    switch (providerConfig.type) {
      case 'graph':
        provider = new GraphProvider();
        break;
      case 'jmap':
        provider = new JmapProvider();
        break;
      case 'himalaya':
        provider = new HimalayaProvider(providerConfig.account ?? 'gmail');
        break;
      case 'outlook':
        provider = new OutlookProvider();
        break;
      default:
        log.warn(`Unknown email provider type: ${providerConfig.type}`);
        continue;
    }

    if (provider.isConfigured()) {
      _providers.push(provider);
      log.info(`Email provider enabled: ${provider.name}`);
    } else {
      log.warn(`Email provider ${provider.name} not configured (missing credentials)`);
    }
  }

  return _providers;
}

/**
 * Get the primary email provider (first configured one).
 */
export function getPrimaryProvider(): EmailProvider | null {
  const providers = getEmailProviders();
  return providers[0] ?? null;
}

/**
 * Check all providers for unread emails.
 */
export async function checkAllUnread(): Promise<{ provider: string; messages: EmailMessage[] }[]> {
  const results: { provider: string; messages: EmailMessage[] }[] = [];

  for (const provider of getEmailProviders()) {
    try {
      const messages = await provider.listInbox(10, true);
      results.push({ provider: provider.name, messages });
    } catch (err) {
      log.error(`Failed to check ${provider.name} unread`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
