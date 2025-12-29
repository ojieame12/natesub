/**
 * Preview Income Statement PDF
 * Generates a sample PDF with fake data and opens it
 *
 * Run: npx tsx scripts/preview-income-statement.ts
 */

import { generateIncomeStatement, type IncomeStatementData } from '../src/services/pdf.js'
import { writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'

async function main() {
  console.log('Generating Income Statement PDF...')

  const sampleData: IncomeStatementData = {
    // Payee info - Vanessa Bilboan
    payeeName: 'Vanessa Bilboan',
    payeeEmail: 'vanessa.bilboan@gmail.com',
    payeeAddress: {
      street: '45 Wellness Boulevard, Apt 12B',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90210',
      country: 'United States',
    },

    // Period - December 2024
    periodStart: new Date('2024-12-01'),
    periodEnd: new Date('2024-12-31'),

    // Income details
    activeSubscribers: 12,
    totalEarnings: 1086336, // $10,863.36 in cents (net after 8% fee)

    // Payment history - 12 subscribers at $984/month
    payments: [
      { date: new Date('2024-12-01'), amount: 90528, description: 'Subscription - James Crawford' },
      { date: new Date('2024-12-03'), amount: 90528, description: 'Subscription - Michelle Torres' },
      { date: new Date('2024-12-05'), amount: 90528, description: 'Subscription - Robert Kim' },
      { date: new Date('2024-12-07'), amount: 90528, description: 'Subscription - Sarah Johnson' },
      { date: new Date('2024-12-08'), amount: 90528, description: 'Subscription - David Chen' },
      { date: new Date('2024-12-10'), amount: 90528, description: 'Subscription - Emily Rodriguez' },
      { date: new Date('2024-12-12'), amount: 90528, description: 'Subscription - Michael Okonkwo' },
      { date: new Date('2024-12-14'), amount: 90528, description: 'Subscription - Lisa Park' },
      { date: new Date('2024-12-15'), amount: 90528, description: 'Subscription - Thomas Müller' },
      { date: new Date('2024-12-18'), amount: 90528, description: 'Subscription - Aisha Patel' },
      { date: new Date('2024-12-20'), amount: 90528, description: 'Subscription - Chris Williams' },
      { date: new Date('2024-12-22'), amount: 90528, description: 'Subscription - Natalie Brown' },
    ],

    // Deposit info
    depositDate: new Date('2024-12-28'),
    depositMethod: 'Bank Transfer',
    bankLast4: '4892',

    // YTD & History - earning since August 2024
    ytdEarnings: 4345344, // $43,453.44 (4 months of similar earnings)
    ytdPaymentCount: 48,
    earningsSince: new Date('2024-08-01'),
    avgMonthlyEarnings: 1086336, // $10,863.36

    // Verification
    statementId: 'PAY-2024-12-0847',
    verificationUrl: 'https://natepay.co/verify/PAY2024120847',

    // Currency
    currency: 'USD',
  }

  try {
    const pdfBuffer = await generateIncomeStatement(sampleData)

    // Save to temp file
    const outputPath = join(process.cwd(), 'preview-income-statement.pdf')
    writeFileSync(outputPath, pdfBuffer)

    console.log(`✅ PDF generated: ${outputPath}`)
    console.log('Opening in Preview...')

    // Open in default PDF viewer
    execSync(`open "${outputPath}"`)
  } catch (error) {
    console.error('Error generating PDF:', error)
    process.exit(1)
  }
}

main()
