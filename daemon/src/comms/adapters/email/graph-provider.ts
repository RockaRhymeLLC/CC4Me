/**
 * Microsoft Graph email provider — M365 email via Graph API.
 * Port of scripts/email/graph.js to TypeScript with shared keychain access.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getAzureCredentials } from '../../../core/keychain.js';
import { createLogger } from '../../../core/logger.js';
import type { EmailProvider, EmailMessage, SendOptions } from './index.js';

const log = createLogger('email-graph');

export class GraphProvider implements EmailProvider {
  readonly name = 'graph';

  private _tokenCache: { token: string; expiresAt: number } | null = null;

  isConfigured(): boolean {
    const creds = getAzureCredentials();
    return !!(creds.clientId && creds.tenantId && creds.clientSecret && creds.userEmail);
  }

  private async getToken(): Promise<string> {
    // Return cached token if still valid
    if (this._tokenCache && Date.now() < this._tokenCache.expiresAt) {
      return this._tokenCache.token;
    }

    const creds = getAzureCredentials();
    const response = await fetch(
      `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=${encodeURIComponent(creds.clientId!)}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&client_secret=${encodeURIComponent(creds.clientSecret!)}&grant_type=client_credentials`,
      },
    );

    if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
    const data = await response.json() as { access_token: string; expires_in: number };

    // Cache with 5 minute buffer
    this._tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };

    return data.access_token;
  }

  private async graphRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const url = endpoint.startsWith('http') ? endpoint : `https://graph.microsoft.com/v1.0${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(`Graph API ${response.status}: ${err.error?.message ?? response.statusText}`);
    }

    if (response.status === 204 || response.status === 202) return null as T;
    const text = await response.text();
    if (!text) return null as T;
    return JSON.parse(text) as T;
  }

  private get userPath(): string {
    const creds = getAzureCredentials();
    return `/users/${encodeURIComponent(creds.userEmail!)}`;
  }

  async listInbox(limit = 10, unreadOnly = false): Promise<EmailMessage[]> {
    let endpoint = `${this.userPath}/messages?$top=${limit}&$select=id,subject,from,receivedDateTime,isRead&$orderby=receivedDateTime desc`;
    if (unreadOnly) endpoint += `&$filter=isRead eq false`;

    const data = await this.graphRequest<{ value: Array<{
      id: string;
      subject: string;
      from: { emailAddress: { address: string } };
      receivedDateTime: string;
      isRead: boolean;
      bodyPreview?: string;
    }> }>(endpoint);

    return (data?.value ?? []).map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from?.emailAddress?.address ?? 'unknown',
      date: e.receivedDateTime,
      isRead: e.isRead,
    }));
  }

  async readEmail(id: string): Promise<EmailMessage | null> {
    const e = await this.graphRequest<{
      id: string;
      subject: string;
      from: { emailAddress: { address: string } };
      receivedDateTime: string;
      isRead: boolean;
      body: { contentType: string; content: string };
    }>(`${this.userPath}/messages/${id}?$select=id,subject,from,receivedDateTime,body,isRead`);

    if (!e) return null;

    let body = '';
    if (e.body?.content) {
      body = e.body.contentType === 'html'
        ? e.body.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
        : e.body.content;
    }

    return {
      id: e.id,
      subject: e.subject,
      from: e.from?.emailAddress?.address ?? 'unknown',
      date: e.receivedDateTime,
      isRead: e.isRead,
      body,
    };
  }

  async markAsRead(id: string): Promise<void> {
    await this.graphRequest(`${this.userPath}/messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead: true }),
    });
  }

  async searchEmails(query: string, limit = 10): Promise<EmailMessage[]> {
    const endpoint = `${this.userPath}/messages?$top=${limit}&$search="${encodeURIComponent(query)}"&$select=id,subject,from,receivedDateTime,bodyPreview`;
    const data = await this.graphRequest<{ value: Array<{
      id: string;
      subject: string;
      from: { emailAddress: { address: string } };
      receivedDateTime: string;
      bodyPreview?: string;
    }> }>(endpoint);

    return (data?.value ?? []).map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from?.emailAddress?.address ?? 'unknown',
      date: e.receivedDateTime,
      isRead: true,
      preview: e.bodyPreview,
    }));
  }

  async sendEmail(to: string, subject: string, body: string, options?: SendOptions): Promise<void> {
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    };

    if (options?.cc?.length) {
      message.ccRecipients = options.cc.map(addr => ({ emailAddress: { address: addr } }));
    }
    if (options?.bcc?.length) {
      message.bccRecipients = options.bcc.map(addr => ({ emailAddress: { address: addr } }));
    }

    if (options?.attachments?.length) {
      const attachments = [];
      for (const filePath of options.attachments) {
        if (!fs.existsSync(filePath)) throw new Error(`Attachment not found: ${filePath}`);
        const fileData = fs.readFileSync(filePath);
        attachments.push({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: path.basename(filePath),
          contentType: getMimeType(filePath),
          contentBytes: fileData.toString('base64'),
        });
      }
      message.attachments = attachments;
    }

    await this.graphRequest(`${this.userPath}/sendMail`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });

    log.info(`Email sent via Graph to ${to}`);
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
