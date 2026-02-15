/**
 * Outlook email provider — wraps the Python IMAP script for Outlook accounts.
 * Uses OAuth2 with automatic token refresh via MSAL.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createLogger } from '../../../core/logger.js';
import { getProjectDir } from '../../../core/config.js';
import type { EmailProvider, EmailMessage, SendOptions } from './index.js';

const execFileAsync = promisify(execFile);
const log = createLogger('email-outlook');

interface OutlookMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
  isRead: boolean;
  body?: string;
}

export class OutlookProvider implements EmailProvider {
  readonly name = 'outlook';

  private get scriptPath(): string {
    return path.join(getProjectDir(), 'scripts/email/outlook-imap.py');
  }

  isConfigured(): boolean {
    try {
      const result = execFileSync('security', [
        'find-generic-password', '-s', 'himalaya-cli',
        '-a', 'outlook-imap-oauth2-access-token', '-w',
      ], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
      return !!result.trim();
    } catch {
      return false;
    }
  }

  private async run(args: string[]): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync('python3', [this.scriptPath, '--json', ...args], {
        encoding: 'utf8',
        timeout: 30000,
      });
      if (stderr && !stderr.includes('Token auto-refreshed')) {
        log.debug('outlook-imap.py stderr', { stderr: stderr.trim() });
      }
      return stdout.trim();
    } catch (err: any) {
      const stderr = err.stderr || '';
      throw new Error(`outlook ${args[0]} failed: ${stderr || err.message}`);
    }
  }

  private parseMessages(raw: string): OutlookMessage[] {
    if (!raw) return [];
    return JSON.parse(raw);
  }

  private toEmailMessage(msg: OutlookMessage): EmailMessage {
    return {
      id: msg.id,
      subject: msg.subject,
      from: msg.from,
      date: msg.date,
      isRead: msg.isRead,
      ...(msg.body ? { body: msg.body } : {}),
    };
  }

  async listInbox(limit = 10, unreadOnly = false): Promise<EmailMessage[]> {
    const cmd = unreadOnly ? 'unread' : 'inbox';
    const raw = await this.run([cmd]);
    return this.parseMessages(raw).slice(0, limit).map(m => this.toEmailMessage(m));
  }

  async readEmail(id: string): Promise<EmailMessage | null> {
    try {
      const raw = await this.run(['read', id]);
      const msg: OutlookMessage = JSON.parse(raw);
      return this.toEmailMessage(msg);
    } catch (err) {
      log.error(`Failed to read message ${id}`, { error: (err as Error).message });
      return null;
    }
  }

  async markAsRead(id: string): Promise<void> {
    // The read command auto-marks as read; for explicit marking use mark-read
    await this.run(['mark-read', id]);
  }

  async moveEmail(id: string, folder: string): Promise<void> {
    await this.run(['move', id, folder]);
  }

  async searchEmails(query: string, limit = 10): Promise<EmailMessage[]> {
    const raw = await this.run(['search', query]);
    return this.parseMessages(raw).slice(0, limit).map(m => this.toEmailMessage(m));
  }

  async sendEmail(_to: string, _subject: string, _body: string, _options?: SendOptions): Promise<void> {
    throw new Error('Outlook send not implemented — use M365 Graph API provider instead');
  }
}
