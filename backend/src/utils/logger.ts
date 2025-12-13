/**
 * Structured Logging Utility
 * Provides consistent JSON logging in production for log aggregation
 */

import { env } from '../config/env.js'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  requestId?: string
  userId?: string
  creatorId?: string
  subscriptionId?: string
  provider?: 'stripe' | 'paystack'
  eventType?: string
  duration?: number
  [key: string]: unknown
}

interface StructuredLog {
  timestamp: string
  level: LogLevel
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Minimum log level based on environment
const MIN_LEVEL: LogLevel = env.NODE_ENV === 'production' ? 'info' : 'debug'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL]
}

function formatLog(level: LogLevel, message: string, context?: LogContext, error?: Error): string {
  const log: StructuredLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
  }

  if (context && Object.keys(context).length > 0) {
    log.context = context
  }

  if (error) {
    log.error = {
      name: error.name,
      message: error.message,
      stack: env.NODE_ENV !== 'production' ? error.stack : undefined,
    }
  }

  // In production, output JSON for log aggregators
  // In development, output formatted logs for readability
  if (env.NODE_ENV === 'production') {
    return JSON.stringify(log)
  }

  // Development format: [timestamp] LEVEL message {context}
  const contextStr = context ? ` ${JSON.stringify(context)}` : ''
  const errorStr = error ? ` | Error: ${error.message}` : ''
  return `[${log.timestamp}] ${level.toUpperCase()} ${message}${contextStr}${errorStr}`
}

function logMessage(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
  if (!shouldLog(level)) return

  const formatted = formatLog(level, message, context, error)

  switch (level) {
    case 'debug':
    case 'info':
      console.log(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    case 'error':
      console.error(formatted)
      break
  }
}

/**
 * Logger instance with structured logging methods
 */
export const logger = {
  debug(message: string, context?: LogContext): void {
    logMessage('debug', message, context)
  },

  info(message: string, context?: LogContext): void {
    logMessage('info', message, context)
  },

  warn(message: string, context?: LogContext): void {
    logMessage('warn', message, context)
  },

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const err = error instanceof Error ? error : undefined
    logMessage('error', message, context, err)
  },

  /**
   * Create a child logger with preset context
   * Useful for request-scoped logging
   */
  child(baseContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) =>
        logMessage('debug', message, { ...baseContext, ...context }),
      info: (message: string, context?: LogContext) =>
        logMessage('info', message, { ...baseContext, ...context }),
      warn: (message: string, context?: LogContext) =>
        logMessage('warn', message, { ...baseContext, ...context }),
      error: (message: string, error?: Error | unknown, context?: LogContext) =>
        logMessage('error', message, { ...baseContext, ...context }, error instanceof Error ? error : undefined),
    }
  },

  /**
   * Log webhook processing events
   */
  webhook: {
    received(provider: 'stripe' | 'paystack', eventType: string, eventId: string): void {
      logMessage('info', 'Webhook received', { provider, eventType, eventId: eventId })
    },

    processed(provider: 'stripe' | 'paystack', eventType: string, eventId: string, duration: number): void {
      logMessage('info', 'Webhook processed', { provider, eventType, eventId, duration })
    },

    failed(provider: 'stripe' | 'paystack', eventType: string, eventId: string, error: Error): void {
      logMessage('error', 'Webhook processing failed', { provider, eventType, eventId }, error)
    },

    skipped(provider: 'stripe' | 'paystack', eventType: string, eventId: string, reason: string): void {
      logMessage('info', 'Webhook skipped', { provider, eventType, eventId, reason })
    },
  },

  /**
   * Log payment events
   */
  payment: {
    created(subscriptionId: string, amount: number, currency: string, provider: 'stripe' | 'paystack'): void {
      logMessage('info', 'Payment created', { subscriptionId, amount, currency, provider })
    },

    failed(subscriptionId: string, reason: string, provider: 'stripe' | 'paystack'): void {
      logMessage('warn', 'Payment failed', { subscriptionId, reason, provider })
    },

    refunded(subscriptionId: string, amount: number, currency: string): void {
      logMessage('info', 'Payment refunded', { subscriptionId, amount, currency })
    },
  },

  /**
   * Log payout events
   */
  payout: {
    initiated(creatorId: string, amount: number, currency: string, reference: string): void {
      logMessage('info', 'Payout initiated', { creatorId, amount, currency, reference })
    },

    completed(creatorId: string, amount: number, reference: string): void {
      logMessage('info', 'Payout completed', { creatorId, amount, reference })
    },

    failed(creatorId: string, amount: number, reference: string, reason: string): void {
      logMessage('error', 'Payout failed', { creatorId, amount, reference, reason })
    },
  },

  /**
   * Log circuit breaker events
   */
  circuitBreaker: {
    opened(name: string, failureCount: number): void {
      logMessage('warn', 'Circuit breaker opened', { name, failureCount })
    },

    halfOpen(name: string): void {
      logMessage('info', 'Circuit breaker half-open', { name })
    },

    closed(name: string): void {
      logMessage('info', 'Circuit breaker closed', { name })
    },
  },
}

export type Logger = typeof logger
