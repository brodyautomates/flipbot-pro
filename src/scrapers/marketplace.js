'use strict';
/**
 * Facebook Marketplace scraper (Playwright)
 * ─────────────────────────────────────────────────────────────────
 * Uses a saved login session (cookies) so the browser starts already
 * authenticated. Run `npm run login` once to capture your session.
 *
 * IMPORTANT: Facebook's Marketplace DOM structure changes periodically.
 * If scraping stops working, run the bot with FB_HEADLESS=false and
 * inspect the selectors below. The structure comments explain what
 * each selector targets so you can update them quickly.
 * ─────────────────────────────────────────────────────────────────
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const log  = require('../logger');

const SESSION_FILE = path.join(__dirname, '../../data/session/fb-session.json');

// Delay helpers — essential for not getting rate-limited
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (base, variance) => base + Math.floor(Math.random() * variance);

class MarketplaceScraper {
  constructor(config) {
    this.config  = config;
    this.browser = null;
    this.context = null;
    this.page    = null;
    this.ready   = false;
  }

  // ── Init browser ──────────────────────────────────────────────────
  async init() {
    if (!fs.existsSync(SESSION_FILE)) {
      throw new Error(
        'No Facebook session found. Run `npm run login` first to authenticate.\n' +
        'This saves your login cookies so the bot can access Marketplace.'
      );
    }

    this.browser = await chromium.launch({
      headless: this.config.fbHeadless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
      ...(this.config.proxyUrl ? { proxy: { server: this.config.proxyUrl } } : {}),
    });

    this.context = await this.browser.newContext({
      storageState: SESSION_FILE,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });

    this.page  = await this.context.newPage();
    this.ready = true;
    log.success('Marketplace scraper initialized');
  }

  // ── Check session health ──────────────────────────────────────────
  async isLoggedIn() {
    await this.page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2000);
    // Logged-in FB shows a nav bar; logged-out shows login form
    const loggedIn = await this.page.$('div[role="navigation"]') !== null
                  || await this.page.$('[aria-label="Facebook"]') !== null;
    return loggedIn;
  }

  // ── Search a keyword on Marketplace ──────────────────────────────
  /**
   * Searches FB Marketplace for a keyword and returns raw listing data.
   *
   * @param {string} keyword
   * @param {number} maxPrice
   * @returns {Promise<Array<{title, price, url, imageUrl, location}>>}
   */
  async searchListings(keyword, maxPrice) {
    if (!this.ready) throw new Error('Scraper not initialized. Call init() first.');

    const location = this.config.fbLocation;
    const url      = `https://www.facebook.com/marketplace/${encodeURIComponent(location)}/search` +
                     `?query=${encodeURIComponent(keyword)}&maxPrice=${maxPrice}&sortBy=creation_time_descend`;

    log.scan(`Searching "${keyword}" in ${location} (max $${maxPrice})`);

    try {
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(jitter(2000, 1500));

      // FB Marketplace listing cards sit inside a feed.
      // The stable selector is the data-testid on the link wrapping each card.
      // Structure (as of 2024): a[href*="/marketplace/item/"] > div > ...
      const listingSelector = 'a[href*="/marketplace/item/"]';
      await this.page.waitForSelector(listingSelector, { timeout: 15000 });

      const items = await this.page.$$eval(listingSelector, anchors =>
        anchors.slice(0, 25).map(a => {
          // Title: first non-price span with meaningful text
          const spans    = Array.from(a.querySelectorAll('span'));
          const title    = spans.find(s => s.textContent.length > 5 && !s.textContent.includes('$'))?.textContent?.trim() || '';
          // Price: span containing '$'
          const priceSpan = spans.find(s => s.textContent.includes('$'));
          const priceRaw  = priceSpan?.textContent?.trim() || '$0';
          const price     = parseFloat(priceRaw.replace(/[^0-9.]/g, '')) || 0;
          // Image
          const img       = a.querySelector('img');
          const imageUrl  = img?.src || '';
          // Location line (usually 2nd or 3rd line of text)
          const locationSpan = spans.find((s, i) => i > 0 && s.textContent.length > 0 && !s.textContent.includes('$') && s.textContent !== title);
          const location   = locationSpan?.textContent?.trim() || '';

          return {
            title,
            price,
            url:      a.href,
            imageUrl,
            location,
          };
        }).filter(item => item.title.length > 2 && item.price > 0)
      );

      log.info(`Found ${items.length} listings for "${keyword}"`);
      return items;

    } catch (err) {
      log.error(`Marketplace search failed for "${keyword}":`, err.message);
      return [];
    }
  }

  // ── Get single listing detail ─────────────────────────────────────
  async getListingDetail(listingUrl) {
    try {
      await this.page.goto(listingUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(jitter(1500, 1000));

      const detail = await this.page.evaluate(() => {
        const title       = document.querySelector('h1')?.textContent?.trim() || '';
        const priceEl     = document.querySelector('[data-testid="marketplace_pdp_price"]');
        const price       = parseFloat((priceEl?.textContent || '0').replace(/[^0-9.]/g, '')) || 0;
        const descEl      = document.querySelector('[data-testid="marketplace_pdp_description"]');
        const description = descEl?.textContent?.trim() || '';
        const images      = Array.from(document.querySelectorAll('img[src*="fbcdn"]'))
                                 .map(img => img.src)
                                 .filter(src => src.length > 50)
                                 .slice(0, 8);
        return { title, price, description, images };
      });

      return detail;

    } catch (err) {
      log.warn('Could not fetch listing detail:', err.message);
      return null;
    }
  }

  // ── Send a message to a seller ────────────────────────────────────
  async sendMessage(listingUrl, message) {
    try {
      await this.page.goto(listingUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(jitter(2000, 1000));

      // Click "Message" button
      const msgBtn = await this.page.$('[aria-label="Message"], button:has-text("Message")');
      if (!msgBtn) { log.warn('Message button not found'); return false; }

      await msgBtn.click();
      await sleep(1500);

      // Type the message
      const inputBox = await this.page.$('[contenteditable="true"][role="textbox"]');
      if (!inputBox) { log.warn('Message input not found'); return false; }

      await inputBox.click();
      await sleep(300);

      // Type character by character for human-like behavior
      for (const char of message) {
        await this.page.keyboard.type(char);
        await sleep(jitter(30, 60));
      }

      await sleep(500);
      await this.page.keyboard.press('Enter');
      await sleep(1000);

      log.lb(`Message sent to listing: ${listingUrl.split('/').slice(-2, -1)[0]}`);
      return true;

    } catch (err) {
      log.error('Failed to send message:', err.message);
      return false;
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.ready   = false;
    }
  }
}

module.exports = { MarketplaceScraper };
