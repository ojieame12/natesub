// Compare document projections vs implementation

const SERVICE_FEE_CONFIG: Record<string, { baseRate: number; minRate: number; absoluteCap: number }> = {
  USD: { baseRate: 0.08, minRate: 0.02, absoluteCap: 7500 },
  NGN: { baseRate: 0.08, minRate: 0.02, absoluteCap: 12000000 },
  ZAR: { baseRate: 0.08, minRate: 0.02, absoluteCap: 140000 },
}

const PERSONAL_FEE_CONFIG: Record<string, { baseRate: number; minRate: number; absoluteCap: number }> = {
  USD: { baseRate: 0.10, minRate: 0.03, absoluteCap: 500 },
  NGN: { baseRate: 0.10, minRate: 0.03, absoluteCap: 800000 },
  ZAR: { baseRate: 0.10, minRate: 0.03, absoluteCap: 9500 },
}

function calc(amount: number, currency: string, isService: boolean) {
  const config = isService ? SERVICE_FEE_CONFIG[currency] : PERSONAL_FEE_CONFIG[currency]
  const baseFee = Math.round(amount * config.baseRate)
  const minFee = Math.round(amount * config.minRate)

  let fee: number, status: string
  if (baseFee <= config.absoluteCap) {
    fee = baseFee
    status = 'base rate'
  } else if (config.absoluteCap >= minFee) {
    fee = config.absoluteCap
    status = 'CAPPED'
  } else {
    fee = minFee
    status = 'FLOOR'
  }

  return { fee, rate: (fee/amount*100).toFixed(2) + '%', status }
}

console.log('=== DOCUMENT vs IMPLEMENTATION ===\n')

// Document examples
const examples = [
  { name: 'Cleaner ₦200k', amount: 20000000, currency: 'NGN', service: true, docFee: 1600000, docRate: '8%' },
  { name: 'Software Eng ₦600k', amount: 60000000, currency: 'NGN', service: true, docFee: 4800000, docRate: '8%' },
  { name: 'Designer $2000', amount: 200000, currency: 'USD', service: true, docFee: 7500, docRate: '3.75%' },
  { name: 'Enterprise ₦10M', amount: 1000000000, currency: 'NGN', service: true, docFee: 20000000, docRate: '2%' },
  { name: 'Personal $30', amount: 3000, currency: 'USD', service: false, docFee: 300, docRate: '10%' },
  { name: 'Personal $75', amount: 7500, currency: 'USD', service: false, docFee: 500, docRate: '6.67%' },
  { name: 'Personal $200', amount: 20000, currency: 'USD', service: false, docFee: 600, docRate: '3%' },
]

for (const ex of examples) {
  const result = calc(ex.amount, ex.currency, ex.service)
  const match = result.fee === ex.docFee ? '✓' : '✗'
  console.log(match + ' ' + ex.name)
  console.log('  Doc:  ' + ex.docFee + ' (' + ex.docRate + ')')
  console.log('  Code: ' + result.fee + ' (' + result.rate + ') [' + result.status + ']')
  if (result.fee !== ex.docFee) {
    console.log('  MISMATCH: diff = ' + (result.fee - ex.docFee))
  }
  console.log()
}

// Check config matches document
console.log('=== CONFIG CHECK ===\n')
console.log('Service caps:')
console.log('  USD: $' + (SERVICE_FEE_CONFIG.USD.absoluteCap/100) + ' (doc: $75) ' + (SERVICE_FEE_CONFIG.USD.absoluteCap === 7500 ? '✓' : '✗'))
console.log('  NGN: ₦' + (SERVICE_FEE_CONFIG.NGN.absoluteCap/100).toLocaleString() + ' (doc: ₦120,000) ' + (SERVICE_FEE_CONFIG.NGN.absoluteCap === 12000000 ? '✓' : '✗'))
console.log('  ZAR: R' + (SERVICE_FEE_CONFIG.ZAR.absoluteCap/100).toLocaleString() + ' (doc: R1,400) ' + (SERVICE_FEE_CONFIG.ZAR.absoluteCap === 140000 ? '✓' : '✗'))
console.log()
console.log('Personal caps:')
console.log('  USD: $' + (PERSONAL_FEE_CONFIG.USD.absoluteCap/100) + ' (doc: $5) ' + (PERSONAL_FEE_CONFIG.USD.absoluteCap === 500 ? '✓' : '✗'))
console.log('  NGN: ₦' + (PERSONAL_FEE_CONFIG.NGN.absoluteCap/100).toLocaleString() + ' (doc: ₦8,000) ' + (PERSONAL_FEE_CONFIG.NGN.absoluteCap === 800000 ? '✓' : '✗'))
console.log('  ZAR: R' + (PERSONAL_FEE_CONFIG.ZAR.absoluteCap/100) + ' (doc: R90) ' + (PERSONAL_FEE_CONFIG.ZAR.absoluteCap === 9000 ? '✓' : '✗ (code has R95)'))

console.log('\n=== REVENUE PROJECTION SPOT CHECK ===\n')

// Nigeria projection check
const nigeriaExamples = [
  { name: 'Cleaners/Domestics', count: 50, avgNGN: 15000000, docFee: 1200000 },
  { name: 'Drivers', count: 30, avgNGN: 20000000, docFee: 1600000 },
  { name: 'Tutors', count: 40, avgNGN: 10000000, docFee: 800000 },
  { name: 'Coaches', count: 30, avgNGN: 40000000, docFee: 3200000 },
  { name: 'Software/Freelance', count: 20, avgNGN: 80000000, docFee: 6400000 },
  { name: 'High-value', count: 10, avgNGN: 200000000, docFee: 12000000 },
]

let totalMonthly = 0
for (const ex of nigeriaExamples) {
  const result = calc(ex.avgNGN, 'NGN', true)
  const match = result.fee === ex.docFee ? '✓' : '✗'
  const monthly = result.fee * ex.count
  totalMonthly += monthly
  console.log(match + ' ' + ex.name + ' (' + ex.count + ' users)')
  console.log('  Avg sub: ₦' + (ex.avgNGN/100).toLocaleString())
  console.log('  Fee: ₦' + (result.fee/100).toLocaleString() + ' [' + result.status + ']')
  console.log('  Monthly: ₦' + (monthly/100).toLocaleString())
  console.log()
}

console.log('Service Total (excl personal): ₦' + (totalMonthly/100).toLocaleString())
console.log('Doc says: ₦4,840,000 (excluding personal)')
console.log()

// Personal check
const personalResult = calc(5000000, 'NGN', false)
const personalMonthly = personalResult.fee * 100
console.log('Personal (100 users @ ₦50k):')
console.log('  Fee: ₦' + (personalResult.fee/100).toLocaleString() + ' [' + personalResult.status + ']')
console.log('  Monthly: ₦' + (personalMonthly/100).toLocaleString())
console.log('  Doc says: ₦500,000')
