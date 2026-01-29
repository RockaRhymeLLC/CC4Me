const { chromium } = require('playwright');
const { execSync } = require('child_process');

async function main() {
  const email = execSync('security find-generic-password -s "credential-cloudflare-email" -w').toString().trim();
  const password = execSync('security find-generic-password -s "credential-cloudflare-password" -w').toString().trim();

  console.log('🌐 Logging into Cloudflare as:', email);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    // Go to Cloudflare login
    console.log('📱 Opening Cloudflare...');
    await page.goto('https://dash.cloudflare.com/login', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Fill login form
    console.log('📝 Logging in...');
    const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
    await emailInput.fill(email);

    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 5000 });
    await passwordInput.fill(password);

    // Click login button
    const loginButton = await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
    await loginButton.click();

    console.log('⏳ Waiting for dashboard...');
    await page.waitForTimeout(5000);

    // Look for "Add a site" button
    console.log('🔍 Looking for Add Site option...');

    // Navigate to add site
    await page.goto('https://dash.cloudflare.com/?to=/:account/add-site', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Enter domain
    console.log('📝 Adding playplan.app...');
    const domainInput = await page.waitForSelector('input[placeholder*="site"], input[name="zone"], input[type="text"]', { timeout: 10000 });
    await domainInput.fill('playplan.app');

    console.log('✅ Domain entered. Please:');
    console.log('   1. Click "Continue" or "Add site"');
    console.log('   2. Select the Free plan');
    console.log('   3. Note the nameservers Cloudflare gives you');
    console.log('   4. Update your domain registrar with those nameservers');
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
