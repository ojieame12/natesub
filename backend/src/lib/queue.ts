import { Queue, Worker, type Job, type Processor } from 'bullmq'
import { env } from '../config/env.js'
import { redis } from '../db/redis.js'

// Reuse the existing Redis connection if possible, or create a new one for BullMQ
// BullMQ requires a dedicated connection for blocking commands, so we pass the URL string
// and let it manage its own connections.
const connection = {
  url: env.REDIS_URL,
}

// Queue Definitions
export const emailQueue = new Queue('email-queue', { connection })
export const billingQueue = new Queue('billing-queue', { connection })
export const webhookQueue = new Queue('webhook-queue', { connection })

// Worker Factory Helper
export function createWorker<T>(
  queueName: string,
  processor: Processor<T>,
  concurrency = 1
) {
  return new Worker(queueName, processor, {
    connection,
    concurrency,
    // Remove completed jobs to save Redis memory (keep last 100)
    removeOnComplete: { count: 100 },
    // Keep failed jobs for inspection (keep last 1000)
    removeOnFail: { count: 1000 },
  })
}

// Graceful shutdown helper for queues
export async function closeQueues() {
  await Promise.all([
    emailQueue.close(),
    billingQueue.close(),
    webhookQueue.close(),
  ])
}
