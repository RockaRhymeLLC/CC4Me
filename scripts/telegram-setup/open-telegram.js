const { chromium } = require('playwright');

async function main() {
  console.log('Opening Telegram Web...');
  console.log('Browser will stay open. Close it when done.\n');

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

  await page.goto('https://web.telegram.org/k/', { timeout: 120000 });

  console.log('Telegram Web is open!');
  console.log('\nInstructions:');
  console.log('1. Log in with your phone number');
  console.log('2. Enter verification code from your phone');
  console.log('3. Search for @BotFather');
  console.log('4. Send: /newbot');
  console.log('5. Choose a display name (e.g., "My Assistant")');
  console.log('6. Choose a username ending in "bot" (e.g., "my_assistant_bot")');
  console.log('7. Copy the token that BotFather gives you');
  console.log('8. Store the token in your Keychain:\n');
  console.log('   security add-generic-password -a "assistant" -s "credential-telegram-bot" -w "YOUR_TOKEN" -U\n');

  // Keep browser open
  await new Promise(() => {});
}

main().catch(console.error);
