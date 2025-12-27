/**
 * Backfill Script: Fix async one-time subscription amounts
 *
 * Background:
 * Prior to the fix, handleAsyncPaymentSucceeded stored subscription.amount = netCents
 * instead of basePrice. This caused tier prices to display incorrectly in subscriber lists.
 *
 * This script:
 * 1. Finds one-time subscriptions where amount appears to be net (matches payment.netCents)
 * 2. Calculates the correct base price from the associated payment
 * 3. Updates subscription.amount to the correct value
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/backfill-async-subscription-amounts.ts  # Preview only
 *   npx tsx scripts/backfill-async-subscription-amounts.ts               # Apply fixes
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface FixCandidate {
  subscriptionId: string
  creatorId: string
  currentAmount: number
  paymentId: string
  paymentGross: number | null
  paymentNet: number
  feeModel: string | null
  subscriberFeeCents: number | null
  suggestedAmount: number
  reason: string
}

async function findCandidates(): Promise<FixCandidate[]> {
  const candidates: FixCandidate[] = []

  // Find all one-time subscriptions with at least one payment
  const oneTimeSubscriptions = await prisma.subscription.findMany({
    where: {
      interval: 'one_time',
    },
    include: {
      payments: {
        orderBy: { createdAt: 'asc' },
        take: 1, // First payment determines original amount
      },
    },
  })

  for (const sub of oneTimeSubscriptions) {
    if (sub.payments.length === 0) continue

    const payment = sub.payments[0]

    // Skip if no gross amount recorded (can't determine correct base)
    if (!payment.grossCents) continue

    // Check if subscription.amount matches netCents (indicates bug)
    // AND is different from what base price should be
    if (sub.amount !== payment.netCents) continue

    // Calculate what basePrice should be
    let suggestedAmount: number
    let reason: string

    if (payment.feeModel === 'split_v1' && payment.subscriberFeeCents) {
      // For split_v1: base = gross - subscriberFee
      suggestedAmount = payment.grossCents - payment.subscriberFeeCents
      reason = 'split_v1: gross - subscriberFee'
    } else if (payment.feeModel?.startsWith('progressive') || payment.feeModel === 'flat') {
      // For legacy fee models with absorb mode, base = gross
      // For pass mode, base = net (which is what's currently stored, so skip)
      if (sub.feeMode === 'absorb') {
        suggestedAmount = payment.grossCents
        reason = 'legacy absorb: gross'
      } else {
        // pass_to_subscriber mode - net IS the base price, skip
        continue
      }
    } else {
      // No fee model (very old) - use gross as base
      suggestedAmount = payment.grossCents
      reason = 'legacy no-model: gross'
    }

    // Only flag if suggested is different from current
    if (suggestedAmount === sub.amount) continue

    candidates.push({
      subscriptionId: sub.id,
      creatorId: sub.creatorId,
      currentAmount: sub.amount,
      paymentId: payment.id,
      paymentGross: payment.grossCents,
      paymentNet: payment.netCents,
      feeModel: payment.feeModel,
      subscriberFeeCents: payment.subscriberFeeCents,
      suggestedAmount,
      reason,
    })
  }

  return candidates
}

async function applyFixes(candidates: FixCandidate[], dryRun: boolean): Promise<void> {
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Found ${candidates.length} subscriptions to fix\n`)

  if (candidates.length === 0) {
    console.log('No subscriptions need fixing. All async one-time amounts are correct.')
    return
  }

  console.log('Candidates:')
  console.log('─'.repeat(100))

  for (const candidate of candidates) {
    const delta = candidate.suggestedAmount - candidate.currentAmount
    const deltaPercent = ((delta / candidate.currentAmount) * 100).toFixed(1)

    console.log(`Subscription: ${candidate.subscriptionId}`)
    console.log(`  Creator: ${candidate.creatorId}`)
    console.log(`  Current amount: ${candidate.currentAmount} cents`)
    console.log(`  Payment gross: ${candidate.paymentGross} cents`)
    console.log(`  Payment net: ${candidate.paymentNet} cents`)
    console.log(`  Fee model: ${candidate.feeModel || 'none'}`)
    console.log(`  Suggested amount: ${candidate.suggestedAmount} cents (+${delta} / +${deltaPercent}%)`)
    console.log(`  Reason: ${candidate.reason}`)
    console.log('')

    if (!dryRun) {
      await prisma.subscription.update({
        where: { id: candidate.subscriptionId },
        data: { amount: candidate.suggestedAmount },
      })
      console.log(`  ✓ Updated`)
    }

    console.log('─'.repeat(100))
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would update ${candidates.length} subscriptions`)
    console.log('Run without DRY_RUN=true to apply changes')
  } else {
    console.log(`\n✓ Updated ${candidates.length} subscriptions`)
  }
}

async function main() {
  const dryRun = process.env.DRY_RUN === 'true'

  console.log('='.repeat(60))
  console.log('Backfill: Async One-Time Subscription Amounts')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (applying changes)'}`)
  console.log('')

  try {
    const candidates = await findCandidates()
    await applyFixes(candidates, dryRun)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
