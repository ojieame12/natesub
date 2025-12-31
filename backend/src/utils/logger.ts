/**
 * Structured Logging Utility
 * Provides consistent JSON logging in production for log aggregation
 * Automatically sanitizes PII (emails, phone numbers, account numbers)
 */

import { env } from '../config/env.js'
import { sanitizeForLogging, maskEmail, maskPhone } from './pii.js'

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

/**
 * Sanitize a value that might contain PII
 */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    // Check if it looks like an email
    if (value.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return maskEmail(value)
    }
    // Check if it looks like a phone number (starts with + or has 10+ digits)
    if (/^\+?\d{10,}$/.test(value.replace(/[\s-]/g, ''))) {
      return maskPhone(value)
    }
    return value
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(sanitizeValue)
    }
    return sanitizeForLogging(value as Record<string, unknown>)
  }
  return value
}

function formatLog(level: LogLevel, message: string, context?: LogContext, error?: Error): string {
  const log: StructuredLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
  }

  // Sanitize context to remove/mask PII
  if (context && Object.keys(context).length > 0) {
    log.context = sanitizeForLogging(context) as LogContext
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

// ============================================
// Safe Error Response Utilities
// ============================================

/**
 * Safe error codes for client responses
 * Use these instead of exposing raw error messages
 */
export const ErrorCodes = {
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Payment
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_PROVIDER_ERROR: 'PAYMENT_PROVIDER_ERROR',
  SUBSCRIPTION_ERROR: 'SUBSCRIPTION_ERROR',
  PAYOUT_FAILED: 'PAYOUT_FAILED',

  // Jobs
  JOB_FAILED: 'JOB_FAILED',
  QUEUE_ERROR: 'QUEUE_ERROR',

  // AI
  AI_SERVICE_ERROR: 'AI_SERVICE_ERROR',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',

  // Email
  EMAIL_FAILED: 'EMAIL_FAILED',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * Safe error messages that can be shown to clients
 */
const SAFE_ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCodes.INTERNAL_ERROR]: 'An unexpected error occurred. Please try again.',
  [ErrorCodes.INVALID_REQUEST]: 'Invalid request. Please check your input.',
  [ErrorCodes.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCodes.UNAUTHORIZED]: 'Authentication required.',
  [ErrorCodes.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCodes.RATE_LIMITED]: 'Too many requests. Please try again later.',
  [ErrorCodes.VALIDATION_ERROR]: 'Invalid input. Please check your data.',
  [ErrorCodes.PAYMENT_FAILED]: 'Payment processing failed. Please try again.',
  [ErrorCodes.PAYMENT_PROVIDER_ERROR]: 'Payment service temporarily unavailable.',
  [ErrorCodes.SUBSCRIPTION_ERROR]: 'Subscription operation failed.',
  [ErrorCodes.PAYOUT_FAILED]: 'Payout processing failed.',
  [ErrorCodes.JOB_FAILED]: 'Operation failed. Please try again.',
  [ErrorCodes.QUEUE_ERROR]: 'Service temporarily unavailable.',
  [ErrorCodes.AI_SERVICE_ERROR]: 'AI service temporarily unavailable.',
  [ErrorCodes.AI_RATE_LIMITED]: 'AI service rate limit reached. Try again later.',
  [ErrorCodes.EMAIL_FAILED]: 'Failed to send email.',
}

/**
 * Get a safe error message for client response
 */
export function getSafeErrorMessage(code: ErrorCode): string {
  return SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES[ErrorCodes.INTERNAL_ERROR]
}

/**
 * Create a safe error response for API endpoints
 * Logs full error details server-side, returns safe message to client
 *
 * @example
 * try {
 *   await riskyOperation()
 * } catch (err) {
 *   return c.json(safeError('PAYMENT_FAILED', err, 'stripe'), 500)
 * }
 */
export function safeError(
  code: ErrorCode,
  error: unknown,
  source?: string
): { error: string; code: ErrorCode } {
  const errorDetail = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined
  const prefix = source ? `[${source}]` : ''

  // Log full details server-side
  logger.error(`${prefix} ${code}: ${errorDetail}`, error instanceof Error ? error : undefined)

  // Return safe message to client
  return {
    error: getSafeErrorMessage(code),
    code,
  }
}

/**
 * Email logging helper - always masks the email address
 */
export function logEmail(action: string, email: string, context?: LogContext): void {
  logger.info(`Email ${action} to ${maskEmail(email)}`, context)
}

/**
 * Log an email send event with proper masking
 */
export function logEmailSent(type: string, email: string, context?: LogContext): void {
  logEmail(`${type} sent`, email, context)
}

/**
 * Log an email failure with proper masking
 */
export function logEmailFailed(type: string, email: string, error: unknown, context?: LogContext): void {
  const errorMsg = error instanceof Error ? error.message : String(error)
  logger.error(`Email ${type} failed to ${maskEmail(email)}: ${errorMsg}`, error instanceof Error ? error : undefined, context)
}
