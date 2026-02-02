/**
 * Fastmail JMAP email provider.
 * Port of scripts/email/jmap.js to TypeScript with shared keychain access.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getFastmailCredentials } from '../../../core/keychain.js';
import { createLogger } from '../../../core/logger.js';
import type { EmailProvider, EmailMessage, SendOptions } from './index.js';

const log = createLogger('email-jmap');

interface JmapSession {
  apiUrl: string;
  uploadUrl: string;
  primaryAccounts: Record<string, string>;
}

export class JmapProvider implements EmailProvider {
  readonly name = 'jmap';

  private get headers() {
    const creds = getFastmailCredentials();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.token}`,
    };
  }

  isConfigured(): boolean {
    const creds = getFastmailCredentials();
    return !!(creds.token);
  }

  private async getSession(): Promise<JmapSession> {
    const response = await fetch('https://api.fastmail.com/.well-known/jmap', {
      method: 'GET',
      headers: this.headers,
    });
    if (!response.ok) throw new Error(`JMAP session failed: ${response.status}`);
    return response.json() as Promise<JmapSession>;
  }

  private async jmapRequest(apiUrl: string, accountId: string, methodCalls: unknown[][]): Promise<{ methodResponses: unknown[][] }> {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission'],
        methodCalls,
      }),
    });
    if (!response.ok) throw new Error(`JMAP request failed: ${response.status}`);
    return response.json() as Promise<{ methodResponses: unknown[][] }>;
  }

  private async getInboxId(apiUrl: string, accountId: string): Promise<string> {
    const data = await this.jmapRequest(apiUrl, accountId, [
      ['Mailbox/query', { accountId, filter: { role: 'inbox' } }, 'a'],
    ]);
    return (data.methodResponses[0]![1] as { ids: string[] }).ids[0]!;
  }

  async listInbox(limit = 10, unreadOnly = false): Promise<EmailMessage[]> {
    const session = await this.getSession();
    const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail']!;
    const inboxId = await this.getInboxId(session.apiUrl, accountId);

    const filter: Record<string, unknown> = { inMailbox: inboxId };
    if (unreadOnly) filter.notKeyword = '$seen';

    const data = await this.jmapRequest(session.apiUrl, accountId, [
      ['Email/query', {
        accountId,
        filter,
        sort: [{ property: 'receivedAt', isAscending: false }],
        limit,
      }, 'a'],
      ['Email/get', {
        accountId,
        properties: ['id', 'subject', 'from', 'receivedAt', 'keywords', 'preview'],
        '#ids': { resultOf: 'a', name: 'Email/query', path: '/ids/*' },
      }, 'b'],
    ]);

    const queryResult = data.methodResponses[0]![1] as { ids: string[] };
    if (!queryResult.ids?.length) return [];

    const emails = (data.methodResponses[1]![1] as { list: Array<{
      id: string;
      subject: string;
      from: Array<{ email: string }>;
      receivedAt: string;
      keywords: Record<string, boolean>;
      preview?: string;
    }> }).list;

    return (emails ?? []).map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from?.[0]?.email ?? 'unknown',
      date: e.receivedAt,
      isRead: !!e.keywords?.['$seen'],
      preview: e.preview,
    }));
  }

  async readEmail(id: string): Promise<EmailMessage | null> {
    const session = await this.getSession();
    const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail']!;

    const data = await this.jmapRequest(session.apiUrl, accountId, [
      ['Email/get', {
        accountId,
        ids: [id],
        properties: ['id', 'subject', 'from', 'to', 'receivedAt', 'keywords', 'textBody', 'bodyValues'],
        fetchTextBodyValues: true,
      }, 'a'],
    ]);

    const e = (data.methodResponses[0]![1] as { list: Array<{
      id: string;
      subject: string;
      from: Array<{ email: string }>;
      receivedAt: string;
      keywords: Record<string, boolean>;
      textBody: Array<{ partId: string }>;
      bodyValues: Record<string, { value: string }>;
    }> }).list[0];

    if (!e) return null;

    const bodyPart = e.textBody?.[0];
    const body = bodyPart && e.bodyValues?.[bodyPart.partId]
      ? e.bodyValues[bodyPart.partId]!.value
      : '';

    return {
      id: e.id,
      subject: e.subject,
      from: e.from?.[0]?.email ?? 'unknown',
      date: e.receivedAt,
      isRead: !!e.keywords?.['$seen'],
      body,
    };
  }

  async markAsRead(id: string): Promise<void> {
    const session = await this.getSession();
    const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail']!;

    await this.jmapRequest(session.apiUrl, accountId, [
      ['Email/set', {
        accountId,
        update: { [id]: { 'keywords/$seen': true } },
      }, 'a'],
    ]);
  }

  async searchEmails(query: string, limit = 10): Promise<EmailMessage[]> {
    const session = await this.getSession();
    const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail']!;

    const data = await this.jmapRequest(session.apiUrl, accountId, [
      ['Email/query', {
        accountId,
        filter: { text: query },
        sort: [{ property: 'receivedAt', isAscending: false }],
        limit,
      }, 'a'],
      ['Email/get', {
        accountId,
        properties: ['id', 'subject', 'from', 'receivedAt', 'preview'],
        '#ids': { resultOf: 'a', name: 'Email/query', path: '/ids/*' },
      }, 'b'],
    ]);

    const emails = (data.methodResponses[1]![1] as { list: Array<{
      id: string;
      subject: string;
      from: Array<{ email: string }>;
      receivedAt: string;
      preview?: string;
    }> }).list;

    return (emails ?? []).map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from?.[0]?.email ?? 'unknown',
      date: e.receivedAt,
      isRead: true,
      preview: e.preview,
    }));
  }

  async sendEmail(to: string, subject: string, body: string, options?: SendOptions): Promise<void> {
    const session = await this.getSession();
    const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail']!;
    const creds = getFastmailCredentials();

    // Get drafts/sent mailbox IDs and identity
    const setupData = await this.jmapRequest(session.apiUrl, accountId, [
      ['Mailbox/query', { accountId, filter: { role: 'drafts' } }, 'drafts'],
      ['Mailbox/query', { accountId, filter: { role: 'sent' } }, 'sent'],
      ['Identity/get', { accountId }, 'id'],
    ]);

    const draftsId = (setupData.methodResponses[0]![1] as { ids: string[] }).ids[0]!;
    const sentId = (setupData.methodResponses[1]![1] as { ids: string[] }).ids[0]!;
    const identities = (setupData.methodResponses[2]![1] as { list: Array<{ id: string; email: string }> }).list;
    const identity = identities.find(i => i.email === creds.email) ?? identities[0]!;

    // Upload attachments
    const attachments: Array<{ blobId: string; type: string; name: string; size: number }> = [];
    if (options?.attachments?.length) {
      for (const filePath of options.attachments) {
        if (!fs.existsSync(filePath)) throw new Error(`Attachment not found: ${filePath}`);
        const fileData = fs.readFileSync(filePath);
        const url = session.uploadUrl.replace('{accountId}', accountId);
        const uploadResp = await fetch(url, {
          method: 'POST',
          headers: { ...this.headers, 'Content-Type': 'application/octet-stream' },
          body: fileData,
        });
        if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
        const blob = await uploadResp.json() as { blobId: string };
        attachments.push({
          blobId: blob.blobId,
          type: getMimeType(filePath),
          name: path.basename(filePath),
          size: fs.statSync(filePath).size,
        });
      }
    }

    // Build draft email
    const draft: Record<string, unknown> = {
      mailboxIds: { [draftsId]: true },
      from: [{ email: creds.email }],
      to: [{ email: to }],
      subject,
      keywords: { '$draft': true },
      textBody: [{ partId: 'body', type: 'text/plain' }],
      bodyValues: { body: { value: body } },
    };

    if (options?.cc?.length) draft.cc = options.cc.map(addr => ({ email: addr }));
    if (options?.bcc?.length) draft.bcc = options.bcc.map(addr => ({ email: addr }));
    if (attachments.length) draft.attachments = attachments;

    // Build move-to-sent patch
    const updatePatch: Record<string, unknown> = {};
    updatePatch[`mailboxIds/${draftsId}`] = null;
    updatePatch[`mailboxIds/${sentId}`] = true;
    updatePatch['keywords/$draft'] = null;

    // Create + submit in one request
    const sendData = await this.jmapRequest(session.apiUrl, accountId, [
      ['Email/set', { accountId, create: { draft } }, '0'],
      ['EmailSubmission/set', {
        accountId,
        create: { sendIt: { emailId: '#draft', identityId: identity.id } },
        onSuccessUpdateEmail: { '#sendIt': updatePatch },
      }, '1'],
    ]);

    const emailResult = sendData.methodResponses[0]![1] as { created?: { draft?: unknown } };
    if (!emailResult.created?.draft) {
      throw new Error('JMAP email creation failed');
    }

    const submitResult = sendData.methodResponses[1]![1] as { created?: { sendIt?: unknown } };
    if (!submitResult.created?.sendIt) {
      throw new Error('JMAP email submission failed');
    }

    log.info(`Email sent via JMAP to ${to}`);
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.md': 'text/markdown',
  };
  return types[ext] ?? 'application/octet-stream';
}
