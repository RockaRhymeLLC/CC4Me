#!/usr/bin/env node

/**
 * Fastmail JMAP Email Client
 * Sends and reads email via JMAP API for a Fastmail account.
 *
 * Prerequisites:
 *   - Fastmail account with JMAP API token
 *   - Keychain entries:
 *     - credential-fastmail-email  (your Fastmail email address)
 *     - credential-fastmail-token  (JMAP API token from Fastmail settings)
 *
 * Usage:
 *   jmap.js inbox          - Show recent inbox messages
 *   jmap.js unread         - Show unread messages only
 *   jmap.js read <id>      - Read a specific email
 *   jmap.js mark-read <id>  - Mark an email as read
 *   jmap.js search "query" - Search emails
 *   jmap.js send "to" "subject" "body" [--cc addr] [--bcc addr] [attachment1] ...
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

const email = getCredential('credential-fastmail-email');
const token = getCredential('credential-fastmail-token');

if (!email) {
  console.error('ERROR: No Fastmail email address found in Keychain.');
  console.error('Store it: security add-generic-password -a "assistant" -s "credential-fastmail-email" -w "your@fastmail.com" -U');
  process.exit(1);
}

if (!token) {
  console.error('ERROR: No Fastmail API token found in Keychain.');
  console.error('Create one at: https://app.fastmail.com/settings/security/tokens');
  console.error('Then store: security add-generic-password -a "assistant" -s "credential-fastmail-token" -w "YOUR_TOKEN" -U');
  process.exit(1);
}

const hostname = 'api.fastmail.com';
const authUrl = `https://${hostname}/.well-known/jmap`;
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`,
};

// Get JMAP session
async function getSession() {
  const response = await fetch(authUrl, { method: 'GET', headers });
  if (!response.ok) throw new Error(`Session failed: ${response.status}`);
  return response.json();
}

// Make JMAP request
async function jmapRequest(apiUrl, accountId, methodCalls) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission'],
      methodCalls,
    }),
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

// Get inbox ID
async function getInboxId(apiUrl, accountId) {
  const data = await jmapRequest(apiUrl, accountId, [
    ['Mailbox/query', { accountId, filter: { role: 'inbox' } }, 'a'],
  ]);
  return data.methodResponses[0][1].ids[0];
}

// List inbox emails
async function listInbox(limit = 10, unreadOnly = false) {
  const session = await getSession();
  const apiUrl = session.apiUrl;
  const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
  const inboxId = await getInboxId(apiUrl, accountId);

  const filter = { inMailbox: inboxId };
  if (unreadOnly) filter.notKeyword = '$seen';

  const data = await jmapRequest(apiUrl, accountId, [
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

  const queryResult = data.methodResponses[0][1];
  if (!queryResult.ids || queryResult.ids.length === 0) return [];

  const emails = data.methodResponses[1][1].list;
  return emails;
}

// Read single email
async function readEmail(emailId) {
  const session = await getSession();
  const apiUrl = session.apiUrl;
  const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];

  const data = await jmapRequest(apiUrl, accountId, [
    ['Email/get', {
      accountId,
      ids: [emailId],
      properties: ['id', 'subject', 'from', 'to', 'receivedAt', 'keywords', 'textBody', 'bodyValues'],
      fetchTextBodyValues: true,
    }, 'a'],
  ]);

  return { email: data.methodResponses[0][1].list[0], apiUrl, accountId };
}

// Mark email as read
async function markAsRead(apiUrl, accountId, emailId) {
  return jmapRequest(apiUrl, accountId, [
    ['Email/set', {
      accountId,
      update: { [emailId]: { 'keywords/$seen': true } },
    }, 'a'],
  ]);
}

// Search emails
async function searchEmails(query, limit = 10) {
  const session = await getSession();
  const apiUrl = session.apiUrl;
  const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];

  const data = await jmapRequest(apiUrl, accountId, [
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

  return data.methodResponses[1][1].list;
}

// Upload a blob (for attachments)
async function uploadBlob(uploadUrl, accountId, filePath) {
  const fileData = fs.readFileSync(filePath);
  const url = uploadUrl.replace('{accountId}', accountId);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
    },
    body: fileData,
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  return response.json();
}

// MIME type lookup for common attachment types
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
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
  return types[ext] || 'application/octet-stream';
}

// Send email (with optional attachments)
async function sendEmail(to, subject, body, attachmentPaths = [], cc = [], bcc = []) {
  const session = await getSession();
  const apiUrl = session.apiUrl;
  const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];

  // Get drafts/sent mailbox IDs and identity
  const setupData = await jmapRequest(apiUrl, accountId, [
    ['Mailbox/query', { accountId, filter: { role: 'drafts' } }, 'drafts'],
    ['Mailbox/query', { accountId, filter: { role: 'sent' } }, 'sent'],
    ['Identity/get', { accountId }, 'id'],
  ]);
  const draftsMailboxId = setupData.methodResponses[0][1].ids[0];
  const sentMailboxId = setupData.methodResponses[1][1].ids[0];
  const identities = setupData.methodResponses[2][1].list;
  const identity = identities.find(i => i.email === email) || identities[0];
  const identityId = identity.id;

  // Upload attachments if any
  const attachments = [];
  for (const filePath of attachmentPaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Attachment not found: ${filePath}`);
    }
    console.log(`Uploading: ${path.basename(filePath)}...`);
    const blob = await uploadBlob(session.uploadUrl, accountId, filePath);
    attachments.push({
      blobId: blob.blobId,
      type: getMimeType(filePath),
      name: path.basename(filePath),
      size: fs.statSync(filePath).size,
    });
  }

  // Build the email object
  const draft = {
    mailboxIds: { [draftsMailboxId]: true },
    from: [{ email }],
    to: [{ email: to }],
    ...(cc.length > 0 ? { cc: cc.map(addr => ({ email: addr })) } : {}),
    ...(bcc.length > 0 ? { bcc: bcc.map(addr => ({ email: addr })) } : {}),
    subject,
    keywords: { '$draft': true },
    textBody: [{ partId: 'body', type: 'text/plain' }],
    bodyValues: { 'body': { value: body } },
  };

  if (attachments.length > 0) {
    draft.attachments = attachments;
  }

  // Build the onSuccessUpdateEmail patch object
  const updatePatch = {};
  updatePatch['mailboxIds/' + draftsMailboxId] = null;
  updatePatch['mailboxIds/' + sentMailboxId] = true;
  updatePatch['keywords/$draft'] = null;

  // Create draft AND submit in single request (chained)
  const sendData = await jmapRequest(apiUrl, accountId, [
    ['Email/set', {
      accountId,
      create: { draft },
    }, '0'],
    ['EmailSubmission/set', {
      accountId,
      create: {
        sendIt: {
          emailId: '#draft',
          identityId,
        },
      },
      onSuccessUpdateEmail: {
        '#sendIt': updatePatch,
      },
    }, '1'],
  ]);

  // Check for errors
  const emailResponse = sendData.methodResponses[0][1];
  if (!emailResponse.created?.draft) {
    console.error('Failed to create email:', JSON.stringify(emailResponse, null, 2));
    throw new Error('Email creation failed');
  }

  const submitResponse = sendData.methodResponses[1][1];
  if (!submitResponse.created?.sendIt) {
    console.error('Failed to submit:', JSON.stringify(submitResponse, null, 2));
    throw new Error('Email submission failed');
  }

  return sendData;
}

// Format email for display
function formatEmail(email, index = null) {
  const unread = !email.keywords || !email.keywords['$seen'];
  const from = email.from?.[0]?.email || 'unknown';
  const date = new Date(email.receivedAt).toLocaleString();
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
        if (!emailId) { console.error('Usage: jmap.js read <email_id>'); process.exit(1); }
        const { email: msg, apiUrl, accountId } = await readEmail(emailId);
        const unread = !msg.keywords || !msg.keywords['$seen'];
        if (unread) await markAsRead(apiUrl, accountId, emailId);
        console.log('## Email\n');
        console.log(`From: ${msg.from?.[0]?.email}`);
        console.log(`To: ${msg.to?.[0]?.email}`);
        console.log(`Subject: ${msg.subject}`);
        console.log(`Date: ${new Date(msg.receivedAt).toLocaleString()}`);
        console.log('\n---\n');
        const bodyPart = msg.textBody?.[0];
        if (bodyPart && msg.bodyValues?.[bodyPart.partId]) {
          console.log(msg.bodyValues[bodyPart.partId].value);
        } else {
          console.log('(no text body)');
        }
        break;
      }

      case 'mark-read': {
        const emailId = args[0];
        if (!emailId) { console.error('Usage: jmap.js mark-read <email_id>'); process.exit(1); }
        const session = await getSession();
        const apiUrl = session.apiUrl;
        const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
        await markAsRead(apiUrl, accountId, emailId);
        console.log('✅ Marked as read');
        break;
      }

      case 'search': {
        const query = args[0];
        if (!query) { console.error('Usage: jmap.js search "query"'); process.exit(1); }
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
        if (!to || !subject || !body) { console.error('Usage: jmap.js send "to" "subject" "body" [--cc addr] [--bcc addr] [attachment1] ...'); process.exit(1); }
        await sendEmail(to, subject, body, attachments, ccAddresses, bccAddresses);
        const attachNote = attachments.length > 0 ? ` with ${attachments.length} attachment(s)` : '';
        const ccNote = ccAddresses.length > 0 ? ` (cc: ${ccAddresses.join(', ')})` : '';
        const bccNote = bccAddresses.length > 0 ? ` (bcc: ${bccAddresses.length} recipient(s))` : '';
        console.log(`Email sent to ${to}${ccNote}${bccNote}${attachNote}`);
        break;
      }

      default:
        console.log('Usage: jmap.js <command> [args]');
        console.log('Commands: inbox, unread, read <id>, mark-read <id>, search "query", send "to" "subject" "body"');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
