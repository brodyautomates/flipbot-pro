'use strict';
const chalk = require('chalk');

function validateConfig() {
  const missing = [];

  function need(key, label) {
    if (!process.env[key]) missing.push(`  ${chalk.red('✗')} ${label}  (${chalk.gray(key)})`);
    return process.env[key] || null;
  }

  const config = {
    port:              parseInt(process.env.PORT || '3000', 10),

    // eBay
    ebayAppId:         need('EBAY_APP_ID',      'eBay App ID'),
    ebayCertId:        need('EBAY_CERT_ID',     'eBay Cert ID'),
    ebayDevId:         need('EBAY_DEV_ID',      'eBay Dev ID'),
    ebayRedirectUri:   process.env.EBAY_REDIRECT_URI || '',
    ebaySandbox:       process.env.EBAY_SANDBOX === 'true',

    // OpenAI
    openaiKey:         need('OPENAI_API_KEY',   'OpenAI API Key'),

    // Facebook
    fbLocation:        process.env.FB_LOCATION  || 'dallas',
    fbMaxPrice:        parseInt(process.env.FB_MAX_PRICE || '5000', 10),
    fbHeadless:        process.env.FB_HEADLESS  !== 'false',

    // Bot
    scanIntervalSec:   parseInt(process.env.BOT_SCAN_INTERVAL_SEC || '300', 10),
    minMarginPct:      parseInt(process.env.BOT_MIN_MARGIN_PCT    || '25',  10),
    maxDailyMessages:  parseInt(process.env.BOT_MAX_DAILY_MESSAGES|| '200', 10),
    keywords:         (process.env.BOT_KEYWORDS || 'bike,tools,electronics').split(',').map(k => k.trim()),

    // Proxy
    proxyUrl:          process.env.PROXY_URL || null,
  };

  if (missing.length) {
    console.log('');
    console.log(chalk.yellow('⚠  Missing required environment variables:'));
    missing.forEach(m => console.log(m));
    console.log('');
    console.log(chalk.gray('  Copy .env.example → .env and fill in the values.'));
    console.log(chalk.gray('  See the setup guide for step-by-step instructions.\n'));
    process.exit(1);
  }

  return config;
}

module.exports = { validateConfig };
