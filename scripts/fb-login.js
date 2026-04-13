#!/usr/bin/env node
'use strict';
/**
 * Facebook Login Script
 * ─────────────────────────────────────────────────────────────────
 * Launches a visible browser window so you can log in to Facebook
 * manually. Once you're logged in, press ENTER in this terminal
 * and the session cookies will be saved for the bot to reuse.
 *
 * Run this once (or whenever your session expires):
 *   npm run login
 * ─────────────────────────────────────────────────────────────────
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const readline = require('readline');

const SESSION_DIR  = path.join(__dirname, '../data/session');
const SESSION_FILE = path.join(SESSION_DIR, 'fb-session.json');

async function main() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('\n  FlipBot Pro — Facebook Login Setup\n');
  console.log('  A browser window will open.');
  console.log('  Log in to Facebook normally, then come back here and press ENTER.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle' });

  // Wait for user to log in
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('  Press ENTER after you have logged in to Facebook... ', () => {
      rl.close();
      resolve();
    });
  });

  // Save session
  await context.storageState({ path: SESSION_FILE });
  await browser.close();

  console.log('\n  ✅ Session saved to:', SESSION_FILE);
  console.log('  You can now run: npm start\n');
}

main().catch(err => {
  console.error('\n  Error:', err.message);
  process.exit(1);
});
