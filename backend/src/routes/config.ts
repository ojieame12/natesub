/**
 * Config Routes - Public configuration for frontend
 *
 * Serves fee constants and other configuration that the frontend needs.
 * This eliminates the need for frontend to duplicate these values.
 */

import { Hono } from 'hono'
import {
  PLATFORM_FEE_RATE,
  SPLIT_RATE,
  CROSS_BORDER_BUFFER,
  isCrossBorderCountry,
} from '../constants/fees.js'
import {
  CREATOR_MINIMUMS,
  getCreatorMinimum,
  getSupportedCountries,
  getFeeBreakdown,
  calculateDynamicMinimumUSD,
  getDynamicMinimum,
} from '../constants/creatorMinimums.js'
import { isAIAvailable } from '../services/ai/index.js'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/client.js'

const config = new Hono()

/**
 * GET /config/fees
 * Returns fee configuration for frontend pricing calculations
 *
 * Response is cacheable (1 hour) since fee rates rarely change.
 */
config.get('/fees', (c) => {
  // Set cache headers - fees don't change often
  c.header('Cache-Control', 'public, max-age=3600') // 1 hour

  return c.json({
    // Core rates
    platformFeeRate: PLATFORM_FEE_RATE,     // 0.09 (9%)
    splitRate: SPLIT_RATE,                   // 0.045 (4.5% each party)
    crossBorderBuffer: CROSS_BORDER_BUFFER,  // 0.015 (1.5% extra for cross-border)
    // Derived values for convenience
    platformFeePercent: PLATFORM_FEE_RATE * 100,  // 9
    splitPercent: SPLIT_RATE * 100,               // 4.5
    // Cross-border: base rate + buffer (9% + 1.5% = 10.5%)
    domesticFeePercent: 9,
    crossBorderFeePercent: 10.5,
    domesticSplitPercent: 4.5,
    crossBorderSplitPercent: 5.25,
  })
})

/**
 * GET /config/ai
 * Returns AI feature availability for service mode (perks/banner generation)
 *
 * Response is cacheable (5 minutes) since AI availability rarely changes.
 */
config.get('/ai', (c) => {
  c.header('Cache-Control', 'public, max-age=300') // 5 minutes

  return c.json({
    available: isAIAvailable(),
  })
})

/**
 * GET /config/minimums
 * Returns minimum subscription amounts by creator country
 *
 * These minimums are CALCULATED from actual Stripe fee inputs.
 * Formula guarantees: platformFee >= allStripeFees (no negative balance ever)
 *
 * Response is cacheable (1 hour) since minimums rarely change.
 */
config.get('/minimums', (c) => {
  c.header('Cache-Control', 'public, max-age=3600') // 1 hour

  // Strip internal audit fields from public response
  const publicMinimums: Record<string, { usd: number; local: number; currency: string }> = {}
  for (const [country, min] of Object.entries(CREATOR_MINIMUMS)) {
    publicMinimums[country] = {
      usd: min.usd,
      local: min.local,
      currency: min.currency,
    }
  }

  return c.json({
    minimums: publicMinimums,
    supportedCountries: getSupportedCountries(),
    meta: {
      platformFee: '9% domestic, 10.5% cross-border',
      model: 'Destination charges - platform absorbs all Stripe fees',
      feeBreakdown: {
        domestic: '9% total (4.5% subscriber + 4.5% creator)',
        crossBorder: '10.5% total (5.25% subscriber + 5.25% creator)',
      },
      minimumBreakdown: {
        domestic: '$25-95 dynamic (based on subscriber count)',
        crossBorder: '$85 flat',
      },
      payoutCadence: 'monthly',
      accountType: 'Express',
      formula: 'min = (fixedFees + accountFee/subs + payoutFee) / (platformRate - totalPercentFees)',
      // Static minimums use floor subscriber count (established creators)
      // New creators see higher dynamic minimums via /config/my-minimum
      floorSubscriberCount: 20,
      assumptions: {
        intlMix: '70% for domestic countries, 100% for cross-border countries',
        payoutPercent: '0.25%',
        crossBorderCountries: 'NG, GH, KE, TZ, RW, BD, PK, LK, PH, VN, ID, TH, EG, MA, JO, SA, AE, KW, QA, BH, OM',
      },
      note: 'Use GET /config/my-minimum for creator-specific dynamic minimum',
    },
  })
})

/**
 * GET /config/minimums/:country
 * Returns minimum subscription and fee breakdown for a specific country
 */
config.get('/minimums/:country', (c) => {
  const country = c.req.param('country')
  const minimum = getCreatorMinimum(country)

  if (!minimum) {
    return c.json({ error: `Country "${country}" is not supported` }, 404)
  }

  const fees = getFeeBreakdown(country)

  c.header('Cache-Control', 'public, max-age=3600') // 1 hour

  return c.json({
    country,
    usd: minimum.usd,
    local: minimum.local,
    currency: minimum.currency,
    fees,
  })
})

/**
 * GET /config/my-minimum
 * Returns the creator's DYNAMIC minimum subscription based on their subscriber count
 *
 * The $2/month Stripe account fee is amortized across active subscribers:
 * - New creator (0-1 subs): Higher minimum to cover full account fee
 * - Growing creator (5+ subs): Lower minimum as fee spreads across subscribers
 * - Established creator (20+ subs): Converges to floor minimum
 *
 * Requires authentication - this is creator-specific data.
 */
config.get('/my-minimum', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Get creator's profile
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { country: true, currency: true },
  })

  if (!profile?.country) {
    return c.json({ error: 'Profile not found or country not set' }, 404)
  }

  // Get active MONTHLY subscriber count
  // Excludes one_time payments since they don't generate recurring revenue
  // to amortize the $2/month Stripe account fee
  const subscriberCount = await db.subscription.count({
    where: { creatorId: userId, status: 'active', interval: 'month' },
  })

  // Calculate dynamic minimum
  const dynamicMin = getDynamicMinimum({
    country: profile.country,
    subscriberCount,
  })

  // Check if this is a cross-border country (higher minimums due to higher fees)
  const isCrossBorder = isCrossBorderCountry(profile.country)

  // Floor minimum is what you'd get with 20+ subscribers (converged minimum)
  const floorMin = calculateDynamicMinimumUSD({
    country: profile.country,
    subscriberCount: 20,
  })

  // No cache - this depends on subscriber count which can change
  c.header('Cache-Control', 'no-store')

  return c.json({
    minimum: {
      usd: dynamicMin.minimumUSD,
      local: dynamicMin.minimumLocal,
      currency: dynamicMin.currency,
    },
    subscriberCount,
    floorMinimum: floorMin, // What minimum will be when fully ramped
    isCrossBorder, // True for cross-border countries (NG, KE, GH, etc.)
    // Fee model explanation - all countries use destination charges
    // Split fee model: domestic 4.5%/4.5% = 9%, cross-border 5.25%/5.25% = 10.5%
    feeModel: {
      type: 'destination',
      platformFee: isCrossBorder ? '10.5%' : '9%',
      creatorFee: isCrossBorder ? '5.25%' : '4.5%',
      creatorKeeps: isCrossBorder ? '94.75%' : '95.5%',
      stripeFeesPaidBy: 'platform',
      note: isCrossBorder
        ? 'Cross-border: Higher minimum due to international card fees. You keep 94.75% of subscription price.'
        : 'Platform absorbs all Stripe fees. You keep 95.5% of subscription price.',
    },
    // Debugging/transparency info
    _debug: {
      percentFees: `${(dynamicMin.percentFees * 100).toFixed(2)}%`,
      fixedCents: dynamicMin.fixedCents,
      netMarginRate: `${(dynamicMin.netMarginRate * 100).toFixed(2)}%`,
    },
  })
})

export default config
