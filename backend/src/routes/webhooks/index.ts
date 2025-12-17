import { Hono } from 'hono'
import { webhookRateLimit } from '../../middleware/rateLimit.js'
import { stripeWebhookHandler } from './stripe/index.js'
import { paystackWebhookHandler } from './paystack/index.js'

const webhooks = new Hono()

// Apply rate limiting to all webhook endpoints (100 requests/hour per IP)
webhooks.use('*', webhookRateLimit)

// Stripe webhook handler
webhooks.post('/stripe', stripeWebhookHandler)

// Paystack webhook handler
webhooks.post('/paystack', paystackWebhookHandler)

export default webhooks
