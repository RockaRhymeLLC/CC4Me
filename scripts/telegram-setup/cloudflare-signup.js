const { chromium } = require('playwright');
const { execSync } = require('child_process');

async function main() {
  let email, password;
  try {
    email = execSync('security find-generic-password -s "credential-cloudflare-email" -w').toString().trim();
    password = execSync('security find-generic-password -s "credential-cloudflare-password" -w').toString().trim();
  } catch (e) {
    console.error('Error: Cloudflare credentials not found in Keychain.');
    console.error('Store them first:');
    console.error('  security add-generic-password -a "assistant" -s "credential-cloudflare-email" -w "you@example.com" -U');
    console.error('  security add-generic-password -a "assistant" -s "credential-cloudflare-password" -w "your-password" -U');
    process.exit(1);
  }

  console.log('Starting Cloudflare signup for:', email);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  process.on('SIGINT', async () => {
    console.log('\nClosing browser...');
    await browser.close().catch(() => {});
    process.exit(0);
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    // Go to Cloudflare signup
    console.log('Opening Cloudflare signup page...');
    await page.goto('https://dash.cloudflare.com/sign-up', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Fill signup form
    console.log('Filling signup form...');

    // Email field
    const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
    await emailInput.fill(email);

    // Password field
    const passwordInput = await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 5000 });
    await passwordInput.fill(password);

    console.log('Form filled. Please:');
    console.log('   1. Complete any CAPTCHA if shown');
    console.log('   2. Click "Sign Up"');
    console.log('   3. Check your email for verification');
    console.log('\nBrowser will stay open. Close when done.');

    // Keep browser open
    await new Promise(() => {});

  } catch (error) {
    console.error('Error:', error.message);
    console.log('\nBrowser will stay open for manual completion.');
    await new Promise(() => {});
  }
}

main();
