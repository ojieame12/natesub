/**
 * Fix reportingGrossCents for Legacy Payments
 *
 * Standalone script that doesn't import from main app (bypasses PAYMENTS_MODE check).
 * Fixes payments where reportingGrossCents is null but amountCents exists.
 *
 * Run: railway run npx tsx scripts/fix-reporting-gross.ts
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BATCH_SIZE = 100

// Inline conversion function (no imports from main app)
function convertLocalCentsToUSD(localCents: number, rate: number): number {
  if (rate === 0) return 0
  return Math.round(localCents / rate)
}

async function fixReportingGross() {
  console.log('Starting reportingGrossCents fix...')

  const fixCount = await db.payment.count({
    where: {
      reportingCurrency: 'USD',
      reportingGrossCents: null,
      amountCents: { gt: 0 },
    },
  })

  console.log(`Found ${fixCount} payments with missing reportingGrossCents to fix`)

  if (fixCount === 0) {
    console.log('No payments need fixing. Done!')
    return
  }

  let fixed = 0
  let hasMore = true

  while (hasMore) {
    const paymentsToFix = await db.payment.findMany({
      where: {
        reportingCurrency: 'USD',
        reportingGrossCents: null,
        amountCents: { gt: 0 },
      },
      take: BATCH_SIZE,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        reportingExchangeRate: true,
      },
    })

    if (paymentsToFix.length === 0) {
      hasMore = false
      continue
    }

    const updates = paymentsToFix.map(payment => {
      const rate = payment.reportingExchangeRate || 1
      const isUSD = payment.currency === 'USD'
      const effectiveGross = payment.amountCents!

      return db.payment.update({
        where: { id: payment.id },
        data: {
          reportingGrossCents: isUSD ? effectiveGross : convertLocalCentsToUSD(effectiveGross, rate),
        },
      })
    })

    await Promise.all(updates)
    fixed += paymentsToFix.length

    console.log(`Fixed ${fixed}/${fixCount} payments (${((fixed / fixCount) * 100).toFixed(1)}%)`)
  }

  console.log(`\nComplete! Fixed ${fixed} payments.`)
}

fixReportingGross()
  .catch(console.error)
  .finally(() => db.$disconnect())
