/**
 * Verification script for dynamic minimums
 * Run with: npx tsx scripts/verify-minimums.ts
 */

import { getDynamicMinimum, getSupportedCountries, getFeeBreakdown } from '../src/constants/creatorMinimums.js'
import { PLATFORM_FEE_RATE } from '../src/constants/fees.js'

const countries = getSupportedCountries()

console.log('='.repeat(120))
console.log('DYNAMIC MINIMUM VERIFICATION - 1 Subscriber vs 5 Subscribers')
console.log('='.repeat(120))
console.log('')
console.log('Platform Fee Rate: 9%')
console.log('Formula: minimum = fixedCents / (platformFeeRate - percentFees)')
console.log('')

console.log('-'.repeat(120))
console.log('| Country'.padEnd(20) + '| Curr'.padEnd(7) + '| % Fees'.padEnd(10) + '| Margin'.padEnd(10) + '| 1 Sub USD'.padEnd(12) + '| 1 Sub Local'.padEnd(18) + '| 5 Sub USD'.padEnd(12) + '| 5 Sub Local'.padEnd(18) + '|')
console.log('-'.repeat(120))

for (const country of countries) {
  const min1 = getDynamicMinimum({ country, subscriberCount: 1 })
  const min5 = getDynamicMinimum({ country, subscriberCount: 5 })
  const breakdown = getFeeBreakdown(country)

  const row = [
    country.slice(0, 17).padEnd(18),
    min1.currency.padEnd(5),
    (breakdown.totalPercentFees * 100).toFixed(2).padStart(5) + '%'.padEnd(2),
    (breakdown.netMarginRate * 100).toFixed(2).padStart(4) + '%'.padEnd(3),
    ('$' + min1.minimumUSD).padEnd(10),
    (min1.currency + ' ' + min1.minimumLocal.toLocaleString()).slice(0, 16).padEnd(16),
    ('$' + min5.minimumUSD).padEnd(10),
    (min5.currency + ' ' + min5.minimumLocal.toLocaleString()).slice(0, 16).padEnd(16),
  ]
  console.log('| ' + row.join('| ') + '|')
}

console.log('-'.repeat(120))
console.log('')
console.log('='.repeat(100))
console.log('DETAILED MATH FOR NIGERIA (Cross-Border Country, 100% intl mix)')
console.log('='.repeat(100))

const ngBreakdown = getFeeBreakdown('Nigeria')
const ng1 = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 1 })
const ng5 = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 5 })

console.log('')
console.log('Fee Components:')
console.log('  Processing:     ' + (ngBreakdown.processingPercent * 100).toFixed(2) + '%')
console.log('  Billing:        ' + (ngBreakdown.billingPercent * 100).toFixed(2) + '%')
console.log('  Payout %:       ' + (ngBreakdown.payoutPercent * 100).toFixed(2) + '%')
console.log('  Cross-border:   ' + (ngBreakdown.crossBorderPercent * 100).toFixed(2) + '%')
console.log('  Intl Card:      ' + (ngBreakdown.intlCardPercent * 100).toFixed(2) + '% (1.5% × intlMix=' + ngBreakdown.intlMix + ')')
console.log('  FX:             ' + (ngBreakdown.fxPercent * 100).toFixed(2) + '% (2.0% × intlMix=' + ngBreakdown.intlMix + ')')
console.log('  ---------------------------------')
console.log('  TOTAL % FEES:   ' + (ngBreakdown.totalPercentFees * 100).toFixed(2) + '%')
console.log('')
console.log('Fixed Fees:')
console.log('  Processing:     $0.30 (30 cents)')
console.log('  Payout Fixed:   $' + (ngBreakdown.payoutFixedCents / 100).toFixed(2) + ' (' + ngBreakdown.payoutFixedCents + ' cents)')
console.log('  Account Fee:    $2.00/month (200 cents)')
console.log('')
console.log('NET MARGIN: 9% - ' + (ngBreakdown.totalPercentFees * 100).toFixed(2) + '% = ' + (ngBreakdown.netMarginRate * 100).toFixed(2) + '%')
console.log('')

console.log('--- 1 SUBSCRIBER ---')
const accountFee1 = 200 / 1
const fixedCents1 = 30 + ngBreakdown.payoutFixedCents + accountFee1
console.log('  Account fee/sub: $2.00 / 1 = $' + (accountFee1/100).toFixed(2))
console.log('  Total fixed:     $0.30 + $' + (ngBreakdown.payoutFixedCents/100).toFixed(2) + ' + $' + (accountFee1/100).toFixed(2) + ' = $' + (fixedCents1/100).toFixed(2))
console.log('  Minimum calc:    $' + (fixedCents1/100).toFixed(2) + ' / ' + (ngBreakdown.netMarginRate * 100).toFixed(2) + '% = $' + ((fixedCents1 / ngBreakdown.netMarginRate) / 100).toFixed(2))
console.log('  Rounded to $5:   $' + ng1.minimumUSD)
console.log('  Local (NGN):     ₦' + ng1.minimumLocal.toLocaleString())
console.log('')

console.log('--- 5 SUBSCRIBERS ---')
const accountFee5 = 200 / 5
const fixedCents5 = 30 + ngBreakdown.payoutFixedCents + accountFee5
console.log('  Account fee/sub: $2.00 / 5 = $' + (accountFee5/100).toFixed(2))
console.log('  Total fixed:     $0.30 + $' + (ngBreakdown.payoutFixedCents/100).toFixed(2) + ' + $' + (accountFee5/100).toFixed(2) + ' = $' + (fixedCents5/100).toFixed(2))
console.log('  Minimum calc:    $' + (fixedCents5/100).toFixed(2) + ' / ' + (ngBreakdown.netMarginRate * 100).toFixed(2) + '% = $' + ((fixedCents5 / ngBreakdown.netMarginRate) / 100).toFixed(2))
console.log('  Rounded to $5:   $' + ng5.minimumUSD)
console.log('  Local (NGN):     ₦' + ng5.minimumLocal.toLocaleString())
console.log('')

console.log('='.repeat(100))
console.log('DETAILED MATH FOR UNITED STATES (Domestic Country, 70% intl mix)')
console.log('='.repeat(100))

const usBreakdown = getFeeBreakdown('United States')
const us1 = getDynamicMinimum({ country: 'United States', subscriberCount: 1 })
const us5 = getDynamicMinimum({ country: 'United States', subscriberCount: 5 })

console.log('')
console.log('Fee Components:')
console.log('  Processing:     ' + (usBreakdown.processingPercent * 100).toFixed(2) + '%')
console.log('  Billing:        ' + (usBreakdown.billingPercent * 100).toFixed(2) + '%')
console.log('  Payout %:       ' + (usBreakdown.payoutPercent * 100).toFixed(2) + '%')
console.log('  Cross-border:   ' + (usBreakdown.crossBorderPercent * 100).toFixed(2) + '%')
console.log('  Intl Card:      ' + (usBreakdown.intlCardPercent * 100).toFixed(2) + '% (1.5% × intlMix=' + usBreakdown.intlMix + ')')
console.log('  FX:             ' + (usBreakdown.fxPercent * 100).toFixed(2) + '% (2.0% × intlMix=' + usBreakdown.intlMix + ')')
console.log('  ---------------------------------')
console.log('  TOTAL % FEES:   ' + (usBreakdown.totalPercentFees * 100).toFixed(2) + '%')
console.log('')
console.log('Fixed Fees:')
console.log('  Processing:     $0.30 (30 cents)')
console.log('  Payout Fixed:   $' + (usBreakdown.payoutFixedCents / 100).toFixed(2) + ' (' + usBreakdown.payoutFixedCents + ' cents)')
console.log('  Account Fee:    $2.00/month (200 cents)')
console.log('')
console.log('NET MARGIN: 9% - ' + (usBreakdown.totalPercentFees * 100).toFixed(2) + '% = ' + (usBreakdown.netMarginRate * 100).toFixed(2) + '%')
console.log('')

console.log('--- 1 SUBSCRIBER ---')
const usAccountFee1 = 200 / 1
const usFixedCents1 = 30 + usBreakdown.payoutFixedCents + usAccountFee1
console.log('  Account fee/sub: $2.00 / 1 = $' + (usAccountFee1/100).toFixed(2))
console.log('  Total fixed:     $0.30 + $' + (usBreakdown.payoutFixedCents/100).toFixed(2) + ' + $' + (usAccountFee1/100).toFixed(2) + ' = $' + (usFixedCents1/100).toFixed(2))
console.log('  Minimum calc:    $' + (usFixedCents1/100).toFixed(2) + ' / ' + (usBreakdown.netMarginRate * 100).toFixed(2) + '% = $' + ((usFixedCents1 / usBreakdown.netMarginRate) / 100).toFixed(2))
console.log('  Rounded to $5:   $' + us1.minimumUSD)
console.log('')

console.log('--- 5 SUBSCRIBERS ---')
const usAccountFee5 = 200 / 5
const usFixedCents5 = 30 + usBreakdown.payoutFixedCents + usAccountFee5
console.log('  Account fee/sub: $2.00 / 5 = $' + (usAccountFee5/100).toFixed(2))
console.log('  Total fixed:     $0.30 + $' + (usBreakdown.payoutFixedCents/100).toFixed(2) + ' + $' + (usAccountFee5/100).toFixed(2) + ' = $' + (usFixedCents5/100).toFixed(2))
console.log('  Minimum calc:    $' + (usFixedCents5/100).toFixed(2) + ' / ' + (usBreakdown.netMarginRate * 100).toFixed(2) + '% = $' + ((usFixedCents5 / usBreakdown.netMarginRate) / 100).toFixed(2))
console.log('  Rounded to $5:   $' + us5.minimumUSD)
console.log('')

console.log('='.repeat(100))
console.log('PROFIT VERIFICATION AT MINIMUM (1 Subscriber)')
console.log('='.repeat(100))
console.log('')
console.log('At the minimum, platform fee should COVER all Stripe fees (profit >= 0).')
console.log('')

// Verify all countries
let allPassing = true
for (const country of countries) {
  const min1 = getDynamicMinimum({ country, subscriberCount: 1 })
  const breakdown = getFeeBreakdown(country)

  const minCents = min1.minimumUSD * 100
  const platformFee = minCents * PLATFORM_FEE_RATE
  const percentFees = minCents * breakdown.totalPercentFees
  const fixedFees = 30 + breakdown.payoutFixedCents + 200 // processing + payout + account
  const totalStripeFees = percentFees + fixedFees
  const profit = platformFee - totalStripeFees

  const status = profit >= -1 ? '✅' : '❌' // Allow $0.01 rounding error
  if (profit < -1) allPassing = false

  console.log(`${country.padEnd(20)} @ $${min1.minimumUSD.toString().padEnd(4)}: Platform $${(platformFee/100).toFixed(2).padEnd(6)} - Stripe $${(totalStripeFees/100).toFixed(2).padEnd(6)} = $${(profit/100).toFixed(2).padStart(6)} ${status}`)
}

console.log('')
console.log('='.repeat(100))
console.log(allPassing ? '✅ ALL COUNTRIES VERIFIED - No negative balance at minimums' : '❌ SOME COUNTRIES HAVE NEGATIVE BALANCE')
console.log('='.repeat(100))
