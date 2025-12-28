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
} from '../constants/fees.js'
import { isAIAvailable } from '../services/ai/index.js'

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

export default config
