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
  CROSS_BORDER_PAYOUT_COUNTRIES,
  isCrossBorderCountry,
} from '../constants/fees.js'
import {
  CREATOR_MINIMUMS,
  getCreatorMinimum,
  getSupportedCountries,
  getFeeBreakdown,
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
      model: 'Destination charges - platform absorbs Connect fees only',
      feeBreakdown: {
        domestic: '9% total (4.5% subscriber + 4.5% creator)',
        crossBorder: '10.5% total (5.25% subscriber + 5.25% creator)',
      },
      minimumBreakdown: {
        domestic: '$15 (fixed per country)',
        crossBorder: '$45 floor',
      },
      payoutCadence: 'monthly',
      accountType: 'Express',
      formula: 'min = (processingFixed + payoutFixed) / (platformRate - connectFees)',
      // Account fees are a platform cost, not amortized per-transaction
      // All creators (new or established) see the same minimum for their country
      platformCosts: {
        billing: '0.7%',
        payout: '0.25%',
        crossBorderTransfer: '0.25%-1%',
        monthlyAccount: '$0.67',
      },
      creatorCosts: {
        processing: '2.9% + $0.30',
        intlCard: '1.5%',
        fx: '1%',
      },
      assumptions: {
        crossBorderCountries: [...CROSS_BORDER_PAYOUT_COUNTRIES],
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
 * Returns the creator's minimum subscription based on their country's fee structure.
 *
 * Minimum is based on processing + payout fixed costs vs net margin rate.
 * Account fees are a platform cost (not amortized per-transaction), so the
 * minimum is the same for all creators in a given country regardless of subscriber count.
 *
 * Requires authentication - uses creator's profile to determine country.
 */
config.get('/my-minimum', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Get creator's profile — only need country to calculate minimum
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { country: true, currency: true },
  })

  if (!profile?.country) {
    return c.json({ error: 'Profile not found or country not set' }, 404)
  }

  // Calculate minimum (same for all creators in a country — no subscriber-based amortization)
  const dynamicMin = getDynamicMinimum({
    country: profile.country,
    subscriberCount: 0, // No longer used by the calculation
  })

  // Check if this is a cross-border country (higher minimums due to international card fees)
  const isCrossBorder = isCrossBorderCountry(profile.country)

  // Cacheable since minimum depends only on country (not subscriber count).
  // 5 minutes aligns with frontend staleTime; logout clears React Query cache.
  c.header('Cache-Control', 'private, max-age=300') // 5 minutes, private (auth-gated)

  return c.json({
    minimum: {
      usd: dynamicMin.minimumUSD,
      local: dynamicMin.minimumLocal,
      currency: dynamicMin.currency,
    },
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
