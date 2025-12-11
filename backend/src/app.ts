import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { env } from './config/env.js'

// Routes
import auth from './routes/auth.js'
import profile from './routes/profile.js'
import users from './routes/users.js'
import stripeRoutes from './routes/stripe.js'
import checkout from './routes/checkout.js'
import webhooks from './routes/webhooks.js'
import media from './routes/media.js'
import subscriptions from './routes/subscriptions.js'
import activity from './routes/activity.js'
import requests from './routes/requests.js'
import updates from './routes/updates.js'

const app = new Hono()

// Log Stripe API version on startup (ensure this matches your Stripe dashboard settings)
if (process.env.NODE_ENV !== 'test') {
  console.log('[stripe] API version: 2025-11-17.clover')
}

// Global middleware
app.use('*', logger())
app.use('*', secureHeaders())

// CORS
app.use('*', cors({
  origin: env.APP_URL,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// API routes
app.route('/auth', auth)
app.route('/profile', profile)
app.route('/users', users)
app.route('/stripe', stripeRoutes)
app.route('/checkout', checkout)
app.route('/webhooks', webhooks)
app.route('/media', media)
app.route('/subscriptions', subscriptions)
app.route('/activity', activity)
app.route('/requests', requests)
app.route('/updates', updates)

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
