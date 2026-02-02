#!/usr/bin/env node

/**
 * Microsoft Graph Email Client
 * Sends and reads email via Microsoft Graph API.
 *
 * Prerequisites:
 *   - Azure AD app registration with Mail.ReadWrite, Mail.Send permissions
 *   - Keychain entries:
 *     - credential-azure-client-id      (Application/client ID)
 *     - credential-azure-tenant-id      (Directory/tenant ID)
 *     - credential-azure-secret-value   (Client secret)
 *     - credential-graph-user-email     (User email, e.g., user@yourdomain.com)
 *
 * Usage:
 *   graph.js inbox          - Show recent inbox messages
 *   graph.js unread         - Show unread messages only
 *   graph.js read <id>      - Read a specific email
 *   graph.js mark-read <id>  - Mark an email as read
 *   graph.js search "query" - Search emails
 *   graph.js send "to" "subject" "body" [--cc addr] [--bcc addr] [attachment1] ...
 *   graph.js mark-read <id>  - Mark an email as read
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get credentials from Keychain
function getCredential(name) {
  try {
    return execSync(`security find-generic-password -s "${name}" -w`, { encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

const clientId = getCredential('credential-azure-client-id');
const tenantId = getCredential('credential-azure-tenant-id');
const clientSecret = getCredential('credential-azure-secret-value');
const userEmail = getCredential('credential-graph-user-email');

if (!clientId || !tenantId || !clientSecret) {
  console.error('ERROR: Missing Azure credentials in Keychain.');
  console.error('Required: credential-azure-client-id, credential-azure-tenant-id, credential-azure-secret-value');
  console.error('Store them:');
  console.error('  security add-generic-password -a "assistant" -s "credential-azure-client-id" -w "YOUR_CLIENT_ID" -U');
  console.error('  security add-generic-password -a "assistant" -s "credential-azure-tenant-id" -w "YOUR_TENANT_ID" -U');
  console.error('  security add-generic-password -a "assistant" -s "credential-azure-secret-value" -w "YOUR_SECRET" -U');
  process.exit(1);
}

if (!userEmail) {
  console.error('ERROR: Missing user email in Keychain.');
  console.error('Store it: security add-generic-password -a "assistant" -s "credential-graph-user-email" -w "user@yourdomain.com" -U');
  process.exit(1);
}

// Get OAuth token
async function getToken() {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${encodeURIComponent(clientId)}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
  });
  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

// Make Graph API request
async function graphRequest(endpoint, options = {}) {
  const token = await getToken();
  const url = endpoint.startsWith('http') ? endpoint : `https://graph.microsoft.com/v1.0${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Graph API error ${response.status}: ${err.error?.message || response.statusText}`);
  }
  if (response.status === 204 || response.status === 202) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

// Upload attachment blob
async function uploadAttachment(filePath) {
  const fileData = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.doc': 'application/msword',
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
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: fileName,
    contentType: mimeTypes[ext] || 'application/octet-stream',
    contentBytes: fileData.toString('base64'),
  };
}

// List inbox emails
async function listInbox(limit = 10, unreadOnly = false) {
  let endpoint = `/users/${encodeURIComponent(userEmail)}/messages?$top=${limit}&$select=id,subject,from,receivedDateTime,isRead&$orderby=receivedDateTime desc`;
  if (unreadOnly) endpoint += `&$filter=isRead eq false`;
  const data = await graphRequest(endpoint);
  return data.value || [];
}

// Read single email
async function readEmail(emailId) {
  return graphRequest(`/users/${encodeURIComponent(userEmail)}/messages/${emailId}?$select=id,subject,from,toRecipients,receivedDateTime,body,isRead`);
}

// Mark email as read
async function markAsRead(emailId) {
  return graphRequest(`/users/${encodeURIComponent(userEmail)}/messages/${emailId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isRead: true }),
  });
}

// Search emails
async function searchEmails(query, limit = 10) {
  const endpoint = `/users/${encodeURIComponent(userEmail)}/messages?$top=${limit}&$search="${encodeURIComponent(query)}"&$select=id,subject,from,receivedDateTime,bodyPreview`;
  const data = await graphRequest(endpoint);
  return data.value || [];
}

// Send email (with optional attachments)
async function sendEmail(to, subject, body, attachmentPaths = [], cc = [], bcc = []) {
  const message = {
    subject,
    body: { contentType: 'Text', content: body },
    toRecipients: [{ emailAddress: { address: to } }],
    ...(cc.length > 0 ? { ccRecipients: cc.map(addr => ({ emailAddress: { address: addr } })) } : {}),
    ...(bcc.length > 0 ? { bccRecipients: bcc.map(addr => ({ emailAddress: { address: addr } })) } : {}),
  };

  if (attachmentPaths.length > 0) {
    message.attachments = [];
    for (const filePath of attachmentPaths) {
      if (!fs.existsSync(filePath)) throw new Error(`Attachment not found: ${filePath}`);
      console.log(`Attaching: ${path.basename(filePath)}...`);
      message.attachments.push(await uploadAttachment(filePath));
    }
  }

  await graphRequest(`/users/${encodeURIComponent(userEmail)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

// Format email for display
function formatEmail(email, index = null) {
  const unread = !email.isRead;
  const from = email.from?.emailAddress?.address || 'unknown';
  const date = new Date(email.receivedDateTime).toLocaleString();
  const prefix = index !== null ? `${index + 1}. ` : '';
  const unreadTag = unread ? '[UNREAD] ' : '';
  return `${prefix}${unreadTag}From: ${from}\n   Subject: ${email.subject}\n   Date: ${date}\n   ID: ${email.id}`;
}

// Main
async function main() {
  const [, , command, ...args] = process.argv;

  try {
    switch (command) {
      case 'inbox':
      case 'check': {
        const emails = await listInbox(10, false);
        console.log(`## Inbox (${emails.length} messages)\n`);
        emails.forEach((e, i) => console.log(formatEmail(e, i) + '\n'));
        break;
      }

      case 'unread': {
        const emails = await listInbox(10, true);
        console.log(`## Unread (${emails.length} messages)\n`);
        emails.forEach((e, i) => console.log(formatEmail(e, i) + '\n'));
        break;
      }

      case 'read': {
        const emailId = args[0];
        if (!emailId) { console.error('Usage: graph.js read <email_id>'); process.exit(1); }
        const email = await readEmail(emailId);
        if (!email.isRead) await markAsRead(emailId);
        console.log('## Email\n');
        console.log(`From: ${email.from?.emailAddress?.address}`);
        console.log(`To: ${email.toRecipients?.map(r => r.emailAddress.address).join(', ')}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Date: ${new Date(email.receivedDateTime).toLocaleString()}`);
        console.log('\n---\n');
        if (email.body?.content) {
          // Strip HTML tags for plain text display
          const text = email.body.contentType === 'html'
            ? email.body.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
            : email.body.content;
          console.log(text);
        } else {
          console.log('(no body)');
        }
        break;
      }

      case 'mark-read': {
        const emailId = args[0];
        if (!emailId) { console.error('Usage: graph.js mark-read <email_id>'); process.exit(1); }
        await markAsRead(emailId);
        console.log('✅ Marked as read');
        break;
      }

      case 'search': {
        const query = args[0];
        if (!query) { console.error('Usage: graph.js search "query"'); process.exit(1); }
        const emails = await searchEmails(query);
        console.log(`## Search: "${query}" (${emails.length} results)\n`);
        emails.forEach((e, i) => console.log(formatEmail(e, i) + '\n'));
        break;
      }

      case 'send': {
        // Parse --cc and --bcc flags from args
        const ccAddresses = [];
        const bccAddresses = [];
        const remaining = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--cc' && i + 1 < args.length) {
            ccAddresses.push(args[++i]);
          } else if (args[i] === '--bcc' && i + 1 < args.length) {
            bccAddresses.push(args[++i]);
          } else {
            remaining.push(args[i]);
          }
        }
        const [to, subject, body, ...attachments] = remaining;
        if (!to || !subject || !body) { console.error('Usage: graph.js send "to" "subject" "body" [--cc addr] [--bcc addr] [attachment1] ...'); process.exit(1); }
        await sendEmail(to, subject, body, attachments, ccAddresses, bccAddresses);
        const attachNote = attachments.length > 0 ? ` with ${attachments.length} attachment(s)` : '';
        const ccNote = ccAddresses.length > 0 ? ` (cc: ${ccAddresses.join(', ')})` : '';
        const bccNote = bccAddresses.length > 0 ? ` (bcc: ${bccAddresses.length} recipient(s))` : '';
        console.log(`Email sent from ${userEmail} to ${to}${ccNote}${bccNote}${attachNote}`);
        break;
      }

      default:
        console.log('Usage: graph.js <command> [args]');
        console.log('Commands: inbox, unread, read <id>, mark-read <id>, search "query", send "to" "subject" "body" [attachments...]');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
