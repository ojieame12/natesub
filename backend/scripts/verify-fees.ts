/**
 * Fee Verification Script
 * Run: npx tsx scripts/verify-fees.ts
 *
 * Calculates expected fees for test amounts to verify against actual DB values
 */

// Inline fee calculation (mirrors src/services/fees.ts)
type UserPurpose = 'personal' | 'service' | 'tips' | 'support' | 'allowance' | 'fan_club' | 'exclusive_content' | 'other'

interface FeeConfig {
  baseRate: number
  minRate: number
  absoluteCap: number
}

const SERVICE_FEE_CONFIG: Record<string, FeeConfig> = {
  USD: { baseRate: 0.08, minRate: 0.02, absoluteCap: 7500 },
  NGN: { baseRate: 0.08, minRate: 0.02, absoluteCap: 12000000 },
  ZAR: { baseRate: 0.08, minRate: 0.02, absoluteCap: 140000 },
  KES: { baseRate: 0.08, minRate: 0.02, absoluteCap: 1150000 },
  GBP: { baseRate: 0.08, minRate: 0.02, absoluteCap: 6000 },
  EUR: { baseRate: 0.08, minRate: 0.02, absoluteCap: 7000 },
}

const PERSONAL_FEE_CONFIG: Record<string, FeeConfig> = {
  USD: { baseRate: 0.10, minRate: 0.03, absoluteCap: 500 },
  NGN: { baseRate: 0.10, minRate: 0.03, absoluteCap: 800000 },
  ZAR: { baseRate: 0.10, minRate: 0.03, absoluteCap: 9500 },
  KES: { baseRate: 0.10, minRate: 0.03, absoluteCap: 77000 },
  GBP: { baseRate: 0.10, minRate: 0.03, absoluteCap: 400 },
  EUR: { baseRate: 0.10, minRate: 0.03, absoluteCap: 470 },
}

function isServicePurpose(purpose: UserPurpose | null | undefined): boolean {
  return purpose === 'service'
}

function calculateServiceFee(amountCents: number, currency: string, purpose?: UserPurpose | null) {
  const normalizedCurrency = currency.toUpperCase()
  const isService = isServicePurpose(purpose)
  const purposeType = isService ? 'service' : 'personal'

  const config = isService
    ? (SERVICE_FEE_CONFIG[normalizedCurrency] || SERVICE_FEE_CONFIG.USD)
    : (PERSONAL_FEE_CONFIG[normalizedCurrency] || PERSONAL_FEE_CONFIG.USD)

  const baseFee = Math.round(amountCents * config.baseRate)
  const minFee = Math.round(amountCents * config.minRate)

  let feeCents: number
  let capped = false
  let floored = false

  if (baseFee <= config.absoluteCap) {
    feeCents = baseFee
  } else if (config.absoluteCap >= minFee) {
    feeCents = config.absoluteCap
    capped = true
  } else {
    feeCents = minFee
    floored = true
  }

  const effectiveRate = feeCents / amountCents

  return {
    feeCents,
    effectiveRate,
    capped,
    floored,
    grossCents: amountCents + feeCents,
    netCents: amountCents,
    currency: normalizedCurrency,
    feeModel: 'progressive_v2' as const,
    config: { ...config, purposeType },
  }
}

// Test cases for different scenarios
const testCases = [
  // USD - Service user (8% base, 2% floor, $75 cap)
  { amount: 10000, currency: 'USD', purpose: 'service' as const, label: 'USD $100 service' },
  { amount: 50000, currency: 'USD', purpose: 'service' as const, label: 'USD $500 service' },
  { amount: 100000, currency: 'USD', purpose: 'service' as const, label: 'USD $1000 service (should cap)' },
  { amount: 500000, currency: 'USD', purpose: 'service' as const, label: 'USD $5000 service (should floor)' },

  // USD - Personal user (10% base, 3% floor, $5 cap)
  { amount: 1000, currency: 'USD', purpose: 'tips' as const, label: 'USD $10 personal' },
  { amount: 5000, currency: 'USD', purpose: 'tips' as const, label: 'USD $50 personal (should cap)' },
  { amount: 50000, currency: 'USD', purpose: 'tips' as const, label: 'USD $500 personal (should floor)' },

  // NGN - Service user (8% base, 2% floor, ₦120,000 cap)
  { amount: 1000000, currency: 'NGN', purpose: 'service' as const, label: 'NGN ₦10,000 service' },
  { amount: 10000000, currency: 'NGN', purpose: 'service' as const, label: 'NGN ₦100,000 service' },
  { amount: 200000000, currency: 'NGN', purpose: 'service' as const, label: 'NGN ₦2,000,000 service (should cap)' },
  { amount: 1000000000, currency: 'NGN', purpose: 'service' as const, label: 'NGN ₦10,000,000 service (should floor)' },

  // NGN - Personal user
  { amount: 500000, currency: 'NGN', purpose: 'tips' as const, label: 'NGN ₦5,000 personal' },
  { amount: 10000000, currency: 'NGN', purpose: 'tips' as const, label: 'NGN ₦100,000 personal (should cap)' },
]

console.log('Fee Model v2 Verification\n')
console.log('=' .repeat(100))
console.log(
  'Label'.padEnd(40),
  'Creator'.padStart(12),
  'Fee'.padStart(10),
  'Total'.padStart(12),
  'Rate'.padStart(8),
  'Capped'.padStart(8),
  'Floored'.padStart(8)
)
console.log('=' .repeat(100))

for (const tc of testCases) {
  const result = calculateServiceFee(tc.amount, tc.currency, tc.purpose)

  const formatAmount = (cents: number) => {
    if (tc.currency === 'NGN') {
      return `₦${(cents / 100).toLocaleString()}`
    }
    return `$${(cents / 100).toFixed(2)}`
  }

  console.log(
    tc.label.padEnd(40),
    formatAmount(result.netCents).padStart(12),
    formatAmount(result.feeCents).padStart(10),
    formatAmount(result.grossCents).padStart(12),
    `${(result.effectiveRate * 100).toFixed(2)}%`.padStart(8),
    (result.capped ? 'YES' : '-').padStart(8),
    (result.floored ? 'YES' : '-').padStart(8)
  )
}

console.log('\n')

// Verify specific scenario: fee-on-fee bug check
console.log('Fee-on-Fee Bug Verification:')
console.log('-'.repeat(60))

const creatorPrice = 10000 // $100
const correctFee = calculateServiceFee(creatorPrice, 'USD', 'service')
const buggyFee = calculateServiceFee(correctFee.grossCents, 'USD', 'service')

console.log(`Creator Price: $${creatorPrice / 100}`)
console.log(`Correct fee (on creator price): $${correctFee.feeCents / 100} (${(correctFee.effectiveRate * 100).toFixed(2)}%)`)
console.log(`Buggy fee (on gross - WRONG): $${buggyFee.feeCents / 100} (${(buggyFee.effectiveRate * 100).toFixed(2)}%)`)
console.log(`\nIf renewal shows fee of $${buggyFee.feeCents / 100} instead of $${correctFee.feeCents / 100}, the bug exists!`)

console.log('\n')

// DB verification queries
console.log('DB Verification Queries:')
console.log('-'.repeat(60))
console.log(`
-- For a $100 USD service subscription, verify:
SELECT
  s.amount as "should_be_10000",
  p."grossCents" as "should_be_${correctFee.grossCents}",
  p."feeCents" as "should_be_${correctFee.feeCents}",
  p."netCents" as "should_be_${creatorPrice}",
  s."ltvCents" as "should_equal_netCents"
FROM subscriptions s
JOIN payments p ON p."subscriptionId" = s.id
WHERE s."creatorId" = 'YOUR_CREATOR_ID'
ORDER BY p."createdAt" DESC
LIMIT 1;
`)
