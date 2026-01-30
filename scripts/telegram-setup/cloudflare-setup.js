const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

async function main() {
  const domain = process.argv[2];
  if (!domain) {
    console.error('Usage: node cloudflare-setup.js <your-domain.com>');
    console.error('Example: node cloudflare-setup.js example.com');
    process.exit(1);
  }

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

  console.log('Starting Cloudflare setup');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300
  });

  process.on('SIGINT', async () => {
    console.log('\nClosing browser...');
    await browser.close().catch(() => {});
    process.exit(0);
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // Go to Cloudflare login
    console.log('Opening Cloudflare login...');
    await page.goto('https://dash.cloudflare.com/login');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Try to find and fill email
    console.log('Looking for email field...');
    const emailSelectors = ['input[type="email"]', 'input[name="email"]', '#email', 'input[autocomplete="email"]'];

    for (const selector of emailSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          console.log('   Found email field:', selector);
          await el.fill(email);
          break;
        }
      } catch (e) {}
    }

    await page.waitForTimeout(1000);

    // Try to find and fill password
    console.log('Looking for password field...');
    const pwSelectors = ['input[type="password"]', 'input[name="password"]', '#password'];

    for (const selector of pwSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          console.log('   Found password field:', selector);
          await el.fill(password);
          break;
        }
      } catch (e) {}
    }

    await page.waitForTimeout(1000);

    // Try to click login button
    console.log('Looking for login button...');
    const btnSelectors = ['button[type="submit"]', 'button:has-text("Log in")', 'button:has-text("Sign in")'];

    for (const selector of btnSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          console.log('   Found button:', selector);
          await el.click();
          break;
        }
      } catch (e) {}
    }

    console.log('\nWaiting for login... (complete CAPTCHA if needed)');

    // Wait for redirect to dashboard
    try {
      await page.waitForURL('**/dash.cloudflare.com/**', { timeout: 60000 });
      console.log('Logged in!');
    } catch (e) {
      console.log('Still on login page - may need manual help');
    }

    await page.waitForTimeout(2000);

    // Check current URL
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    if (currentUrl.includes('dash.cloudflare.com') && !currentUrl.includes('login')) {
      // Navigate to add site
      console.log('Navigating to add site...');
      await page.goto('https://dash.cloudflare.com/?to=/:account/add-site');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      // Enter domain
      console.log(`Entering domain: ${domain}`);
      const input = await page.$('input[type="text"]');
      if (input) {
        await input.fill(domain);
        console.log('   Domain entered!');
      }

      await page.waitForTimeout(1000);

      // Click continue
      console.log('Clicking Continue...');
      const continueBtn = await page.$('button:has-text("Continue")');
      if (continueBtn) {
        await continueBtn.click();
      }

      console.log('\nPlease watch the browser and help if needed.');
      console.log('   Select "Free" plan when prompted.');
    }

    console.log('\nBrowser staying open. Close manually when done.');
    await new Promise(() => {});

  } catch (error) {
    console.error('Error:', error.message);
    await new Promise(() => {});
  }
}

main();
