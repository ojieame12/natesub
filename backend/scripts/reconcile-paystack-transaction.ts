/**
 * Manual Paystack Transaction Reconciliation Script
 *
 * Usage: npx tsx scripts/reconcile-paystack-transaction.ts <reference>
 *
 * This script fetches a transaction from Paystack and creates the
 * subscription/payment records if they don't exist.
 */

import { db } from '../src/db/client.js'
import { verifyTransaction } from '../src/services/paystack.js'
import { handlePaystackChargeSuccess } from '../src/routes/webhooks/paystack/charge.js'

async function reconcileTransaction(reference: string) {
  console.log(`\n🔍 Fetching transaction: ${reference}\n`)

  try {
    // Fetch transaction from Paystack
    const transaction = await verifyTransaction(reference)

    if (!transaction) {
      console.error('❌ Transaction not found in Paystack')
      process.exit(1)
    }

    console.log('📋 Transaction details:')
    console.log(`   Status: ${transaction.status}`)
    console.log(`   Amount: ${transaction.amount} ${transaction.currency}`)
    console.log(`   Email: ${transaction.customer?.email}`)
    console.log(`   Reference: ${transaction.reference}`)
    console.log(`   Metadata:`, JSON.stringify(transaction.metadata, null, 2))

    if (transaction.status !== 'success') {
      console.error(`\n❌ Transaction status is "${transaction.status}", not "success"`)
      process.exit(1)
    }

    // Check if already processed
    const existingPayment = await db.payment.findFirst({
      where: {
        OR: [
          { paystackTransactionRef: reference },
          { paystackEventId: `manual_${reference}` },
        ],
      },
    })

    if (existingPayment) {
      console.log('\n✅ Transaction already processed!')
      console.log(`   Payment ID: ${existingPayment.id}`)
      console.log(`   Subscription ID: ${existingPayment.subscriptionId}`)
      process.exit(0)
    }

    // Check metadata
    const metadata = transaction.metadata
    if (!metadata?.creatorId) {
      console.error('\n❌ Transaction missing creatorId in metadata')
      console.log('   This transaction was not created by NatePay checkout')
      process.exit(1)
    }

    // Verify creator exists
    const creator = await db.user.findUnique({
      where: { id: metadata.creatorId },
      include: { profile: true },
    })

    if (!creator) {
      console.error(`\n❌ Creator not found: ${metadata.creatorId}`)
      process.exit(1)
    }

    console.log(`\n👤 Creator: ${creator.email} (${creator.profile?.displayName})`)

    // Process the transaction
    console.log('\n⚙️  Processing transaction...')

    await handlePaystackChargeSuccess(
      {
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        customer: transaction.customer,
        authorization: transaction.authorization,
        metadata: transaction.metadata,
        paid_at: transaction.paid_at,
      },
      `manual_${reference}` // Use manual_ prefix for event ID
    )

    // Verify it was created
    const payment = await db.payment.findFirst({
      where: { paystackTransactionRef: reference },
      include: { subscription: true },
    })

    if (payment) {
      console.log('\n✅ Successfully reconciled!')
      console.log(`   Payment ID: ${payment.id}`)
      console.log(`   Subscription ID: ${payment.subscriptionId}`)
      console.log(`   Amount: ${payment.netCents} ${payment.currency}`)
    } else {
      console.error('\n❌ Failed to create payment record')
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.response?.data) {
      console.error('   Paystack error:', error.response.data)
    }
    process.exit(1)
  }

  process.exit(0)
}

// Get reference from command line
const reference = process.argv[2]

if (!reference) {
  console.log('Usage: npx tsx scripts/reconcile-paystack-transaction.ts <reference>')
  console.log('')
  console.log('Example: npx tsx scripts/reconcile-paystack-transaction.ts SUB_abc123')
  process.exit(1)
}

reconcileTransaction(reference)
