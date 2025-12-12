// PII Masking Utilities
// Use these to prevent sensitive data from leaking into logs

/**
 * Mask account number, showing only last 4 digits
 * "1234567890" -> "******7890"
 */
export function maskAccountNumber(accountNumber: string | null | undefined): string {
  if (!accountNumber || accountNumber.length < 4) return '****'
  return '*'.repeat(accountNumber.length - 4) + accountNumber.slice(-4)
}

/**
 * Mask SA ID number
 * "9001015026082" -> "******5026082"
 */
export function maskIdNumber(idNumber: string | null | undefined): string {
  if (!idNumber || idNumber.length < 6) return '****'
  return '*'.repeat(idNumber.length - 6) + idNumber.slice(-6)
}

/**
 * Mask email, showing first char and domain
 * "john@example.com" -> "j***@example.com"
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '****'
  const [local, domain] = email.split('@')
  return local[0] + '***@' + domain
}

/**
 * Mask phone number, showing only last 4 digits
 * "+234801234567" -> "********4567"
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 4) return '****'
  return '*'.repeat(phone.length - 4) + phone.slice(-4)
}

/**
 * Create a sanitized version of an object for logging
 * Automatically masks common PII fields
 */
export function sanitizeForLogging(obj: Record<string, any>): Record<string, any> {
  const sensitiveFields = [
    'accountNumber',
    'account_number',
    'idNumber',
    'id_number',
    'document_number',
    'ssn',
    'password',
    'secret',
    'token',
    'authorization_code',
  ]

  const partialMaskFields = [
    'email',
    'phone',
  ]

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase()

    if (sensitiveFields.some(f => lowerKey.includes(f.toLowerCase()))) {
      result[key] = '[REDACTED]'
    } else if (partialMaskFields.some(f => lowerKey.includes(f.toLowerCase())) && typeof value === 'string') {
      result[key] = key.toLowerCase().includes('email') ? maskEmail(value) : maskPhone(value)
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeForLogging(value)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Safe JSON stringify that masks PII
 */
export function safeStringify(obj: Record<string, any>): string {
  return JSON.stringify(sanitizeForLogging(obj))
}
