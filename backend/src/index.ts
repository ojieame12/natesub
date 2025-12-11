import { serve } from '@hono/node-server'
import app from './app.js'
import { env } from './config/env.js'

const port = parseInt(env.PORT)

console.log(`
╔═══════════════════════════════════════╗
║           NATE API SERVER             ║
╚═══════════════════════════════════════╝

Environment: ${env.NODE_ENV}
Port: ${port}
App URL: ${env.APP_URL}
`)

serve({
  fetch: app.fetch,
  port,
})

console.log(`✅ Server running on http://localhost:${port}`)
