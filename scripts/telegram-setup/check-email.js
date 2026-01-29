const { ImapFlow } = require('imapflow');
const { execSync } = require('child_process');

async function main() {
  const email = execSync('security find-generic-password -s "credential-fastmail-email" -w').toString().trim();
  const password = execSync('security find-generic-password -s "credential-fastmail-password" -w').toString().trim();

  console.log('📧 Checking email for:', email);

  const client = new ImapFlow({
    host: 'imap.fastmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password }
  });

  try {
    await client.connect();
    console.log('✅ Connected to Fastmail');

    // Open inbox
    await client.mailboxOpen('INBOX');

    // Fetch recent messages
    console.log('\n📬 Recent emails:\n');

    let cloudflareEmail = null;

    for await (let message of client.fetch('1:10', { envelope: true, source: true })) {
      const from = message.envelope.from[0]?.address || 'unknown';
      const subject = message.envelope.subject || 'No subject';
      const date = message.envelope.date;

      console.log(`From: ${from}`);
      console.log(`Subject: ${subject}`);
      console.log(`Date: ${date}`);
      console.log('---');

      // Look for Cloudflare email
      if (from.includes('cloudflare') || subject.toLowerCase().includes('cloudflare') || subject.toLowerCase().includes('verify')) {
        cloudflareEmail = message;

        // Extract verification link from body
        const body = message.source.toString();
        const linkMatch = body.match(/https:\/\/dash\.cloudflare\.com\/[^\s"<>]+verify[^\s"<>]*/i) ||
                          body.match(/https:\/\/[^\s"<>]*cloudflare[^\s"<>]*verify[^\s"<>]*/i) ||
                          body.match(/https:\/\/dash\.cloudflare\.com\/[^\s"<>]+/);

        if (linkMatch) {
          console.log('\n🔗 VERIFICATION LINK FOUND:');
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
