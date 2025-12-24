import { db } from '../src/db/client.js'
import { decryptAccountNumber } from '../src/utils/encryption.js'

async function check() {
  const creatorId = process.argv[2] || 'b22c0463-e0fc-4494-8b73-67e7833675ae'

  const profile = await db.profile.findUnique({
    where: { userId: creatorId },
    select: {
      displayName: true,
      paystackBankCode: true,
      paystackAccountNumber: true,
      paystackAccountName: true,
    }
  })

  if (!profile) {
    console.log('Profile not found')
    process.exit(1)
  }

  console.log('\n=== Creator Bank Details ===')
  console.log('Creator:', profile.displayName)
  console.log('Bank Code:', profile.paystackBankCode)
  console.log('Account Name:', profile.paystackAccountName)

  if (profile.paystackAccountNumber) {
    try {
      const decrypted = decryptAccountNumber(profile.paystackAccountNumber)
      console.log('Account Number:', decrypted)
    } catch (e: any) {
      console.log('Account Number (encrypted):', profile.paystackAccountNumber.substring(0, 20) + '...')
      console.log('Decryption issue:', e.message)
    }
  } else {
    console.log('Account Number: NOT SET')
  }

  // Check for failed payouts
  const failedPayouts = await db.payment.findMany({
    where: {
      creatorId,
      type: 'payout',
      status: 'failed',
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  if (failedPayouts.length > 0) {
    console.log('\n=== Failed Payouts ===')
    for (const p of failedPayouts) {
      console.log(`  ${p.paystackTransactionRef}: ${p.netCents} kobo (${p.createdAt})`)
    }
  }

  process.exit(0)
}

check()
