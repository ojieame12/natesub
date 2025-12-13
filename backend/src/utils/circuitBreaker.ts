/**
 * Simple Circuit Breaker implementation
 * Prevents cascading failures when external services are down
 */

import { logger } from './logger.js'

interface CircuitBreakerOptions {
  name: string
  failureThreshold?: number  // Number of failures before opening circuit
  resetTimeout?: number      // Time in ms before trying again
  timeout?: number           // Request timeout in ms
}

interface CircuitBreakerState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

const circuits = new Map<string, CircuitBreakerState>()

function getState(name: string): CircuitBreakerState {
  if (!circuits.has(name)) {
    circuits.set(name, {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
    })
  }
  return circuits.get(name)!
}

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  options: CircuitBreakerOptions,
  fn: () => Promise<T>
): Promise<T> {
  const {
    name,
    failureThreshold = 5,
    resetTimeout = 30000,  // 30 seconds
    timeout = 10000,       // 10 seconds
  } = options

  const state = getState(name)

  // Check if circuit is open
  if (state.state === 'open') {
    const timeSinceLastFailure = Date.now() - state.lastFailure

    if (timeSinceLastFailure >= resetTimeout) {
      // Transition to half-open - allow one request through
      state.state = 'half-open'
      logger.circuitBreaker.halfOpen(name)
    } else {
      throw new CircuitBreakerError(
        `Service ${name} is temporarily unavailable`,
        name,
        resetTimeout - timeSinceLastFailure
      )
    }
  }

  try {
    // Execute with timeout
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} request timeout`)), timeout)
      ),
    ])

    // Success - reset circuit
    if (state.state === 'half-open') {
      logger.circuitBreaker.closed(name)
    }
    state.failures = 0
    state.state = 'closed'

    return result
  } catch (error) {
    state.failures++
    state.lastFailure = Date.now()

    // Check if we should open the circuit
    if (state.failures >= failureThreshold) {
      state.state = 'open'
      logger.circuitBreaker.opened(name, state.failures)
    } else {
      logger.warn(`Circuit breaker failure`, { name, failures: state.failures, threshold: failureThreshold })
    }

    throw error
  }
}

/**
 * Custom error for circuit breaker
 */
export class CircuitBreakerError extends Error {
  public readonly service: string
  public readonly retryAfterMs: number

  constructor(message: string, service: string, retryAfterMs: number) {
    super(message)
    this.name = 'CircuitBreakerError'
    this.service = service
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Get the current state of a circuit (for monitoring)
 */
export function getCircuitState(name: string): CircuitBreakerState | undefined {
  return circuits.get(name)
}

/**
 * Manually reset a circuit (for admin use)
 */
export function resetCircuit(name: string): void {
  const state = getState(name)
  state.failures = 0
  state.state = 'closed'
  logger.info('Circuit breaker manually reset', { name })
}

// Pre-configured circuit breakers for common services
export const stripeCircuitBreaker = <T>(fn: () => Promise<T>) =>
  withCircuitBreaker({ name: 'stripe', failureThreshold: 5, resetTimeout: 60000 }, fn)

export const paystackCircuitBreaker = <T>(fn: () => Promise<T>) =>
  withCircuitBreaker({ name: 'paystack', failureThreshold: 5, resetTimeout: 60000 }, fn)

export const emailCircuitBreaker = <T>(fn: () => Promise<T>) =>
  withCircuitBreaker({ name: 'email', failureThreshold: 3, resetTimeout: 120000 }, fn)
