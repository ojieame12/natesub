/**
 * Backfill Reporting Currency for Existing Payments
 *
 * This script backfills the reportingCurrency fields for all payments
 * that don't have them set. Uses current FX rates and marks as "estimated".
 *
 * Run: npx tsx scripts/backfill-reporting-currency.ts
 */

import { PrismaClient } from '@prisma/client'
import { getUSDRate, convertLocalCentsToUSD } from '../src/services/fx.js'

const db = new PrismaClient()

const BATCH_SIZE = 100

async function backfillReportingCurrency() {
  console.log('Starting reporting currency backfill...')

  // Get count of payments without reporting currency
  const totalCount = await db.payment.count({
    where: { reportingCurrency: null },
  })

  console.log(`Found ${totalCount} payments to backfill`)

  if (totalCount > 0) {
    // Get unique currencies
    const currencies = await db.payment.groupBy({
      by: ['currency'],
      where: { reportingCurrency: null },
    })

    console.log(`Currencies to process: ${currencies.map(c => c.currency).join(', ')}`)

    // Fetch FX rates for all non-USD currencies
    const rateMap = new Map<string, number>()
    rateMap.set('USD', 1) // No conversion needed for USD

    for (const { currency } of currencies) {
      if (currency !== 'USD') {
        const rate = await getUSDRate(currency)
        rateMap.set(currency, rate)
        console.log(`FX rate for ${currency}: ${rate}`)
      }
    }

    // Process in batches
    let processed = 0
    let hasMore = true

    while (hasMore) {
      const payments = await db.payment.findMany({
        where: { reportingCurrency: null },
        take: BATCH_SIZE,
        select: {
          id: true,
          grossCents: true,
          amountCents: true, // Fallback for legacy payments
          feeCents: true,
          netCents: true,
          currency: true,
        },
      })

      if (payments.length === 0) {
        hasMore = false
        continue
      }

      // Update each payment with reporting data
      const updates = payments.map(payment => {
        const rate = rateMap.get(payment.currency) || 1
        const isUSD = payment.currency === 'USD'
        // Use grossCents if available, otherwise fall back to amountCents (legacy payments)
        const effectiveGross = payment.grossCents ?? payment.amountCents

        return db.payment.update({
          where: { id: payment.id },
          data: {
            reportingCurrency: 'USD',
            reportingGrossCents: effectiveGross
              ? (isUSD ? effectiveGross : convertLocalCentsToUSD(effectiveGross, rate))
              : null,
            reportingFeeCents: isUSD ? payment.feeCents : convertLocalCentsToUSD(payment.feeCents, rate),
            reportingNetCents: isUSD ? payment.netCents : convertLocalCentsToUSD(payment.netCents, rate),
            reportingExchangeRate: rate,
            reportingRateSource: 'backfill',
            reportingRateTimestamp: new Date(),
            reportingIsEstimated: !isUSD, // USD payments are exact, others are estimated
          },
        })
      })

      await Promise.all(updates)
      processed += payments.length

      console.log(`Processed ${processed}/${totalCount} payments (${((processed / totalCount) * 100).toFixed(1)}%)`)
    }

    console.log(`\nBackfill complete! Processed ${processed} payments.`)
    console.log('Note: Non-USD payments are marked as "estimated" since they use current rates.')
  } else {
    console.log('No payments need backfill.')
  }

  // Phase 2: Fix payments with null reportingGrossCents but valid amountCents
  // These were previously backfilled before the amountCents fallback was added
  console.log('\n--- Phase 2: Fix missing reportingGrossCents ---')

  const fixCount = await db.payment.count({
    where: {
      reportingCurrency: 'USD',
      reportingGrossCents: null,
      amountCents: { not: null },
    },
  })

  console.log(`Found ${fixCount} payments with missing reportingGrossCents to fix`)

  if (fixCount === 0) {
    console.log('No payments need fixing. Done!')
    return
  }

  let fixed = 0
  let hasMoreToFix = true

  while (hasMoreToFix) {
    const paymentsToFix = await db.payment.findMany({
      where: {
        reportingCurrency: 'USD',
        reportingGrossCents: null,
        amountCents: { not: null },
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
      hasMoreToFix = false
      continue
    }

    const fixUpdates = paymentsToFix.map(payment => {
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

    await Promise.all(fixUpdates)
    fixed += paymentsToFix.length

    console.log(`Fixed ${fixed}/${fixCount} payments (${((fixed / fixCount) * 100).toFixed(1)}%)`)
  }

  console.log(`\nPhase 2 complete! Fixed ${fixed} payments.`)
}

// Run the backfill
backfillReportingCurrency()
  .catch(console.error)
  .finally(() => db.$disconnect())
