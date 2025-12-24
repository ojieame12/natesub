import { PrismaClient, Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Neon serverless Postgres configuration
// Neon aggressively closes idle connections, so we need to:
// 1. Use shorter connection timeout
// 2. Keep pool small to avoid "too many connections"
// 3. Handle connection retries gracefully
const createPrismaClient = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasourceUrl: process.env.DATABASE_URL,
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

// Prisma will auto-connect on first query, no need to eagerly connect
// Eager connection can cause issues with Neon's cold start

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

// Graceful shutdown - only disconnect if process is actually exiting
let isShuttingDown = false

const gracefulShutdown = async () => {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log('[db] Graceful shutdown initiated')
  await db.$disconnect()
}

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

// Utility for retrying transient Neon connection errors
const RETRYABLE_ERROR_CODES = [
  'P2024', // Timed out fetching a connection
  'P2010', // Raw query failed (can include connection issues)
]

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 2,
  delayMs = 100
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      // Check if error is retryable
      const isRetryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        RETRYABLE_ERROR_CODES.includes(error.code)

      // Also retry on connection closed errors
      const isConnectionClosed =
        error instanceof Error &&
        (error.message.includes('kind: Closed') ||
          error.message.includes('Connection closed') ||
          error.message.includes('connection was closed'))

      if ((isRetryable || isConnectionClosed) && attempt < maxRetries) {
        console.warn(`[db] Retrying after transient error (attempt ${attempt + 1}/${maxRetries}):`, (error as Error).message)
        await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)))
        continue
      }

      throw error
    }
  }

  throw lastError
}
