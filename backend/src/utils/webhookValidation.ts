/**
 * Webhook Payload Validation
 * Validates critical user-controlled fields in webhook payloads
 * Provider signature verification happens first, this validates data integrity
 */

import { z } from 'zod'

// ============================================
// STRIPE WEBHOOK METADATA SCHEMAS
// ============================================

/**
 * Checkout session metadata schema
 * Validates user-controlled metadata fields from checkout sessions
 */
export const stripeCheckoutMetadataSchema = z.object({
  creatorId: z.string().uuid('Invalid creatorId format'),
  tierId: z.string().optional(),
  requestId: z.string().optional(),
  viewId: z.string().optional(),
  // Fee tracking fields
  grossAmount: z.string().regex(/^\d+$/, 'grossAmount must be numeric string').optional(),
  netAmount: z.string().regex(/^\d+$/, 'netAmount must be numeric string').optional(),
  serviceFee: z.string().regex(/^\d+$/, 'serviceFee must be numeric string').optional(),
  feeModel: z.enum(['flat', 'progressive', 'percentage', 'split_v1', 'direct_v1']).optional(),
  feeMode: z.enum(['absorb', 'pass_to_subscriber', 'split']).optional(),
  feeEffectiveRate: z.string().optional(),
  feeWasCapped: z.enum(['true', 'false']).optional(),
  // Charge type: 'direct' for cross-border countries, 'destination' for domestic
  chargeType: z.enum(['direct', 'destination']).optional(),
  // Split fee fields (v2 model: 4.5%/4.5%)
  subscriberFeeCents: z.string().regex(/^\d+$/, 'subscriberFeeCents must be numeric string').optional(),
  creatorFeeCents: z.string().regex(/^\d+$/, 'creatorFeeCents must be numeric string').optional(),
  baseAmountCents: z.string().regex(/^\d+$/, 'baseAmountCents must be numeric string').optional(),
  // Platform debit recovery (for service providers with lapsed platform subscription)
  platformDebitRecovered: z.string().regex(/^\d+$/, 'platformDebitRecovered must be numeric string').optional(),
  // Dispute evidence (for chargeback defense)
  checkoutIp: z.string().optional(),
  checkoutUserAgent: z.string().optional(),
  checkoutAcceptLanguage: z.string().optional(),
})

/**
 * Subscription metadata schema
 */
export const stripeSubscriptionMetadataSchema = z.object({
  creatorId: z.string().uuid('Invalid creatorId format').optional(),
  tierId: z.string().optional(),
  expected_fee_amount: z.string().regex(/^\d+$/).optional(),
})

/**
 * Validate Stripe checkout session metadata
 */
export function validateCheckoutMetadata(metadata: Record<string, string> | null | undefined): {
  valid: boolean
  data?: z.infer<typeof stripeCheckoutMetadataSchema>
  error?: string
} {
  if (!metadata) {
    return { valid: false, error: 'Missing metadata' }
  }

  const result = stripeCheckoutMetadataSchema.safeParse(metadata)

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
    console.error('[webhook-validation] Checkout metadata validation failed:', errors)
    return { valid: false, error: errors }
  }

  return { valid: true, data: result.data }
}

// ============================================
// PAYSTACK WEBHOOK SCHEMAS
// ============================================

/**
 * Paystack transaction metadata schema
 * NOTE: Paystack stores all metadata values as strings, so we coerce them
 */
const coerceNumber = z.preprocess(
  (val) => (typeof val === 'string' ? parseInt(val, 10) : val),
  z.number().int().min(0)
)
const coerceFloat = z.preprocess(
  (val) => (typeof val === 'string' ? parseFloat(val) : val),
  z.number().min(0).max(100)
)
const coerceBoolean = z.preprocess(
  (val) => (val === 'true' ? true : val === 'false' ? false : val),
  z.boolean()
)

export const paystackTransactionMetadataSchema = z.object({
  creatorId: z.string().uuid('Invalid creatorId format'),
  tierId: z.string().optional(),
  interval: z.enum(['month', 'one_time']),
  viewId: z.string().optional(),
  // Fee tracking - coerce strings to numbers (Paystack stores as strings)
  creatorAmount: coerceNumber.optional(),
  serviceFee: coerceNumber.optional(),
  feeModel: z.string().optional(),
  feeMode: z.enum(['absorb', 'pass_to_subscriber', 'split']).optional(),
  feeEffectiveRate: coerceFloat.optional(),
  feeWasCapped: coerceBoolean.optional(),
  // Split fee fields (v2 model)
  baseAmount: coerceNumber.optional(),
  subscriberFee: coerceNumber.optional(),
  creatorFee: coerceNumber.optional(),
  // Dispute evidence (for chargeback defense)
  checkoutIp: z.string().optional(),
  checkoutUserAgent: z.string().optional(),
  checkoutAcceptLanguage: z.string().optional(),
})

/**
 * Paystack charge event data schema
 */
export const paystackChargeEventSchema = z.object({
  event: z.literal('charge.success'),
  data: z.object({
    id: z.number(),
    reference: z.string().min(1),
    amount: z.number().int().min(0),
    currency: z.string().length(3),
    status: z.literal('success'),
    channel: z.string(),
    customer: z.object({
      id: z.number(),
      email: z.string().email(),
      customer_code: z.string(),
    }),
    authorization: z.object({
      authorization_code: z.string(),
      card_type: z.string().optional(),
      last4: z.string().optional(),
      exp_month: z.string().optional(),
      exp_year: z.string().optional(),
      reusable: z.boolean(),
    }).optional(),
    metadata: paystackTransactionMetadataSchema.optional(),
  }),
})

/**
 * Validate Paystack transaction metadata
 */
export function validatePaystackMetadata(metadata: Record<string, any> | null | undefined): {
  valid: boolean
  data?: z.infer<typeof paystackTransactionMetadataSchema>
  error?: string
} {
  if (!metadata) {
    return { valid: false, error: 'Missing metadata' }
  }

  const result = paystackTransactionMetadataSchema.safeParse(metadata)

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
    console.error('[webhook-validation] Paystack metadata validation failed:', errors)
    return { valid: false, error: errors }
  }

  return { valid: true, data: result.data }
}

// ============================================
// GENERIC HELPERS
// ============================================

/**
 * Safe parse amount from metadata (string or number)
 */
export function parseMetadataAmount(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0
  const parsed = typeof value === 'number' ? value : parseInt(value, 10)
  return isNaN(parsed) ? 0 : Math.max(0, parsed)
}

/**
 * Validate UUID format
 */
export function isValidUUID(value: string | undefined | null): boolean {
  if (!value) return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(value)
}

/**
 * Sanitize string for logging (remove potential injection characters)
 */
export function sanitizeForLog(value: string | undefined | null, maxLength = 100): string {
  if (!value) return ''
  let sanitized = ''
  for (let i = 0; i < value.length && sanitized.length < maxLength; i++) {
    const code = value.charCodeAt(i)
    if (code < 32 || code === 127) continue
    sanitized += value[i]
  }
  return sanitized
}
