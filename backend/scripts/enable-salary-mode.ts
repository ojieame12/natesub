import { db } from '../src/db/client.js'

async function main() {
  // Find creators with Stripe accounts
  const creators = await db.profile.findMany({
    where: { stripeAccountId: { not: null } },
    select: {
      userId: true,
      username: true,
      displayName: true,
      stripeAccountId: true,
      salaryModeEnabled: true,
      preferredPayday: true,
      paydayAlignmentUnlocked: true,
      totalSuccessfulPayments: true,
    },
    take: 5,
  })

  console.log('Creators with Stripe accounts:')
  console.log(JSON.stringify(creators, null, 2))

  if (creators.length === 0) {
    console.log('No creators with Stripe accounts found.')
    return
  }

  // Pick the first one to enable Salary Mode
  const testCreator = creators[0]
  console.log(`\nEnabling Salary Mode for: ${testCreator.displayName} (@${testCreator.username})`)

  // Enable Salary Mode with payday 1 (edge case)
  const updated = await db.profile.update({
    where: { userId: testCreator.userId },
    data: {
      paydayAlignmentUnlocked: true,
      salaryModeEnabled: true,
      preferredPayday: 1, // Edge case: 1st of month
      totalSuccessfulPayments: 2, // Ensure unlock threshold met
    },
    select: {
      username: true,
      salaryModeEnabled: true,
      preferredPayday: true,
      paydayAlignmentUnlocked: true,
      totalSuccessfulPayments: true,
    },
  })

  console.log('\nUpdated profile:')
  console.log(JSON.stringify(updated, null, 2))
  console.log('\nSalary Mode enabled! Now create a test subscription to verify billing_cycle_anchor.')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
