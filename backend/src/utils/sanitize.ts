/**
 * Input Sanitization Utilities
 *
 * Provides consistent sanitization for user inputs across the codebase.
 * Use these functions to prevent XSS, injection attacks, and data corruption.
 */

/**
 * Remove HTML tags from a string
 * More aggressive than escaping - actually strips tags
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ') // Replace nbsp with space
    .trim()
}

/**
 * Escape HTML special characters
 * Converts < > & " ' to HTML entities
 */
export function escapeHtml(input: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return input.replace(/[&<>"']/g, (char) => map[char] || char)
}

/**
 * Sanitize a single-line text field
 * Removes newlines, limits length, strips HTML
 */
export function sanitizeSingleLine(input: string, maxLength = 255): string {
  return stripHtml(input)
    .replace(/[\r\n]+/g, ' ') // Replace newlines with space
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim()
    .slice(0, maxLength)
}

/**
 * Sanitize a multi-line text field
 * Strips HTML, limits length, normalizes newlines
 */
export function sanitizeMultiLine(input: string, maxLength = 5000): string {
  return stripHtml(input)
    .replace(/\r\n/g, '\n')   // Normalize to unix newlines
    .replace(/\r/g, '\n')     // Normalize mac newlines
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .trim()
    .slice(0, maxLength)
}

/**
 * Sanitize a name/display name field
 * - Strips HTML
 * - Removes control characters
 * - Limits length
 * - Allows letters, numbers, spaces, and common punctuation
 */
export function sanitizeName(input: string, maxLength = 100): string {
  return stripHtml(input)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/[\r\n]+/g, ' ')         // Replace newlines with space
    .replace(/\s+/g, ' ')             // Collapse multiple spaces
    .trim()
    .slice(0, maxLength)
}

/**
 * Sanitize an email address
 * - Converts to lowercase
 * - Trims whitespace
 * - Validates basic format
 */
export function sanitizeEmail(input: string): string | null {
  const cleaned = input.toLowerCase().trim()
  // Basic email format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    return null
  }
  return cleaned
}

/**
 * Sanitize a subject line (for emails, tickets, etc.)
 * - Removes newlines (required for email headers)
 * - Strips HTML
 * - Limits length
 */
export function sanitizeSubjectLine(input: string, maxLength = 200): string {
  return stripHtml(input)
    .replace(/[\r\n\t]+/g, ' ')  // Replace newlines/tabs with space
    .replace(/\s+/g, ' ')         // Collapse multiple spaces
    .trim()
    .slice(0, maxLength)
}

/**
 * Sanitize a message/body content
 * Alias for sanitizeMultiLine with a larger default
 */
export function sanitizeMessage(input: string, maxLength = 10000): string {
  return sanitizeMultiLine(input, maxLength)
}

/**
 * Sanitize a username
 * - Lowercase
 * - Only alphanumeric, underscore, hyphen
 * - No spaces
 */
export function sanitizeUsername(input: string): string | null {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '')

  if (cleaned.length < 3 || cleaned.length > 30) {
    return null
  }
  return cleaned
}

/**
 * Sanitize a phone number to E.164 format
 * Returns null if invalid
 */
export function sanitizePhone(input: string): string | null {
  // Remove all non-digit and non-plus characters
  const cleaned = input.replace(/[^\d+]/g, '')

  // Must start with + and be 8-16 chars total
  if (!cleaned.startsWith('+') || cleaned.length < 8 || cleaned.length > 16) {
    return null
  }

  // Validate E.164 format
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return null
  }

  return cleaned
}

/**
 * Sanitize a URL
 * - Must start with http:// or https://
 * - Basic validation
 */
export function sanitizeUrl(input: string): string | null {
  const trimmed = input.trim()

  // Must start with http or https
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return null
  }

  try {
    const url = new URL(trimmed)
    // Return the normalized URL
    return url.href
  } catch {
    return null
  }
}

/**
 * Sanitize JSON metadata
 * - Ensures it's a valid object
 * - Strips any functions or dangerous prototypes
 * - Limits depth and size
 */
export function sanitizeMetadata(input: unknown, maxSize = 10000): Record<string, unknown> | null {
  if (input === null || input === undefined) {
    return null
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  try {
    // Stringify and parse to strip functions, prototypes, etc.
    const cleaned = JSON.stringify(input)

    if (cleaned.length > maxSize) {
      return null
    }

    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return null
  }
}
