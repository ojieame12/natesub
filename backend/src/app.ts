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
import paystackRoutes from './routes/paystack.js'
import checkout from './routes/checkout.js'
import webhooks from './routes/webhooks.js'
import media from './routes/media.js'
import subscriptions from './routes/subscriptions.js'
import activity from './routes/activity.js'
import requests from './routes/requests.js'
import updates from './routes/updates.js'
import ai from './routes/ai.js'
import jobs from './routes/jobs.js'
import payroll from './routes/payroll.js'
import billing from './routes/billing.js'

const app = new Hono()

// Log Stripe API version on startup (ensure this matches your Stripe dashboard settings)
if (process.env.NODE_ENV !== 'test') {
  console.log('[stripe] API version: 2025-11-17.clover')
}

// Global middleware
app.use('*', logger())
app.use('*', secureHeaders())

// CORS - allow multiple origins for web and mobile
const allowedOrigins = [
  ...env.APP_URL.split(',').map(o => o.trim()).filter(Boolean),
  'capacitor://localhost',      // iOS Capacitor
  'http://localhost',           // Android Capacitor
  'http://localhost:5173',      // Local dev
  'http://localhost:5174',      // Local dev alt port
]

app.use('*', cors({
  origin: (origin) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return '*'
    // Check if origin is in allowed list
    if (allowedOrigins.some(allowed => origin && origin.startsWith(allowed))) {
      return origin
    }
    // Deny unknown origins
    return null
  },
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
app.route('/paystack', paystackRoutes)
app.route('/checkout', checkout)
app.route('/webhooks', webhooks)
app.route('/media', media)
app.route('/subscriptions', subscriptions)
app.route('/activity', activity)
app.route('/requests', requests)
app.route('/updates', updates)
app.route('/ai', ai)
app.route('/jobs', jobs)
app.route('/payroll', payroll)
app.route('/billing', billing)

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
