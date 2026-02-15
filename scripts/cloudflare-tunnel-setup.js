const { webkit } = require('playwright');

(async () => {
  const browser = await webkit.launch({
    headless: false,
    slowMo: 1000
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to Cloudflare Zero Trust
  console.log('Navigating to Cloudflare Zero Trust...');
  await page.goto('https://one.dash.cloudflare.com/', { timeout: 60000 });

  // Wait for page to load (just domcontentloaded, not networkidle)
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  console.log('Page loaded. Current URL:', page.url());
  console.log('Page title:', await page.title());

  // Take a screenshot to see what we're working with
  await page.screenshot({ path: '/tmp/cloudflare-state.png' });
  console.log('Screenshot saved to /tmp/cloudflare-state.png');

  // Check if already logged in or needs team creation
  const pageContent = await page.content();

  if (pageContent.includes('Create a team') || pageContent.includes('create a team')) {
    console.log('\n=== Need to create Zero Trust team ===');
    console.log('Waiting for user input...');
  } else if (pageContent.includes('Zero Trust') || pageContent.includes('Tunnels')) {
    console.log('\n=== Already have Zero Trust access ===');
    console.log('Looking for Tunnels...');

    // Navigate to Tunnels
    await page.goto('https://one.dash.cloudflare.com/?to=/:account/access/tunnels');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/cloudflare-tunnels.png' });
    console.log('Tunnels page screenshot saved');
  }

  console.log('\nBrowser will stay open for manual interaction if needed...');
  console.log('Press Ctrl+C when done');

  // Keep browser open for manual interaction
  await page.waitForTimeout(300000); // 5 minutes

  await browser.close();
})();
