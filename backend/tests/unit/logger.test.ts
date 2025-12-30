/**
 * Logger Unit Tests
 *
 * Tests for the structured logger utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Spy on console methods before importing logger
const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
}

// Import logger after setting up spies
import { logger } from '../../src/utils/logger.js'

describe('structured logger', () => {
  beforeEach(() => {
    consoleSpy.log.mockClear()
    consoleSpy.warn.mockClear()
    consoleSpy.error.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('core methods', () => {
    it('logs info messages', () => {
      logger.info('Test info message')

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('Test info message')
      expect(output).toContain('INFO')
    })

    it('logs info with context', () => {
      logger.info('Test with context', { userId: 'user-123', subscriptionId: 'sub-456' })

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('Test with context')
      expect(output).toContain('user-123')
      expect(output).toContain('sub-456')
    })

    it('logs warn messages', () => {
      logger.warn('Test warning')

      expect(consoleSpy.warn).toHaveBeenCalled()
      const output = consoleSpy.warn.mock.calls[0][0]
      expect(output).toContain('Test warning')
      expect(output).toContain('WARN')
    })

    it('logs error messages', () => {
      const error = new Error('Test error')
      logger.error('Something failed', error)

      expect(consoleSpy.error).toHaveBeenCalled()
      const output = consoleSpy.error.mock.calls[0][0]
      expect(output).toContain('Something failed')
      expect(output).toContain('ERROR')
      expect(output).toContain('Test error')
    })

    it('logs error with context', () => {
      const error = new Error('Processing failed')
      logger.error('Webhook failed', error, { provider: 'stripe', eventType: 'charge.failed' })

      expect(consoleSpy.error).toHaveBeenCalled()
      const output = consoleSpy.error.mock.calls[0][0]
      expect(output).toContain('Webhook failed')
      expect(output).toContain('stripe')
    })

    it('logs error without error object', () => {
      logger.error('Error without exception', null, { reason: 'validation' })

      expect(consoleSpy.error).toHaveBeenCalled()
      const output = consoleSpy.error.mock.calls[0][0]
      expect(output).toContain('Error without exception')
      expect(output).toContain('validation')
    })
  })

  describe('webhook methods', () => {
    it('logs webhook.received', () => {
      logger.webhook.received('stripe', 'charge.succeeded', 'evt_123')

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('stripe')
      expect(output).toContain('charge.succeeded')
      expect(output).toContain('evt_123')
    })

    it('logs webhook.processed with duration', () => {
      logger.webhook.processed('paystack', 'charge.success', 'ps_123', 150)

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('paystack')
      expect(output).toContain('150')
    })

    it('logs webhook.failed', () => {
      const error = new Error('Processing error')
      logger.webhook.failed('stripe', 'invoice.paid', 'evt_456', error)

      expect(consoleSpy.error).toHaveBeenCalled()
      const output = consoleSpy.error.mock.calls[0][0]
      expect(output).toContain('stripe')
      expect(output).toContain('invoice.paid')
      expect(output).toContain('Processing error')
    })

    it('logs webhook.skipped', () => {
      logger.webhook.skipped('stripe', 'customer.created', 'evt_789', 'Not relevant')

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('stripe')
      expect(output).toContain('Not relevant')
    })
  })

  describe('payment methods', () => {
    it('logs payment.created', () => {
      logger.payment.created('sub_123', 1000, 'USD', 'stripe')

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('sub_123')
      expect(output).toContain('1000')
      expect(output).toContain('USD')
    })

    it('logs payment.failed', () => {
      logger.payment.failed('sub_456', 'Card declined', 'stripe')

      // payment.failed uses warn level, not error
      expect(consoleSpy.warn).toHaveBeenCalled()
      const output = consoleSpy.warn.mock.calls[0][0]
      expect(output).toContain('sub_456')
      expect(output).toContain('Card declined')
    })

    it('logs payment.refunded', () => {
      logger.payment.refunded('sub_789', 500, 'USD')

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('sub_789')
      expect(output).toContain('500')
    })
  })

  describe('child logger', () => {
    it('preserves base context across calls', () => {
      const reqLogger = logger.child({ requestId: 'req-abc', userId: 'user-xyz' })
      reqLogger.info('First message')
      reqLogger.info('Second message')

      expect(consoleSpy.log).toHaveBeenCalledTimes(2)
      expect(consoleSpy.log.mock.calls[0][0]).toContain('req-abc')
      expect(consoleSpy.log.mock.calls[0][0]).toContain('user-xyz')
      expect(consoleSpy.log.mock.calls[1][0]).toContain('req-abc')
      expect(consoleSpy.log.mock.calls[1][0]).toContain('user-xyz')
    })

    it('allows adding context to child logger calls', () => {
      const reqLogger = logger.child({ requestId: 'req-123' })
      reqLogger.info('Event received', { eventType: 'test' })

      expect(consoleSpy.log).toHaveBeenCalled()
      const output = consoleSpy.log.mock.calls[0][0]
      expect(output).toContain('req-123')
      expect(output).toContain('test')
    })
  })
})
