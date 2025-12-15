import { serve } from '@hono/node-server'
import app from './app.js'
import { env } from './config/env.js'
import { validateEncryptionConfig } from './utils/encryption.js'
import { db } from './db/client.js'
import { redis } from './db/redis.js'

// Validate critical configuration before starting
try {
  validateEncryptionConfig()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  console.warn('⚠️ Server starting despite configuration errors (Healthcheck Priority)')
  // process.exit(1) // Don't crash on startup
}

const port = Number.parseInt(env.PORT, 10)
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT: ${env.PORT}`)
}

// Railway/containers need an externally reachable bind address.
// In dev, keep the default host binding (more compatible with local setups).
// In production, prefer IPv4-any to avoid IPv6-only bind issues on some hosts/proxies.
const hostname = process.env.HOST || (env.NODE_ENV === 'production' ? '0.0.0.0' : undefined)

console.log(`
╔═══════════════════════════════════════╗
║           NATE API SERVER             ║
╚═══════════════════════════════════════╝

Environment: ${env.NODE_ENV}
Port: ${port}
App URL: ${env.APP_URL}
`)

const server = serve({
  fetch: app.fetch,
  port,
  ...(hostname ? { hostname } : {}),
})

console.log(`✅ Server running on http://${hostname || 'localhost'}:${port}`)

// Graceful shutdown handler
let isShuttingDown = false

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(`\n⏳ Received ${signal}, shutting down gracefully...`)

  // Stop accepting new connections
  server.close(() => {
    console.log('✅ HTTP server closed')
  })

  // Give in-flight requests 10 seconds to complete
  await new Promise(resolve => setTimeout(resolve, 10000))

  // Close database connections
  try {
    await db.$disconnect()
    console.log('✅ Database connection closed')
  } catch (err) {
    console.error('Error closing database:', err)
  }

  // Close Redis connection
  try {
    await redis.quit()
    console.log('✅ Redis connection closed')
  } catch (err) {
    console.error('Error closing Redis:', err)
  }

  console.log('👋 Shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
