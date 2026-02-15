/**
 * Himalaya email provider — wraps the Himalaya CLI for personal email accounts.
 * Supports Gmail (IMAP via app password) and Outlook (IMAP via OAuth2).
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../../../core/logger.js';
import type { EmailProvider, EmailMessage, SendOptions } from './index.js';

const execFileAsync = promisify(execFile);
const log = createLogger('email-himalaya');

const HIMALAYA_BIN = '/opt/homebrew/bin/himalaya';

interface HimalayaEnvelope {
  id: string;
  flags: string[];
  subject: string;
  from: { name: string | null; addr: string };
  to: { name: string | null; addr: string };
  date: string;
  has_attachment: boolean;
}

export class HimalayaProvider implements EmailProvider {
  readonly name: string;
  private readonly account: string;

  constructor(account = 'gmail') {
    this.account = account;
    this.name = `himalaya-${account}`;
  }

  isConfigured(): boolean {
    try {
      execFileSync(HIMALAYA_BIN, ['account', 'list'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  private async run(args: string[], { json = true, input }: { json?: boolean; input?: string } = {}): Promise<string> {
    const fullArgs = json ? ['-o', 'json', ...args] : args;
    try {
      const { stdout } = await execFileAsync(HIMALAYA_BIN, fullArgs, {
        encoding: 'utf8',
        timeout: 30000,
        ...(input ? { input } : {}),
      });
      // Filter WARN lines from imap_codec
      return stdout
        .split('\n')
        .filter(l => !l.includes(' WARN '))
        .join('\n')
        .trim();
    } catch (err: any) {
      const stderr = err.stderr || '';
      throw new Error(`himalaya ${args[0]} failed: ${stderr || err.message}`);
    }
  }

  private parseEnvelopes(raw: string): HimalayaEnvelope[] {
    if (!raw) return [];
    return JSON.parse(raw);
  }

  private envelopeToMessage(env: HimalayaEnvelope): EmailMessage {
    return {
      id: env.id,
      subject: env.subject,
      from: env.from?.name ? `${env.from.name} <${env.from.addr}>` : (env.from?.addr || 'unknown'),
      date: env.date,
      isRead: env.flags?.includes('Seen') ?? false,
    };
  }

  async listInbox(limit = 10, unreadOnly = false): Promise<EmailMessage[]> {
    const args = ['envelope', 'list', '-a', this.account, '--page-size', String(limit)];
    if (unreadOnly) {
      args.push('not', 'flag', 'seen');
    }
    const raw = await this.run(args);
    return this.parseEnvelopes(raw).map(e => this.envelopeToMessage(e));
  }

  async readEmail(id: string): Promise<EmailMessage | null> {
    try {
      const body = await this.run(['message', 'read', '-a', this.account, id]);
      // Body is the full message text (includes headers)
      const bodyText = typeof body === 'string' ? body : JSON.parse(body);
      return {
        id,
        subject: '',
        from: '',
        date: '',
        isRead: true,
        body: bodyText,
      };
    } catch (err) {
      log.error(`Failed to read message ${id}`, { error: (err as Error).message });
      return null;
    }
  }

  async markAsRead(id: string): Promise<void> {
    await this.run(['flag', 'add', '-a', this.account, id, 'Seen'], { json: false });
  }

  async moveEmail(id: string, folder: string): Promise<void> {
    await this.run(['message', 'move', '-a', this.account, folder, '--', id], { json: false });
  }

  async searchEmails(query: string, limit = 10): Promise<EmailMessage[]> {
    const args = [
      'envelope', 'list', '-a', this.account,
      '--page-size', String(limit),
      'subject', query, 'or', 'from', query,
    ];
    const raw = await this.run(args);
    return this.parseEnvelopes(raw).map(e => this.envelopeToMessage(e));
  }

  async sendEmail(to: string, subject: string, body: string, options?: SendOptions): Promise<void> {
    // Build headers for template
    const headers = ['-H', `To:${to}`, '-H', `Subject:${subject}`];
    if (options?.cc) {
      for (const cc of options.cc) {
        headers.push('-H', `Cc:${cc}`);
      }
    }
    if (options?.bcc) {
      for (const bcc of options.bcc) {
        headers.push('-H', `Bcc:${bcc}`);
      }
    }

    // Generate template
    const template = await this.run(
      ['template', 'write', '-a', this.account, ...headers, body],
      { json: false },
    );

    // Send the message
    await this.run(
      ['message', 'send', '-a', this.account],
      { json: false, input: template },
    );

    log.info(`Email sent via ${this.name}`, { to, subject });
  }
}
