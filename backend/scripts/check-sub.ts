import { db } from '../src/db/client.js'

async function check() {
  const sub = await db.subscription.findFirst({
    where: {
      creator: {
        profile: {
          username: 'natess'
        }
      }
    },
    include: {
      creator: { include: { profile: true } },
      subscriber: true,
      payments: { orderBy: { createdAt: 'desc' }, take: 3 }
    }
  })

  if (sub === null) {
    console.log('No subscription found')
    return
  }

  console.log('=== SUBSCRIPTION ===')
  console.log('ID:', sub.id)
  console.log('Status:', sub.status)
  console.log('Interval:', sub.interval)
  console.log('Amount (base):', sub.amount, sub.currency)
  console.log('Current Period End:', sub.currentPeriodEnd)
  console.log('Has Auth Code:', sub.paystackAuthorizationCode ? 'YES' : 'NO')
  console.log('Fee Model:', sub.feeModel)
  console.log('Fee Mode:', sub.feeMode)
  console.log('')
  console.log('=== CREATOR ===')
  console.log('Name:', sub.creator.profile?.displayName)
  console.log('Username:', sub.creator.profile?.username)
  console.log('Subaccount:', sub.creator.profile?.paystackSubaccountCode)
  console.log('')
  console.log('=== SUBSCRIBER ===')
  console.log('Email:', sub.subscriber.email)
  console.log('')
  console.log('=== PAYMENTS ===')
  for (const p of sub.payments) {
    const amount = p.grossCents || p.amountCents
    console.log('- ' + p.type + ': ' + amount + ' ' + p.currency + ' (' + p.status + ') - ' + p.createdAt)
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
