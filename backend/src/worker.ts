import { createWorker } from './lib/queue.js'
import { emailProcessor } from './workers/emailProcessor.js'
import { billingProcessor } from './workers/billingProcessor.js'
import { webhookProcessor } from './workers/webhookProcessor.js'
import { db } from './db/client.js'

console.log('🚀 Starting Background Workers...')

// Initialize Workers
const emailWorker = createWorker('email-queue', emailProcessor, 5) // 5 concurrent emails
const billingWorker = createWorker('billing-queue', billingProcessor, 1) // 1 concurrent billing job (singleton)
const webhookWorker = createWorker('webhook-queue', webhookProcessor, 10) // 10 concurrent webhooks

// Handle graceful shutdown
const workers = [emailWorker, billingWorker, webhookWorker]

async function shutdown() {
  console.log('🛑 Shutting down workers...')
  
  await Promise.all(workers.map(w => w.close()))
  await db.$disconnect()
  
  console.log('✅ Workers shut down')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('✅ Workers are running')
