const { ImapFlow } = require('imapflow');
const { execSync } = require('child_process');

async function main() {
  const imapHost = process.argv[2] || 'imap.fastmail.com';

  let email, password;
  try {
    email = execSync('security find-generic-password -s "credential-email-address" -w').toString().trim();
    password = execSync('security find-generic-password -s "credential-email-password" -w').toString().trim();
  } catch (e) {
    console.error('Error: Email credentials not found in Keychain.');
    console.error('Store them first:');
    console.error('  security add-generic-password -a "assistant" -s "credential-email-address" -w "you@example.com" -U');
    console.error('  security add-generic-password -a "assistant" -s "credential-email-password" -w "your-password" -U');
    console.error('\nOr pass your IMAP host as argument: node check-email.js imap.gmail.com');
    process.exit(1);
  }

  console.log('Checking email for:', email);
  console.log('IMAP host:', imapHost);

  const client = new ImapFlow({
    host: imapHost,
    port: 993,
    secure: true,
    auth: { user: email, pass: password }
  });

  try {
    await client.connect();
    console.log('Connected to', imapHost);

    // Open inbox
    await client.mailboxOpen('INBOX');

    // Fetch recent messages
    console.log('\nRecent emails:\n');

    let cloudflareEmail = null;

    for await (let message of client.fetch('1:10', { envelope: true, source: true })) {
      const from = message.envelope.from[0]?.address || 'unknown';
      const subject = message.envelope.subject || 'No subject';
      const date = message.envelope.date;

      console.log(`From: ${from}`);
      console.log(`Subject: ${subject}`);
      console.log(`Date: ${date}`);
      console.log('---');

      // Look for Cloudflare verification email
      if (from.includes('cloudflare') || subject.toLowerCase().includes('cloudflare') || subject.toLowerCase().includes('verify')) {
        cloudflareEmail = message;

        // Extract verification link from body
        const body = message.source.toString();
        const linkMatch = body.match(/https:\/\/dash\.cloudflare\.com\/[^\s"<>]+verify[^\s"<>]*/i) ||
                          body.match(/https:\/\/[^\s"<>]*cloudflare[^\s"<>]*verify[^\s"<>]*/i) ||
                          body.match(/https:\/\/dash\.cloudflare\.com\/[^\s"<>]+/);

        if (linkMatch) {
          console.log('\nVERIFICATION LINK FOUND:');
          console.log(linkMatch[0]);
        }
      }
    }

    await client.logout();

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
