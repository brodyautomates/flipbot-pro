'use strict';
/**
 * OpenAI module
 * ─────────────────────────────────────────────────────────────────
 * Two functions:
 *   1. analyzeListingImage  — GPT-4o vision: detects flaws in photos
 *                             to justify a lower offer price
 *   2. generateLowball      — GPT-4o text: writes a natural, specific
 *                             lowball message referencing detected flaws
 *   3. generateEbayListing  — GPT-4o text: writes polished eBay copy
 * ─────────────────────────────────────────────────────────────────
 */

const OpenAI = require('openai');
const log    = require('../logger');

class OpenAIClient {
  constructor(config) {
    this.client = new OpenAI({ apiKey: config.openaiKey });
  }

  // ── Flaw Detection ────────────────────────────────────────────────
  /**
   * Analyzes a listing image URL and returns detected flaws.
   * Returns null if image is inaccessible or no flaws found.
   *
   * @param {string} imageUrl   - Publicly accessible image URL
   * @param {string} itemTitle  - Context for the model
   * @returns {{ flaws: string[], severity: 'none'|'minor'|'moderate'|'major', summary: string }}
   */
  async analyzeListingImage(imageUrl, itemTitle) {
    try {
      const res = await this.client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are inspecting a Facebook Marketplace listing photo for: "${itemTitle}".

Identify any visible flaws, damage, or wear that could be used to negotiate a lower price. Be specific and factual.

Respond ONLY with valid JSON in this exact format:
{
  "flaws": ["flaw 1", "flaw 2"],
  "severity": "none" | "minor" | "moderate" | "major",
  "summary": "one sentence summary for negotiation"
}

If no flaws are visible, return severity "none" and empty flaws array.`,
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl, detail: 'low' },
              },
            ],
          },
        ],
      });

      const raw = res.choices[0]?.message?.content?.trim() || '{}';
      return JSON.parse(raw.replace(/```json|```/g, '').trim());

    } catch (err) {
      log.warn('Image analysis failed:', err.message);
      return { flaws: [], severity: 'none', summary: '' };
    }
  }

  // ── Lowball Message Generator ─────────────────────────────────────
  /**
   * Generates a natural-sounding lowball offer message.
   *
   * @param {Object} params
   * @param {string} params.itemTitle   - Item name
   * @param {number} params.askingPrice - Seller's listed price
   * @param {number} params.offerPrice  - Your target offer price
   * @param {string[]} params.flaws     - Detected flaws (from analyzeListingImage)
   * @param {number}   params.msgNumber - Which message in sequence (1-15)
   */
  async generateLowball({ itemTitle, askingPrice, offerPrice, flaws, msgNumber = 1 }) {
    const flawContext = flaws.length
      ? `Detected flaws to reference (naturally, not accusatorially): ${flaws.join(', ')}.`
      : 'No major flaws detected. Keep message friendly and casual.';

    const tone = msgNumber === 1
      ? 'friendly first contact, no pressure'
      : msgNumber <= 5
        ? 'following up, still friendly, slightly more direct'
        : 'politely persistent, cash offer emphasis, urgency';

    try {
      const res = await this.client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content: `You write short Facebook Marketplace lowball messages.
Tone: casual, human, never aggressive. Max 2 sentences. No emojis unless one at the end.
You are message ${msgNumber} of 15 in a sequence. Tone for this message: ${tone}.`,
          },
          {
            role: 'user',
            content: `Item: ${itemTitle}
Asking: $${askingPrice}
Your offer: $${offerPrice}
${flawContext}

Write the lowball message. Return ONLY the message text, nothing else.`,
          },
        ],
      });

      return res.choices[0]?.message?.content?.trim() || null;

    } catch (err) {
      log.warn('Lowball generation failed:', err.message);
      return `Hey, would you take $${offerPrice} for the ${itemTitle}? Cash, I can pick up today.`;
    }
  }

  // ── eBay Listing Copy Generator ────────────────────────────────────
  /**
   * Writes polished, conversion-optimized eBay listing copy.
   *
   * @param {Object} params
   * @param {string} params.itemTitle    - Item name
   * @param {number} params.buyPrice     - What you paid
   * @param {number} params.listPrice    - Your eBay listing price
   * @param {string} params.condition    - Item condition
   * @param {string[]} params.flaws      - Known flaws (will be disclosed)
   * @param {string} params.extraDetails - Any extra info from the listing
   */
  async generateEbayListing({ itemTitle, buyPrice, listPrice, condition, flaws, extraDetails }) {
    const flawDisclosure = flaws.length
      ? `Known issues to disclose: ${flaws.join(', ')}.`
      : 'No significant issues to disclose.';

    try {
      const res = await this.client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: `You write eBay listing descriptions for a reseller.
Style: direct, confident, honest. 3 paragraphs. No fluff.
Always mention condition clearly. Build value by referencing retail price.
End with: "Ships within 1 business day. 30-day returns accepted."`,
          },
          {
            role: 'user',
            content: `Item: ${itemTitle}
Condition: ${condition}
Listed at: $${listPrice}
${flawDisclosure}
${extraDetails ? `Additional details: ${extraDetails}` : ''}

Write the eBay description. Return only the description text.`,
          },
        ],
      });

      return res.choices[0]?.message?.content?.trim() || '';

    } catch (err) {
      log.warn('eBay description generation failed:', err.message);
      return `${itemTitle} in ${condition} condition. Tested and working. ${flaws.length ? 'Minor cosmetic wear as noted in photos.' : 'Clean unit.'} Ships within 1 business day. 30-day returns accepted.`;
    }
  }
}

module.exports = { OpenAIClient };
