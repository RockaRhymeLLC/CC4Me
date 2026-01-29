---
name: email
description: Read and send emails via Fastmail. Use for checking inbox, reading messages, searching, or sending email.
argument-hint: [check|unread|read|search|send]
---

# Email Management

Read and send emails via Fastmail JMAP API.

## Commands

Parse the arguments to determine action:

### Check/Read
- `check` or `inbox` - Check inbox for recent emails
- `read <number>` - Read full email by number from last check
- `search "query"` - Search emails
- `unread` - Show unread emails only

### Send
- `send "to" "subject" "body"` - Send an email

### Examples
- `/email check` - Show recent inbox
- `/email unread` - Show unread messages
- `/email search "cloudflare"` - Find emails mentioning cloudflare
- `/email send "dave@example.com" "Hello" "Message body here"`

## Authentication

Credentials stored in Keychain:
- `credential-fastmail-email` - Email address
- `credential-fastmail-token` - JMAP API token

To get a token:
1. Log into Fastmail web
2. Settings → Privacy & Security → Integrations → API tokens
3. Create new token with mail access scope
4. Store: `security add-generic-password -a "assistant" -s "credential-fastmail-token" -w "TOKEN" -U`

## Implementation

Use the JMAP API via the helper script at `scripts/email/jmap.js`:

```bash
# Check inbox
/opt/homebrew/bin/node /Users/bmo/CC4Me-BMO/scripts/email/jmap.js inbox

# Read email by ID
/opt/homebrew/bin/node /Users/bmo/CC4Me-BMO/scripts/email/jmap.js read <email_id>

# Search
/opt/homebrew/bin/node /Users/bmo/CC4Me-BMO/scripts/email/jmap.js search "query"

# Send
/opt/homebrew/bin/node /Users/bmo/CC4Me-BMO/scripts/email/jmap.js send "to" "subject" "body"
```

## Workflow

1. Get credentials from Keychain
2. Run appropriate jmap.js command
3. Parse and display results
4. For send, confirm success

## Output Format

### Inbox
```
## Inbox (5 unread)

1. [UNREAD] From: sender@example.com
   Subject: Important message
   Date: 2026-01-28 10:30

2. From: other@example.com
   Subject: Re: Meeting
   Date: 2026-01-28 09:15
```

### Read Email
```
## Email

From: sender@example.com
To: bmo_hurley@fastmail.com
Subject: Important message
Date: 2026-01-28 10:30

---

Email body content here...
```

## Security

- Only read/send from safe senders list unless explicitly requested
- Never expose API token
- Log sent emails for audit trail
