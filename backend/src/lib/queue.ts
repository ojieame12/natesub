import { Queue, Worker, type Processor } from 'bullmq'
import { env } from '../config/env.js'

type JobOptions = {
  jobId?: string
  attempts?: number
  delay?: number
}

type QueueLike = {
  add: (name: string, data: any, opts?: JobOptions) => Promise<any>
  close: () => Promise<void>
}

type WorkerLike = {
  close: () => Promise<void>
}

class InMemoryQueue implements QueueLike {
  private jobs: Map<string, { name: string; data: any }> = new Map()
  private autoId = 0
  constructor(public readonly queueName: string) {}

  async add(name: string, data: any, opts?: JobOptions) {
    const id = opts?.jobId || `auto-${++this.autoId}`
    // Skip if job with this ID already exists (idempotency)
    if (this.jobs.has(id)) {
      return { id, name, data, duplicate: true }
    }
    this.jobs.set(id, { name, data })
    return { id, name, data }
  }

  async close() {}
}

// BullMQ requires Redis. In tests (and local envs without Redis), fall back to an in-process
// no-op queue so imports don't try to open network sockets.
const useBullMQ = env.NODE_ENV !== 'test' && Boolean(env.REDIS_URL)

// BullMQ uses its own Redis connections (blocking commands), so pass the URL and let it manage them.
const connection = useBullMQ ? { url: env.REDIS_URL! } : null

// Queue Definitions
const defaultJobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 1000, // 1s, 2s, 4s, 8s, 16s
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1000 },
}

export const emailQueue: QueueLike = useBullMQ
  ? new Queue('email-queue', { connection: connection!, defaultJobOptions })
  : new InMemoryQueue('email-queue')

export const billingQueue: QueueLike = useBullMQ
  ? new Queue('billing-queue', { connection: connection!, defaultJobOptions })
  : new InMemoryQueue('billing-queue')

export const webhookQueue: QueueLike = useBullMQ
  ? new Queue('webhook-queue', { connection: connection!, defaultJobOptions })
  : new InMemoryQueue('webhook-queue')

export const updateEmailQueue: QueueLike = useBullMQ
  ? new Queue('update-email-queue', { connection: connection!, defaultJobOptions })
  : new InMemoryQueue('update-email-queue')

// Worker Factory Helper
export function createWorker<T>(
  queueName: string,
  processor: Processor<T>,
  concurrency = 1
) : WorkerLike {
  if (!useBullMQ) {
    // No background processing in in-memory mode. Routes that need synchronous processing
    // should call processors directly (webhooks already do this in tests).
    return {
      async close() { },
    }
  }

  return new Worker(queueName, processor, {
    connection: connection!,
    concurrency,
    // CRITICAL: Wait 5 seconds before polling again when queue is empty
    // Default is 5ms which burns through Redis quota insanely fast
    drainDelay: 5000,
    // Check for stalled jobs less frequently (default 30s, bump to 60s)
    stalledInterval: 60000,
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
    updateEmailQueue.close(),
  ])
}

// Get queue depths for health monitoring
export async function getQueueDepths(): Promise<{
  email: { waiting: number; active: number; failed: number } | null
  billing: { waiting: number; active: number; failed: number } | null
  webhook: { waiting: number; active: number; failed: number } | null
  updateEmail: { waiting: number; active: number; failed: number } | null
}> {
  if (!useBullMQ) {
    return { email: null, billing: null, webhook: null, updateEmail: null }
  }

  try {
    const getDepth = async (queue: QueueLike) => {
      // BullMQ Queue has getJobCounts method
      const q = queue as Queue
      if (typeof q.getJobCounts === 'function') {
        const counts = await q.getJobCounts('waiting', 'active', 'failed')
        return {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          failed: counts.failed || 0,
        }
      }
      return null
    }

    const [email, billing, webhook, updateEmail] = await Promise.all([
      getDepth(emailQueue),
      getDepth(billingQueue),
      getDepth(webhookQueue),
      getDepth(updateEmailQueue),
    ])

    return { email, billing, webhook, updateEmail }
  } catch (err) {
    console.warn('[queue] Failed to get queue depths:', err)
    return { email: null, billing: null, webhook: null, updateEmail: null }
  }
}
