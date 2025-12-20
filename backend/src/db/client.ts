import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  // Neon serverless Postgres connection settings
  datasourceUrl: process.env.DATABASE_URL,
})

// Handle Neon connection drops by reconnecting on startup
db.$connect().catch((err) => {
  console.error('[db] Initial connection failed, will retry on first query:', err.message)
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await db.$disconnect()
})
