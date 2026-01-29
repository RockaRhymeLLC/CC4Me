const { chromium } = require('playwright');

async function main() {
  console.log('🎮 Opening Telegram Web...');
  console.log('Browser will stay open. Close it when done.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto('https://web.telegram.org/k/', { timeout: 120000 });

  console.log('✅ Telegram Web is open!');
  console.log('\nInstructions:');
  console.log('1. Log in with phone: 410-978-5049');
  console.log('2. Enter verification code from your phone');
  console.log('3. Search for @BotFather');
  console.log('4. Send: /newbot');
  console.log('5. Choose a name like "BMO Assistant"');
  console.log('6. Choose a username ending in "bot" like "bmo_dave_bot"');
  console.log('7. Copy the token that BotFather gives you');
  console.log('8. Send the token to BMO in this terminal\n');

  // Keep browser open
  await new Promise(() => {});
}

main().catch(console.error);
