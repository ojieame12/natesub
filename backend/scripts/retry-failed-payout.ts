/**
 * Retry a failed payout by fetching bank details from Paystack subaccount
 */
import { db } from '../src/db/client.js'
import { getSubaccount, createTransferRecipient, initiateTransfer } from '../src/services/paystack.js'

async function retryPayout(payoutReference: string) {
  console.log(`\n🔄 Retrying payout: ${payoutReference}\n`)

  // Find the failed payout
  const failedPayout = await db.payment.findFirst({
    where: {
      paystackTransactionRef: payoutReference,
      type: 'payout',
      status: 'failed',
    },
  })

  if (!failedPayout) {
    console.error('❌ Failed payout not found')
    process.exit(1)
  }

  console.log('📋 Payout details:')
  console.log(`   Amount: ${failedPayout.netCents} kobo (₦${(failedPayout.netCents / 100).toLocaleString()})`)
  console.log(`   Creator: ${failedPayout.creatorId}`)

  // Get creator profile
  const profile = await db.profile.findUnique({
    where: { userId: failedPayout.creatorId },
  })

  if (!profile?.paystackSubaccountCode) {
    console.error('❌ Creator has no Paystack subaccount')
    process.exit(1)
  }

  console.log(`   Subaccount: ${profile.paystackSubaccountCode}`)

  // Fetch bank details from Paystack subaccount (for account number)
  // But use profile.paystackBankCode for the bank code (subaccount returns bank NAME not code)
  console.log('\n⚙️  Fetching bank details from Paystack...')
  const subaccount = await getSubaccount(profile.paystackSubaccountCode)

  // Use bank CODE from profile, account NUMBER from subaccount
  const bankCode = profile.paystackBankCode!
  const accountNumber = subaccount.account_number

  console.log(`   Bank Code: ${bankCode}`)
  console.log(`   Account: ${accountNumber}`)
  console.log(`   Name: ${subaccount.business_name}`)

  // Create transfer recipient
  console.log('\n⚙️  Creating transfer recipient...')
  const { recipientCode } = await createTransferRecipient({
    name: profile.displayName || subaccount.business_name,
    accountNumber: accountNumber,
    bankCode: bankCode,
    currency: failedPayout.currency,
  })
  console.log(`   Recipient: ${recipientCode}`)

  // Initiate transfer
  console.log('\n⚙️  Initiating transfer...')
  const newReference = `${payoutReference}-RETRY-${Date.now()}`
  const transfer = await initiateTransfer({
    amount: failedPayout.netCents,
    recipientCode,
    reason: `Retry payout for ${payoutReference}`,
    reference: newReference,
  })

  console.log(`   Transfer code: ${transfer.transferCode}`)
  console.log(`   Status: ${transfer.status}`)

  // Update the payout record
  await db.payment.update({
    where: { id: failedPayout.id },
    data: {
      status: transfer.status === 'otp' ? 'pending' : 'pending',
      paystackTransferCode: transfer.transferCode,
      paystackTransactionRef: newReference,
    },
  })

  console.log('\n✅ Transfer initiated!')
  if (transfer.status === 'otp') {
    console.log('⚠️  OTP required - check Paystack dashboard to finalize')
  }

  process.exit(0)
}

const reference = process.argv[2] || 'PAYOUT-SUB-MJHHI3WF-ZB624S'
retryPayout(reference)
