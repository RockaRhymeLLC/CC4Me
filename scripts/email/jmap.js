#!/usr/bin/env node

const { execSync } = require('child_process');

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
  if (unreadOnly) filter.hasKeyword = { '$seen': false };

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
      properties: ['id', 'subject', 'from', 'to', 'receivedAt', 'textBody', 'bodyValues'],
      fetchTextBodyValues: true,
    }, 'a'],
  ]);

  return data.methodResponses[0][1].list[0];
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

// Send email
async function sendEmail(to, subject, body) {
  const session = await getSession();
  const apiUrl = session.apiUrl;
  const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
  const submissionAccountId = session.primaryAccounts['urn:ietf:params:jmap:submission'];

  // Create draft
  const draftData = await jmapRequest(apiUrl, accountId, [
    ['Email/set', {
      accountId,
      create: {
        draft: {
          from: [{ email }],
          to: [{ email: to }],
          subject,
          textBody: [{ partId: '1', type: 'text/plain' }],
          bodyValues: { '1': { value: body } },
        },
      },
    }, 'a'],
  ]);

  const emailId = draftData.methodResponses[0][1].created.draft.id;

  // Submit
  const submitData = await jmapRequest(apiUrl, accountId, [
    ['EmailSubmission/set', {
      accountId: submissionAccountId,
      create: {
        submission: {
          emailId,
          envelope: {
            mailFrom: { email },
            rcptTo: [{ email: to }],
          },
        },
      },
    }, 'a'],
  ]);

  return submitData;
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
        const email = await readEmail(emailId);
        console.log('## Email\n');
        console.log(`From: ${email.from?.[0]?.email}`);
        console.log(`To: ${email.to?.[0]?.email}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Date: ${new Date(email.receivedAt).toLocaleString()}`);
        console.log('\n---\n');
        const bodyPart = email.textBody?.[0];
        if (bodyPart && email.bodyValues?.[bodyPart.partId]) {
          console.log(email.bodyValues[bodyPart.partId].value);
        } else {
          console.log('(no text body)');
        }
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
        const [to, subject, body] = args;
        if (!to || !subject || !body) { console.error('Usage: jmap.js send "to" "subject" "body"'); process.exit(1); }
        await sendEmail(to, subject, body);
        console.log(`✅ Email sent to ${to}`);
        break;
      }

      default:
        console.log('Usage: jmap.js <command> [args]');
        console.log('Commands: inbox, unread, read <id>, search "query", send "to" "subject" "body"');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
