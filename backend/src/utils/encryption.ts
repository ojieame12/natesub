// Encryption utilities for sensitive data (PII)
// Uses AES-256-GCM for authenticated encryption

import crypto from 'crypto'
import { env } from '../config/env.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // 128 bits
const AUTH_TAG_LENGTH = 16 // 128 bits
const SALT_LENGTH = 32 // 256 bits

// Check if encryption is enabled
function isEncryptionEnabled(): boolean {
  return !!env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32
}

/**
 * Validate encryption configuration at startup
 * Throws if ENCRYPTION_KEY is missing or too short in production
 */
export function validateEncryptionConfig(): void {
  if (env.NODE_ENV === 'production') {
    if (!env.ENCRYPTION_KEY) {
      throw new Error('[FATAL] ENCRYPTION_KEY environment variable is required in production')
    }
    if (env.ENCRYPTION_KEY.length < 32) {
      throw new Error('[FATAL] ENCRYPTION_KEY must be at least 32 characters in production')
    }
    console.log('✅ Encryption configuration validated')
  } else if (!isEncryptionEnabled()) {
    console.warn('⚠️ ENCRYPTION_KEY not set - PII will be stored unencrypted (acceptable for development)')
  }
}

// Check if a string is valid hex
function isHexString(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str)
}

// Derive a 32-byte key from the encryption secret
// Supports both hex-encoded keys (from `openssl rand -hex 32`) and arbitrary secrets
function getKey(): Buffer {
  const secret = env.ENCRYPTION_KEY
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters')
  }

  // If the secret is exactly 64 hex characters, decode it as hex (32 bytes)
  // This is the expected format from `openssl rand -hex 32`
  if (secret.length === 64 && isHexString(secret)) {
    return Buffer.from(secret, 'hex')
  }

  // For other formats, use SHA-256 to derive a consistent 32-byte key
  // This ensures full entropy regardless of input format
  return crypto.createHash('sha256').update(secret).digest()
}

// Legacy key derivation for backward compatibility with existing encrypted data
// This was the original (less secure) method that sliced the first 32 chars as UTF-8
function getLegacyKey(): Buffer {
  const secret = env.ENCRYPTION_KEY
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters')
  }
  return Buffer.from(secret.slice(0, 32), 'utf8')
}

/**
 * Encrypt a string value
 * Returns: iv:authTag:encryptedData (all base64)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return ''

  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:encryptedData
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

// Helper to attempt decryption with a specific key
function tryDecryptWithKey(encrypted: string, key: Buffer): string | null {
  const [ivBase64, authTagBase64, encryptedData] = encrypted.split(':')

  if (!ivBase64 || !authTagBase64 || !encryptedData) {
    return null
  }

  try {
    const iv = Buffer.from(ivBase64, 'base64')
    const authTag = Buffer.from(authTagBase64, 'base64')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedData, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch {
    return null
  }
}

/**
 * Decrypt a string value
 * Expects format: iv:authTag:encryptedData (all base64)
 * Tries new key derivation first, falls back to legacy for backward compatibility
 */
export function decrypt(encrypted: string): string {
  if (!encrypted || !encrypted.includes(':')) return encrypted

  const [ivBase64, authTagBase64, encryptedData] = encrypted.split(':')

  if (!ivBase64 || !authTagBase64 || !encryptedData) {
    // Return as-is if not in expected format (backwards compatibility)
    return encrypted
  }

  // Try with new (proper) key derivation first
  const newKey = getKey()
  const result = tryDecryptWithKey(encrypted, newKey)
  if (result !== null) {
    return result
  }

  // Fall back to legacy key for data encrypted with old method
  try {
    const legacyKey = getLegacyKey()
    // Only try legacy if keys are different
    if (!newKey.equals(legacyKey)) {
      const legacyResult = tryDecryptWithKey(encrypted, legacyKey)
      if (legacyResult !== null) {
        console.warn('[encryption] Decrypted with legacy key - consider re-encrypting data')
        return legacyResult
      }
    }
  } catch {
    // Legacy key derivation failed, ignore
  }

  // If both fail, return original (might be unencrypted legacy data)
  console.warn('[encryption] Failed to decrypt with both keys, returning original value')
  return encrypted
}

/**
 * Check if a value is encrypted (has our format)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false
  const parts = value.split(':')
  return parts.length === 3 && parts[0].length > 10 // Basic format check
}

/**
 * Encrypt account number if not already encrypted
 * Returns original if encryption is not enabled (backwards compatibility)
 */
export function encryptAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber) return null
  if (!isEncryptionEnabled()) {
    console.warn('[encryption] ENCRYPTION_KEY not set - storing account number unencrypted')
    return accountNumber
  }
  if (isEncrypted(accountNumber)) return accountNumber
  return encrypt(accountNumber)
}

/**
 * Decrypt account number
 * Returns original if not encrypted or encryption is not enabled
 */
export function decryptAccountNumber(encrypted: string | null): string | null {
  if (!encrypted) return null
  if (!isEncryptionEnabled()) return encrypted
  return decrypt(encrypted)
}

/**
 * Encrypt authorization code (for recurring payments)
 * Returns original if encryption is not enabled (backwards compatibility)
 */
export function encryptAuthorizationCode(authCode: string | null): string | null {
  if (!authCode) return null
  if (!isEncryptionEnabled()) {
    console.warn('[encryption] ENCRYPTION_KEY not set - storing auth code unencrypted')
    return authCode
  }
  if (isEncrypted(authCode)) return authCode
  return encrypt(authCode)
}

/**
 * Decrypt authorization code
 * Returns original if not encrypted or encryption is not enabled
 */
export function decryptAuthorizationCode(encrypted: string | null): string | null {
  if (!encrypted) return null
  if (!isEncryptionEnabled()) return encrypted
  return decrypt(encrypted)
}
