#!/usr/bin/env node
'use strict';
/**
 * Interactive setup wizard
 * Run: npm run setup
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const chalk    = require('chalk');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, res));

async function main() {
  console.log('');
  console.log(chalk.greenBright('  FlipBot Pro — Setup Wizard'));
  console.log(chalk.gray('  ─────────────────────────────────'));
  console.log('');
  console.log('  This wizard will create your .env file.');
  console.log('  You\'ll need your API keys ready. See the setup guide PDF for details.\n');

  const vals = {};

  vals.EBAY_APP_ID      = await ask(chalk.cyan('  eBay App ID: '));
  vals.EBAY_CERT_ID     = await ask(chalk.cyan('  eBay Cert ID: '));
  vals.EBAY_DEV_ID      = await ask(chalk.cyan('  eBay Dev ID: '));
  vals.EBAY_REDIRECT_URI= await ask(chalk.cyan('  eBay Redirect URI (from app settings): '));
  vals.EBAY_SANDBOX     = await ask(chalk.cyan('  Sandbox mode? (yes/no) [default: no]: '));
  vals.OPENAI_API_KEY   = await ask(chalk.cyan('  OpenAI API Key (sk-...): '));
  vals.FB_LOCATION      = await ask(chalk.cyan('  Facebook Marketplace city slug [default: dallas]: '));
  vals.FB_MAX_PRICE     = await ask(chalk.cyan('  Max price to scan [default: 5000]: '));
  vals.BOT_MIN_MARGIN_PCT = await ask(chalk.cyan('  Minimum margin % to flag as match [default: 25]: '));
  vals.BOT_KEYWORDS     = await ask(chalk.cyan('  Keywords to scan (comma-separated) [default: bike,tools,electronics]: '));

  rl.close();

  const envContent = `PORT=3000

EBAY_APP_ID=${vals.EBAY_APP_ID}
EBAY_CERT_ID=${vals.EBAY_CERT_ID}
EBAY_DEV_ID=${vals.EBAY_DEV_ID}
EBAY_REDIRECT_URI=${vals.EBAY_REDIRECT_URI}
EBAY_SANDBOX=${vals.EBAY_SANDBOX.toLowerCase().startsWith('y') ? 'true' : 'false'}

OPENAI_API_KEY=${vals.OPENAI_API_KEY}

FB_LOCATION=${vals.FB_LOCATION || 'dallas'}
FB_MAX_PRICE=${vals.FB_MAX_PRICE || '5000'}
FB_HEADLESS=true

BOT_SCAN_INTERVAL_SEC=300
BOT_MIN_MARGIN_PCT=${vals.BOT_MIN_MARGIN_PCT || '25'}
BOT_MAX_DAILY_MESSAGES=200
BOT_KEYWORDS=${vals.BOT_KEYWORDS || 'bike,tools,electronics'}

PROXY_URL=
`;

  const envPath = path.join(__dirname, '../.env');
  fs.writeFileSync(envPath, envContent);

  console.log('');
  console.log(chalk.greenBright('  ✅ .env file created!'));
  console.log('');
  console.log('  Next steps:');
  console.log(chalk.cyan('  1.'), 'Run', chalk.white('npm install'));
  console.log(chalk.cyan('  2.'), 'Run', chalk.white('npx playwright install chromium'));
  console.log(chalk.cyan('  3.'), 'Run', chalk.white('npm run login'), '(one-time Facebook login)');
  console.log(chalk.cyan('  4.'), 'Run', chalk.white('npm start'));
  console.log('');
}

main().catch(err => {
  console.error('Setup error:', err.message);
  rl.close();
  process.exit(1);
});
