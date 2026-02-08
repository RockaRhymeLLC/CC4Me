/**
 * Live API test for session-manager.ts (t-020)
 * Tests: create session, navigate, screenshot, live view URL, close session
 * Run: npx tsx src/test-lifecycle.ts
 */

import * as sm from './session-manager.js';

const API_KEY = process.env.BB_API_KEY!;
const PROJECT_ID = process.env.BB_PROJECT_ID!;

async function test() {
  console.log('=== t-020: Browserbase session lifecycle (live API) ===\n');

  // Step 1: Init
  console.log('1. Initializing session manager...');
  sm.init({ apiKey: API_KEY, projectId: PROJECT_ID });
  console.log('   PASS: Initialized without errors\n');

  // Step 2: Create session
  console.log('2. Creating session...');
  const info = await sm.createSession();
  console.log(`   Session ID: ${info.sessionId}`);
  console.log(`   Connect URL: ${info.connectUrl.slice(0, 60)}...`);
  console.log(`   Live View: ${info.liveViewUrl.slice(0, 60)}...`);
  if (!info.sessionId || !info.connectUrl || !info.liveViewUrl) {
    throw new Error('FAIL: Missing session info fields');
  }
  console.log('   PASS: Session created with all required fields\n');

  // Step 3: Navigate
  console.log('3. Navigating to example.com...');
  await sm.navigateTo('https://example.com');
  console.log('   PASS: Navigation complete\n');

  // Step 4: Screenshot
  console.log('4. Taking screenshot...');
  const screenshot = await sm.getScreenshot();
  const pngMagic = screenshot.slice(0, 4);
  const isPng = pngMagic[0] === 0x89 && pngMagic[1] === 0x50 && pngMagic[2] === 0x4E && pngMagic[3] === 0x47;
  console.log(`   Buffer size: ${screenshot.length} bytes`);
  console.log(`   PNG magic bytes: ${isPng ? 'YES' : 'NO'}`);
  if (!isPng || screenshot.length === 0) {
    throw new Error('FAIL: Screenshot is not a valid PNG');
  }
  console.log('   PASS: Valid PNG screenshot\n');

  // Step 5: Live view URL
  console.log('5. Getting live view URL...');
  const liveUrl = await sm.getLiveViewUrl();
  console.log(`   URL: ${liveUrl.slice(0, 80)}...`);
  if (!liveUrl.includes('browserbase.com')) {
    throw new Error('FAIL: Live view URL does not contain browserbase.com');
  }
  console.log('   PASS: Valid live view URL\n');

  // Step 6: List active sessions
  console.log('6. Listing active sessions...');
  const sessions = await sm.listActiveSessions();
  console.log(`   Found ${sessions.length} running session(s)`);
  const ours = sessions.find(s => s.id === info.sessionId);
  if (!ours) {
    throw new Error('FAIL: Our session not found in active list');
  }
  console.log('   PASS: Our session is listed as active\n');

  // Step 7: Close session
  console.log('7. Closing session...');
  await sm.closeSession({ saveContext: false });
  if (sm.getActiveSession() !== null) {
    throw new Error('FAIL: Active session not cleared after close');
  }
  console.log('   PASS: Session closed and cleared\n');

  console.log('=== ALL TESTS PASSED ===');
}

test().catch(err => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
