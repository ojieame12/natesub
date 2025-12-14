import { describe, expect, it } from 'vitest'
import {
  formatAmount,
  formatPhone,
  getUsernameError,
  isValidAmount,
  isValidBio,
  isValidEmail,
  isValidName,
  isValidPhone,
  isValidUrl,
  isValidUsername,
  isValidUsernameFormat,
  parseAmount,
} from './validation'

describe('utils/validation', () => {
  it('validates emails (trim-aware)', () => {
    expect(isValidEmail('test@example.com')).toBe(true)
    expect(isValidEmail(' test@example.com ')).toBe(true)
    expect(isValidEmail('nope@')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })

  it('validates phones by digit count', () => {
    expect(isValidPhone('+1 (555) 123-4567')).toBe(true)
    expect(isValidPhone('5551234567')).toBe(true)
    expect(isValidPhone('123')).toBe(false)
    expect(isValidPhone('1234567890123456')).toBe(false)
  })

  it('formats US phone numbers', () => {
    expect(formatPhone('5551234567')).toBe('(555) 123-4567')
    expect(formatPhone('15551234567')).toBe('+1 (555) 123-4567')
    // Non-US / unknown lengths: return input
    expect(formatPhone('+234 803 000 0000')).toBe('+234 803 000 0000')
  })

  it('validates username format and reserved words', () => {
    expect(isValidUsernameFormat('abc')).toBe(true)
    expect(isValidUsernameFormat('Abc')).toBe(false) // lowercase only
    expect(isValidUsernameFormat('a')).toBe(false)
    expect(isValidUsernameFormat('a'.repeat(21))).toBe(false)
    expect(isValidUsernameFormat('has-dash')).toBe(false)

    // Reserved usernames are invalid even if format is valid
    expect(isValidUsername('dashboard')).toBe(false)
    expect(isValidUsername('my_name')).toBe(true)
  })

  it('returns user-friendly username errors', () => {
    expect(getUsernameError('')).toBe(null)
    expect(getUsernameError('ab')).toBe('Username must be at least 3 characters')
    expect(getUsernameError('a'.repeat(21))).toBe('Username must be 20 characters or less')
    expect(getUsernameError('HasCaps')).toBe('Only lowercase letters, numbers, and underscores')
    expect(getUsernameError('dashboard')).toBe('This username is not available')
    expect(getUsernameError('good_name')).toBe(null)
  })

  it('validates amounts and parses numeric inputs', () => {
    expect(isValidAmount(1)).toBe(true)
    expect(isValidAmount(0)).toBe(false)
    expect(isValidAmount(10001)).toBe(false)
    expect(isValidAmount(Infinity)).toBe(false)

    expect(parseAmount('$1,234.50')).toBe(1234.5)
    expect(parseAmount('abc')).toBe(null)
  })

  it('formats amounts as currency', () => {
    expect(formatAmount(10)).toBe('$10')
    expect(formatAmount(10.5)).toBe('$10.5')
    expect(formatAmount(10.55)).toBe('$10.55')
  })

  it('validates URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true)
    expect(isValidUrl('not a url')).toBe(false)
  })

  it('validates names and bios', () => {
    expect(isValidName('A')).toBe(false)
    expect(isValidName('A1')).toBe(false)
    expect(isValidName('Alex')).toBe(true)

    expect(isValidBio('a'.repeat(500))).toBe(true)
    expect(isValidBio('a'.repeat(501))).toBe(false)
    expect(isValidBio('a'.repeat(10), 8)).toBe(false)
  })
})

