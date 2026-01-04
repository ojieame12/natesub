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
    platformFeeRate: PLATFORM_FEE_RATE,     // 0.09 (9%)
    splitRate: SPLIT_RATE,                   // 0.045 (4.5% each party)
    crossBorderBuffer: CROSS_BORDER_BUFFER,  // 0.015 (1.5%)
    // Derived values for convenience
    platformFeePercent: PLATFORM_FEE_RATE * 100,  // 9
    splitPercent: SPLIT_RATE * 100,               // 4.5
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
      platformFee: '9%',
      model: 'Platform absorbs all Stripe fees',
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
    feeModel: {
      type: 'destination',
      platformFee: `${(PLATFORM_FEE_RATE * 100).toFixed(0)}%`,
      stripeFeesPaidBy: 'platform',
      note: isCrossBorder
        ? 'Cross-border: Higher minimum due to international card fees. You get 91% of subscription price.'
        : 'Platform absorbs all Stripe fees. You get 91% of subscription price.',
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
