'use strict';
/**
 * FlipBot Pro — Core Orchestration Engine
 * ─────────────────────────────────────────────────────────────────
 * Ties together: Marketplace scraper → comp lookup → margin calc
 *                → lowball generation → eBay listing
 *
 * All events are emitted through the broadcast() callback so the
 * WebSocket dashboard receives real-time updates.
 * ─────────────────────────────────────────────────────────────────
 */

const { MarketplaceScraper } = require('../scrapers/marketplace');
const { EbayAPI }            = require('../apis/ebay');
const { OpenAIClient }       = require('../apis/openai');
const margin                 = require('./margin');
const log                    = require('../logger');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (base, v) => base + Math.floor(Math.random() * v);

class FlipBot {
  constructor(config, broadcast) {
    this.config    = config;
    this.broadcast = broadcast;  // fn(type, data) → sends to all WS clients

    this.scraper   = new MarketplaceScraper(config);
    this.ebay      = new EbayAPI(config);
    this.ai        = new OpenAIClient(config);

    // Live state (sent to dashboard on connect)
    this.state = {
      paused:        false,
      scanned:       0,
      activeListings: 0,
      profit:        0,
      lowballCount:  0,
      pnlData:       [],          // [{name, buy, ebay, margin, status}]
      recentListings: [],         // Last 6 eBay listings posted
      lowballMessages: [],        // Last 10 lowball messages sent
      feedLog:       [],          // Last 50 feed entries
    };

    this._scanTimer    = null;
    this._dailyMsgCount = 0;
    this._lastMsgReset  = new Date().toDateString();
  }

  // ── Public controls ────────────────────────────────────────────────
  pause()  { this.state.paused = true;  this._broadcastStatus(); log.warn('Bot paused'); }
  resume() { this.state.paused = false; this._broadcastStatus(); log.success('Bot resumed'); }

  getState()  { return this.state; }
  getStatus() {
    return {
      paused:    this.state.paused,
      scanned:   this.state.scanned,
      profit:    this.state.profit,
      uptime:    process.uptime(),
    };
  }

  // ── Start ──────────────────────────────────────────────────────────
  async start() {
    log.success('FlipBot Pro starting...');
    this._feed('info', '🤖 FlipBot Pro initialized — starting first scan');

    try {
      await this.scraper.init();

      // Verify session
      const loggedIn = await this.scraper.isLoggedIn();
      if (!loggedIn) {
        this._feed('error', '❌ Facebook session expired. Run: npm run login');
        log.error('Facebook session expired. Run: npm run login');
        return;
      }

      this._feed('info', '✅ Facebook session valid — scanning Marketplace');
      log.success('Facebook session valid');

    } catch (err) {
      this._feed('error', `❌ ${err.message}`);
      log.error('Init error:', err.message);
      return;
    }

    // Run first scan immediately, then on interval
    await this._runScanCycle();
    this._scanTimer = setInterval(() => {
      if (!this.state.paused) this._runScanCycle();
    }, this.config.scanIntervalSec * 1000);
  }

  // ── Main scan cycle ────────────────────────────────────────────────
  async _runScanCycle() {
    log.info('Starting scan cycle');
    this._feed('info', `🔄 Scan cycle started — ${this.config.keywords.length} keyword(s)`);

    for (const keyword of this.config.keywords) {
      if (this.state.paused) break;
      await this._scanKeyword(keyword);
      await sleep(jitter(3000, 2000)); // delay between keywords
    }

    this._feed('info', `✅ Scan cycle complete — ${this.state.scanned} total items scanned`);
    log.success(`Scan cycle complete. Total scanned: ${this.state.scanned}`);
  }

  // ── Scan a single keyword ──────────────────────────────────────────
  async _scanKeyword(keyword) {
    if (this.state.paused) return;

    const listings = await this.scraper.searchListings(keyword, this.config.fbMaxPrice);

    for (const item of listings) {
      if (this.state.paused) break;

      this.state.scanned++;
      this._feed('scan', `🔍 Scanned: ${item.title} — $${item.price}`);
      this.broadcast('stats', { scanned: this.state.scanned });

      await sleep(jitter(800, 600));

      // Look up eBay comps
      const comp = await this.ebay.getCompPrice(item.title);
      if (!comp) {
        this._feed('skip', `❌ Skipped: no eBay comps found for "${item.title}"`);
        continue;
      }

      // Calculate margin
      const calc = margin.calculate(item.price, comp.median);
      if (!calc) continue;

      const status = margin.getStatus(calc.netMarginPct, this.config.minMarginPct);

      // Update P&L table
      const pnlRow = {
        name:   item.title.substring(0, 40),
        buy:    item.price,
        ebay:   comp.median,
        margin: calc.netMarginPct,
        status,
        url:    item.url,
      };
      this.state.pnlData.unshift(pnlRow);
      if (this.state.pnlData.length > 30) this.state.pnlData.pop();
      this.broadcast('pnl_update', pnlRow);

      if (status === 'SKIPPED') {
        this._feed('skip', `❌ Skipped: margin ${calc.netMarginPct}% below threshold — ${item.title}`);
        continue;
      }

      if (status === 'REVIEWING') {
        this._feed('scan', `◐ Reviewing: ${item.title} — ${calc.netMarginPct}% margin (borderline)`);
        continue;
      }

      // MATCH — above threshold
      this._feed('match',
        `✅ MATCH: ${item.title} — buy $${item.price} / sell est. $${comp.median} — margin ${calc.netMarginPct}%`
      );
      log.match(`${item.title} | buy $${item.price} | sell $${comp.median} | margin ${calc.netMarginPct}%`);

      // Analyze images for flaws
      let flaws = [];
      if (item.imageUrl) {
        const analysis = await this.ai.analyzeListingImage(item.imageUrl, item.title);
        flaws = analysis.flaws || [];
        if (flaws.length) {
          this._feed('lowball', `🔎 Flaw detection: ${flaws.join(', ')}`);
        }
      }

      // Generate and send lowball
      await this._sendLowball(item, calc, flaws, 1);

      // Post to eBay if margin high enough
      if (calc.netMarginPct >= this.config.minMarginPct + 5) {
        await this._postEbayListing(item, calc, comp, flaws);
      }

      await sleep(jitter(2000, 1500));
    }
  }

  // ── Lowball sender ─────────────────────────────────────────────────
  async _sendLowball(item, calc, flaws, msgNumber) {
    this._resetDailyCountIfNeeded();
    if (this._dailyMsgCount >= this.config.maxDailyMessages) {
      log.warn('Daily message limit reached. Skipping lowball.');
      return;
    }

    const offerPrice = margin.recommendOffer(item.price, calc.compPrice);

    const message = await this.ai.generateLowball({
      itemTitle:    item.title,
      askingPrice:  item.price,
      offerPrice,
      flaws,
      msgNumber,
    });

    if (!message) return;

    const sent = await this.scraper.sendMessage(item.url, message);

    if (sent) {
      this._dailyMsgCount++;
      this.state.lowballCount++;

      const lbEntry = {
        seller:  this._extractSeller(item.url),
        message,
        time:    new Date().toLocaleTimeString(),
        status:  'No reply',
      };

      this.state.lowballMessages.unshift(lbEntry);
      if (this.state.lowballMessages.length > 10) this.state.lowballMessages.pop();

      this._feed('lowball', `📨 Lowball sent (msg ${msgNumber}): "${message.substring(0, 60)}..."`);
      this.broadcast('lowball_tick', { count: this.state.lowballCount, entry: lbEntry });
    }
  }

  // ── eBay listing poster ────────────────────────────────────────────
  async _postEbayListing(item, calc, comp, flaws) {
    const description = await this.ai.generateEbayListing({
      itemTitle:    item.title,
      buyPrice:     item.price,
      listPrice:    calc.listPrice,
      condition:    'Used',
      flaws,
      extraDetails: '',
    });

    const result = await this.ebay.postListing({
      title:       item.title.substring(0, 80),
      description,
      price:       calc.listPrice,
      categoryId:  '99',   // Generic category — update per item type
      condition:   'Used',
      imageUrls:   item.imageUrl ? [item.imageUrl] : [],
    });

    if (result.success) {
      this.state.profit += calc.netProfit;
      this.state.activeListings++;
      this.broadcast('profit_tick', { amount: calc.netProfit, total: this.state.profit });

      const listing = {
        icon:    '🏷️',
        title:   item.title,
        price:   calc.listPrice,
        bought:  item.price,
        profit:  calc.netProfit,
        time:    0,
        ebayUrl: result.url,
      };

      this.state.recentListings.unshift(listing);
      if (this.state.recentListings.length > 6) this.state.recentListings.pop();

      this._feed('posted', `🚀 eBay listing POSTED: ${item.title} — $${calc.listPrice}`);
      this.broadcast('listing_posted', listing);
      log.success(`Listed on eBay: ${item.title} @ $${calc.listPrice}`);
    } else {
      this._feed('error', `⚠️ eBay listing failed: ${result.error}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────
  _feed(type, text) {
    const entry = { type, text, ts: Date.now() };
    this.state.feedLog.unshift(entry);
    if (this.state.feedLog.length > 50) this.state.feedLog.pop();
    this.broadcast('feed', entry);
  }

  _broadcastStatus() {
    this.broadcast('bot_status', { paused: this.state.paused });
  }

  _extractSeller(url) {
    const match = url.match(/item\/(\d+)/);
    return match ? `Seller_${match[1].slice(-6)}` : 'Unknown';
  }

  _resetDailyCountIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this._lastMsgReset) {
      this._dailyMsgCount = 0;
      this._lastMsgReset  = today;
    }
  }
}

module.exports = { FlipBot };
