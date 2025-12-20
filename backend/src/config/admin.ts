/**
 * Admin Configuration
 *
 * Single source of truth for admin access control.
 * Add admin emails here - they will have access to all admin endpoints.
 */

export const ADMIN_EMAILS = [
  'nathan@insitepro.co',
]

/**
 * Check if an email has admin access
 */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}
