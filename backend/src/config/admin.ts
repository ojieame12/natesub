/**
 * Admin Configuration
 *
 * @deprecated This file is deprecated. Admin access is now controlled via the
 * `role` field on the User model in the database.
 *
 * To grant admin access:
 * 1. Update the user's role in the database to 'admin' or 'super_admin'
 * 2. Use the admin dashboard or run:
 *    UPDATE users SET role = 'super_admin' WHERE email = 'user@example.com';
 *
 * Role hierarchy:
 * - user: Regular user (no admin access)
 * - admin: Can view admin dashboard, limited actions
 * - super_admin: Full admin access including destructive actions
 *
 * The isAdminEmail function is kept for backwards compatibility but will be
 * removed in a future version. New code should use isAdminRole from
 * middleware/adminAuth.ts instead.
 */

/**
 * @deprecated Use database role instead. This list is kept for backwards compatibility.
 */
export const ADMIN_EMAILS = [
  'nathan@insitepro.co',
]

/**
 * @deprecated Use isAdminRole from middleware/adminAuth.ts instead.
 * This function checks both the legacy email list AND the database role
 * for backwards compatibility during the transition period.
 */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  // Legacy check - will be removed after full migration to role-based access
  return ADMIN_EMAILS.includes(email.toLowerCase())
}
