/**
 * One-time migration script to promote hardcoded admin emails to super_admin role.
 *
 * Run with: npx tsx scripts/migrate-admin-roles.ts
 *
 * This script should be run once after deploying the UserRole schema change.
 * It's safe to run multiple times - it's idempotent.
 */

import { db } from '../src/db/client.js'

// These are the emails that were hardcoded in config/admin.ts
const LEGACY_ADMIN_EMAILS = [
  'nathan@insitepro.co',
]

async function migrateAdminRoles() {
  console.log('Starting admin role migration...')
  console.log(`Promoting ${LEGACY_ADMIN_EMAILS.length} legacy admin(s) to super_admin role`)

  for (const email of LEGACY_ADMIN_EMAILS) {
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, role: true },
    })

    if (!user) {
      console.log(`⚠️  User not found: ${email}`)
      continue
    }

    if (user.role === 'super_admin') {
      console.log(`✓  Already super_admin: ${email}`)
      continue
    }

    await db.user.update({
      where: { id: user.id },
      data: { role: 'super_admin' },
    })

    console.log(`✓  Promoted to super_admin: ${email} (was: ${user.role})`)
  }

  // Log current admin counts
  const adminCounts = await db.user.groupBy({
    by: ['role'],
    _count: true,
  })

  console.log('\nCurrent role distribution:')
  for (const { role, _count } of adminCounts) {
    console.log(`  ${role}: ${_count}`)
  }

  console.log('\nMigration complete!')
}

migrateAdminRoles()
  .catch(console.error)
  .finally(() => db.$disconnect())
