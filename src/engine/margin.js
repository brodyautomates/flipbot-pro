'use strict';
/**
 * Margin calculator
 * ─────────────────────────────────────────────────────────────────
 * Takes a buy price and eBay comp price and returns full P&L math
 * including eBay fees (13.25% final value fee on most categories),
 * estimated shipping, and net margin.
 * ─────────────────────────────────────────────────────────────────
 */

// eBay fees — adjust if your category differs
// https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees
const EBAY_FVF_RATE    = 0.1325;  // 13.25% final value fee
const EBAY_PAYMENT_FEE = 0.0;     // Included in FVF as of 2024
const ESTIMATED_SHIPPING = 12;    // Average shipping cost estimate (USD)

/**
 * @param {number} buyPrice    - What you paid on Marketplace
 * @param {number} compPrice   - eBay sold comp (what similar items sell for)
 * @returns {{
 *   buyPrice, listPrice, ebayFee, shippingCost, netProfit,
 *   grossMarginPct, netMarginPct, status, roi
 * }}
 */
function calculate(buyPrice, compPrice) {
  if (!buyPrice || !compPrice || buyPrice <= 0 || compPrice <= 0) {
    return null;
  }

  // We list slightly below comp to sell faster
  const listPrice   = Math.round(compPrice * 0.95 * 100) / 100;
  const ebayFee     = Math.round(listPrice * EBAY_FVF_RATE * 100) / 100;
  const netRevenue  = listPrice - ebayFee - ESTIMATED_SHIPPING;
  const netProfit   = netRevenue - buyPrice;

  const grossMarginPct = Math.round(((listPrice - buyPrice) / listPrice) * 100);
  const netMarginPct   = Math.round((netProfit / listPrice) * 100);
  const roi            = Math.round((netProfit / buyPrice) * 100);

  return {
    buyPrice,
    compPrice,
    listPrice,
    ebayFee,
    shippingCost:  ESTIMATED_SHIPPING,
    netProfit:     Math.round(netProfit * 100) / 100,
    grossMarginPct,
    netMarginPct,
    roi,
  };
}

/**
 * Returns the recommended lowball offer price.
 * Targets ~25% below asking to leave negotiation room.
 */
function recommendOffer(askingPrice, compPrice) {
  // If asking already below comp, start at 80% of asking
  if (askingPrice <= compPrice * 0.7) {
    return Math.round(askingPrice * 0.80);
  }
  // Standard: offer at a price that gives us >= 35% net margin
  const targetBuy = compPrice * 0.95 * (1 - EBAY_FVF_RATE) - ESTIMATED_SHIPPING;
  const offer     = Math.round(targetBuy * 0.70);  // 70% of max buy = negotiation cushion
  return Math.max(offer, Math.round(askingPrice * 0.55));
}

/**
 * Status classification used by dashboard color coding.
 */
function getStatus(netMarginPct, minMarginPct) {
  if (netMarginPct >= minMarginPct)              return 'POSTED';    // green
  if (netMarginPct >= minMarginPct * 0.6)        return 'REVIEWING'; // yellow
  return 'SKIPPED';                                                   // red
}

module.exports = { calculate, recommendOffer, getStatus };
