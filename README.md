# FlipBot Pro

Automated Facebook Marketplace → eBay arbitrage bot with a live operations dashboard.

**What it does:**
- Scans Facebook Marketplace listings on a configurable interval
- Pulls eBay sold comps for every item found
- Calculates net margin after eBay fees and shipping
- Uses GPT-4o to analyze listing photos for flaws (to justify lower offers)
- Auto-generates and sends lowball messages via Playwright browser automation
- Posts matching items to eBay with AI-written descriptions
- Streams all activity to a real-time dashboard in your browser

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browser
npx playwright install chromium

# 3. Run the setup wizard (creates your .env file)
npm run setup

# 4. Authenticate with Facebook (one-time)
npm run login

# 5. Start the bot
npm start
```

Open **http://localhost:3000** to see the live dashboard.

---

## API Keys Required

| Service | Where to get it | Cost |
|---|---|---|
| eBay Developer | developer.ebay.com/my/keys | Free |
| OpenAI | platform.openai.com/api-keys | Pay per use (~$0.01–0.03/scan) |
| Facebook | No API key — uses your account via Playwright | Free |

See the **FlipBot Pro Setup Guide** PDF for step-by-step instructions.

---

## Configuration

All settings live in `.env`. Key options:

| Variable | Default | Description |
|---|---|---|
| `BOT_KEYWORDS` | `bike,tools,electronics` | Keywords to search on Marketplace |
| `BOT_MIN_MARGIN_PCT` | `25` | Minimum net margin % to flag as a match |
| `BOT_SCAN_INTERVAL_SEC` | `300` | Seconds between scans (300 = every 5 min) |
| `FB_LOCATION` | `dallas` | Marketplace city slug |
| `EBAY_SANDBOX` | `false` | `true` = test mode, no real listings posted |

---

## Architecture

```
server.js              Express + WebSocket server
src/
  config.js            Env var validation
  logger.js            Colored console output
  scrapers/
    marketplace.js     Playwright Facebook scraper
  apis/
    ebay.js            eBay Finding + Trading API
    openai.js          GPT-4o image analysis + text gen
  engine/
    bot.js             Main orchestration loop
    margin.js          P&L calculator (includes eBay fees)
  dashboard/
    index.html         Real-time browser dashboard (WebSocket)
scripts/
  fb-login.js          One-time Facebook session capture
  setup.js             Interactive .env wizard
```

---

## Notes

- Facebook Marketplace has no public API. This bot uses Playwright browser automation with your saved login session.
- eBay Trading API requires a seller account with API access enabled.
- Set `EBAY_SANDBOX=true` to test listing creation without real listings going live.
- The `data/session/` folder is gitignored — your Facebook cookies stay local only.
