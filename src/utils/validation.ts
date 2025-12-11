/**
 * Validation utilities for forms and inputs
 */

import { isReservedUsername } from './constants'

// Email validation
export const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// Phone validation (accepts various formats)
export const isValidPhone = (phone: string): boolean => {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

// Format phone number for display (US format)
export const formatPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone
}

// Username validation (format only)
export const isValidUsernameFormat = (username: string): boolean => {
  return /^[a-z0-9_]{3,20}$/.test(username)
}

// Full username validation (format + not reserved)
export const isValidUsername = (username: string): boolean => {
  return isValidUsernameFormat(username) && !isReservedUsername(username)
}

// Check if username is available (for UI feedback)
export const getUsernameError = (username: string): string | null => {
  if (!username) return null
  if (username.length < 3) return 'Username must be at least 3 characters'
  if (username.length > 20) return 'Username must be 20 characters or less'
  if (!/^[a-z0-9_]+$/.test(username)) return 'Only lowercase letters, numbers, and underscores'
  if (isReservedUsername(username)) return 'This username is not available'
  return null
}

// Amount validation
export const isValidAmount = (amount: number): boolean => {
  return amount > 0 && amount <= 10000 && Number.isFinite(amount)
}

// Parse amount from string input
export const parseAmount = (value: string): number | null => {
  const cleaned = value.replace(/[^0-9.]/g, '')
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? null : parsed
}

// Format amount for display
export const formatAmount = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

// URL validation
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

// Name validation (at least 2 characters, no numbers)
export const isValidName = (name: string): boolean => {
  return name.trim().length >= 2 && !/\d/.test(name)
}

// Bio/description validation
export const isValidBio = (bio: string, maxLength = 500): boolean => {
  return bio.trim().length <= maxLength
}

// Consolidated validators object
export const validators = {
  email: isValidEmail,
  phone: isValidPhone,
  username: isValidUsername,
  amount: isValidAmount,
  url: isValidUrl,
  name: isValidName,
  bio: isValidBio,
} as const

// Validation error messages
export const errorMessages = {
  email: 'Please enter a valid email address',
  phone: 'Please enter a valid phone number',
  username: 'Username must be 3-20 characters (lowercase, numbers, underscores)',
  usernameReserved: 'This username is not available',
  amount: 'Please enter a valid amount between $1 and $10,000',
  url: 'Please enter a valid URL',
  name: 'Please enter a valid name',
  bio: 'Bio is too long',
  required: 'This field is required',
} as const

export default validators
