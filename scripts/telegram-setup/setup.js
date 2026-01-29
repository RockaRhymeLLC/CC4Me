const { chromium } = require('playwright');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const phoneNumber = process.argv[2] || '410-978-5049';

  console.log('🎮 BMO Telegram Setup Script');
  console.log('============================\n');

  // Launch browser in headed mode so user can interact
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null // Use full window
  });

  const page = await context.newPage();

  try {
    // Step 1: Go to Telegram Web
    console.log('📱 Opening Telegram Web...');
    await page.goto('https://web.telegram.org/k/', { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');

    // Wait for login page or check if already logged in
    console.log('\n⏳ Waiting for Telegram to load...');
    await page.waitForTimeout(3000);

    // Check if we need to log in
    const loginButton = await page.$('button:has-text("Log in by phone Number")');
    if (loginButton) {
      console.log('\n📞 Please log in with your phone number: ' + phoneNumber);
      console.log('   1. Click "Log in by phone Number"');
      console.log('   2. Enter your phone number');
      console.log('   3. Enter the verification code sent to your phone\n');

      await ask('Press ENTER once you are logged in...');
    }

    // Wait for main interface
    console.log('\n✅ Checking if logged in...');
    await page.waitForSelector('.chat-list, .chatlist', { timeout: 60000 });
    console.log('✅ Logged into Telegram!\n');

    // Step 2: Navigate to BotFather
    console.log('🤖 Searching for @BotFather...');

    // Click search
    const searchButton = await page.waitForSelector('[class*="btn-menu"], .btn-icon.tgico-search, input[placeholder*="Search"]', { timeout: 10000 });
    await searchButton.click();
    await page.waitForTimeout(500);

    // Type BotFather
    await page.keyboard.type('BotFather');
    await page.waitForTimeout(1500);

    // Click on BotFather result
    const botFatherResult = await page.waitForSelector('text=BotFather', { timeout: 10000 });
    await botFatherResult.click();
    await page.waitForTimeout(1000);

    console.log('✅ Opened BotFather chat!\n');

    // Step 3: Create new bot
    console.log('🆕 Creating new bot...');

    // Find message input and send /newbot
    const messageInput = await page.waitForSelector('.input-message-input, [contenteditable="true"]', { timeout: 10000 });
    await messageInput.click();
    await page.keyboard.type('/newbot');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    console.log('📝 BotFather will ask for a name. Please provide:');
    console.log('   1. Display name (e.g., "BMO Assistant")');
    console.log('   2. Username (must end in "bot", e.g., "bmo_assistant_bot")\n');

    await ask('Press ENTER after you\'ve created the bot and see the token...');

    // Try to find the token in the chat
    console.log('\n🔍 Looking for bot token in chat...');

    // Get all messages
    const messages = await page.$$eval('.message, .bubble-content', elements =>
      elements.map(el => el.textContent)
    );

    // Find token pattern (numbers:letters)
    let token = null;
    for (const msg of messages) {
      const match = msg.match(/\d{9,}:[A-Za-z0-9_-]{35,}/);
      if (match) {
        token = match[0];
        break;
      }
    }

    if (token) {
      console.log('✅ Found bot token!');
      console.log('\n🔐 TOKEN: ' + token + '\n');
    } else {
      console.log('⚠️  Could not automatically find token.');
      const manualToken = await ask('Please paste the bot token here: ');
      token = manualToken.trim();
    }

    // Step 4: Get chat ID by starting conversation with the bot
    console.log('\n📨 To get your chat ID, we need to start a conversation with your new bot.');
    console.log('   1. Open your new bot in Telegram');
    console.log('   2. Click START or send any message');

    await ask('\nPress ENTER after you\'ve sent a message to your bot...');

    // Fetch updates to get chat ID
    console.log('\n🔍 Fetching your chat ID...');
    const updatesUrl = `https://api.telegram.org/bot${token}/getUpdates`;

    // Use page to fetch (since we're in browser context)
    const chatId = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const data = await response.json();
      if (data.ok && data.result && data.result.length > 0) {
        return data.result[0].message?.chat?.id || data.result[0].message?.from?.id;
      }
      return null;
    }, updatesUrl);

    if (chatId) {
      console.log('✅ Found chat ID: ' + chatId);
    } else {
      console.log('⚠️  Could not find chat ID automatically.');
    }

    // Output results
    console.log('\n============================');
    console.log('🎉 SETUP COMPLETE!');
    console.log('============================\n');
    console.log('BOT_TOKEN=' + token);
    if (chatId) console.log('CHAT_ID=' + chatId);
    console.log('\nStore these securely!');

    await ask('\nPress ENTER to close browser...');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
    rl.close();
  }
}

main();
