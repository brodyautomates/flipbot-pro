'use strict';
/**
 * eBay API module
 * ─────────────────────────────────────────────────────────────────
 * Uses two eBay APIs:
 *   1. Finding API  — searches COMPLETED (sold) listings for price comps
 *   2. Trading API  — creates and publishes real eBay listings
 *
 * Both require an eBay Developer account. See setup guide for keys.
 * ─────────────────────────────────────────────────────────────────
 */

const axios = require('axios');
const log   = require('../logger');

const FINDING_ENDPOINT = 'https://svcs.ebay.com/services/search/FindingService/v1';
const TRADING_ENDPOINT = 'https://api.ebay.com/ws/api.dll';
const TRADING_SANDBOX  = 'https://api.sandbox.ebay.com/ws/api.dll';

class EbayAPI {
  constructor(config) {
    this.appId    = config.ebayAppId;
    this.certId   = config.ebayCertId;
    this.devId    = config.ebayDevId;
    this.sandbox  = config.ebaySandbox;
    this._token   = null;
    this._tokenExp = 0;
  }

  // ── OAuth Client Credentials ─────────────────────────────────────
  async _getToken() {
    if (this._token && Date.now() < this._tokenExp) return this._token;

    const base = this.sandbox
      ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
      : 'https://api.ebay.com/identity/v1/oauth2/token';

    const creds = Buffer.from(`${this.appId}:${this.certId}`).toString('base64');

    try {
      const res = await axios.post(base,
        'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
        {
          headers: {
            'Authorization': `Basic ${creds}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      this._token   = res.data.access_token;
      this._tokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
      return this._token;
    } catch (err) {
      log.error('eBay OAuth failed:', err.response?.data?.error_description || err.message);
      throw err;
    }
  }

  // ── Search Sold Comps (Finding API) ──────────────────────────────
  /**
   * Returns array of sold eBay prices for a keyword.
   * Used to calculate realistic resale comp for any item.
   */
  async getSoldComps(keyword, limit = 10) {
    try {
      const params = {
        'OPERATION-NAME':      'findCompletedItems',
        'SERVICE-VERSION':     '1.0.0',
        'SECURITY-APPNAME':    this.appId,
        'RESPONSE-DATA-FORMAT':'JSON',
        'REST-PAYLOAD':        '',
        'keywords':            keyword,
        'itemFilter(0).name':  'SoldItemsOnly',
        'itemFilter(0).value': 'true',
        'itemFilter(1).name':  'ListingType',
        'itemFilter(1).value': 'FixedPrice',
        'sortOrder':           'EndTimeSoonest',
        'paginationInput.entriesPerPage': String(limit),
      };

      const res = await axios.get(FINDING_ENDPOINT, { params });
      const items = res.data?.findCompletedItemsResponse?.[0]
                        ?.searchResult?.[0]?.item || [];

      return items.map(item => ({
        title:       item.title?.[0] || '',
        price:       parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || 0),
        currency:    item.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId'] || 'USD',
        url:         item.viewItemURL?.[0] || '',
        endTime:     item.listingInfo?.[0]?.endTime?.[0] || '',
        condition:   item.condition?.[0]?.conditionDisplayName?.[0] || 'Used',
      })).filter(i => i.price > 0);

    } catch (err) {
      log.error('eBay comp search failed:', err.message);
      return [];
    }
  }

  /**
   * Calculates average and median sold price from comps.
   */
  async getCompPrice(keyword) {
    const sold = await this.getSoldComps(keyword, 12);
    if (!sold.length) return null;

    const prices = sold.map(s => s.price).sort((a, b) => a - b);
    const avg    = prices.reduce((a, b) => a + b, 0) / prices.length;
    const median = prices[Math.floor(prices.length / 2)];

    return {
      avg:    Math.round(avg * 100) / 100,
      median: Math.round(median * 100) / 100,
      count:  prices.length,
      range:  { min: prices[0], max: prices[prices.length - 1] },
      raw:    sold,
    };
  }

  // ── Post eBay Listing (Trading API — AddFixedPriceItem) ──────────
  /**
   * Creates and publishes a fixed-price eBay listing.
   *
   * @param {Object} listing
   * @param {string} listing.title          - eBay listing title (≤80 chars)
   * @param {string} listing.description    - HTML description
   * @param {number} listing.price          - Buy It Now price (USD)
   * @param {string} listing.categoryId     - eBay category ID (see docs)
   * @param {string} listing.condition      - 'Used', 'Good', 'Excellent', etc.
   * @param {string[]} listing.imageUrls    - Array of public image URLs (≤12)
   * @param {number} [listing.quantity]     - Quantity (default 1)
   */
  async postListing(listing) {
    const endpoint = this.sandbox ? TRADING_SANDBOX : TRADING_ENDPOINT;
    const token    = await this._getToken();

    const conditionMap = {
      'New':         '1000',
      'Excellent':   '2000',
      'Good':        '3000',
      'Acceptable':  '4000',
      'Used':        '3000',
    };
    const conditionId = conditionMap[listing.condition] || '3000';

    const pictures = (listing.imageUrls || [])
      .slice(0, 12)
      .map(url => `<PictureURL>${url}</PictureURL>`)
      .join('\n');

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${escapeXml(listing.title.substring(0, 80))}</Title>
    <Description><![CDATA[${listing.description}]]></Description>
    <PrimaryCategory><CategoryID>${listing.categoryId || '99'}</CategoryID></PrimaryCategory>
    <StartPrice>${listing.price.toFixed(2)}</StartPrice>
    <Quantity>${listing.quantity || 1}</Quantity>
    <ListingType>FixedPriceItem</ListingType>
    <ListingDuration>Days_30</ListingDuration>
    <Country>US</Country>
    <Currency>USD</Currency>
    <ConditionID>${conditionId}</ConditionID>
    <PictureDetails>${pictures}</PictureDetails>
    <ShippingDetails>
      <ShippingType>Calculated</ShippingType>
      <ShippingServiceOptions>
        <ShippingService>USPSPriority</ShippingService>
        <ShippingServicePriority>1</ShippingServicePriority>
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
  </Item>
</AddFixedPriceItemRequest>`;

    try {
      const res = await axios.post(endpoint, xml, {
        headers: {
          'X-EBAY-API-CALL-NAME':           'AddFixedPriceItem',
          'X-EBAY-API-APP-NAME':            this.appId,
          'X-EBAY-API-DEV-NAME':            this.devId,
          'X-EBAY-API-CERT-NAME':           this.certId,
          'X-EBAY-API-SITEID':              '0',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'Content-Type':                   'text/xml',
        },
      });

      const body = res.data;
      if (body.includes('<Ack>Success</Ack>') || body.includes('<Ack>Warning</Ack>')) {
        const itemIdMatch = body.match(/<ItemID>(\d+)<\/ItemID>/);
        return {
          success: true,
          itemId:  itemIdMatch?.[1] || null,
          url:     itemIdMatch ? `https://www.ebay.com/itm/${itemIdMatch[1]}` : null,
        };
      } else {
        const errMatch = body.match(/<LongMessage>(.*?)<\/LongMessage>/);
        throw new Error(errMatch?.[1] || 'Unknown eBay error');
      }
    } catch (err) {
      log.error('eBay listing failed:', err.message);
      return { success: false, error: err.message };
    }
  }
}

function escapeXml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = { EbayAPI };
