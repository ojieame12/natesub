/**
 * Generate a sample payroll PDF for preview
 * Run with: npx tsx scripts/generate-sample-pdf.ts
 */

import { writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, '../assets')

// Assets
const logoPath = join(assetsDir, 'logo.png')
const fontRegular = join(assetsDir, 'SF-Compact-Rounded-Regular.otf')
const fontSemibold = join(assetsDir, 'SF-Compact-Rounded-Semibold.otf')

console.log('Assets check:')
console.log('  Logo:', existsSync(logoPath) ? '✓' : '✗')
console.log('  Font Regular:', existsSync(fontRegular) ? '✓' : '✗')
console.log('  Font Semibold:', existsSync(fontSemibold) ? '✓' : '✗')

// ============================================
// BRAND COLORS
// ============================================
const COLORS = {
  accent: '#FF941A',
  neutral50: '#FAFAF9',
  neutral100: '#F5F5F4',
  neutral200: '#E7E5E4',
  neutral300: '#D6D3D1',
  neutral400: '#A8A29E',
  neutral500: '#78716C',
  neutral600: '#57534E',
  neutral700: '#44403C',
  neutral800: '#292524',
  neutral900: '#1C1917',
  green: '#34C759',
  white: '#FFFFFF',
}

// ============================================
// TYPES
// ============================================

interface PaymentRecord {
  date: Date
  amount: number // cents
  description: string
}

interface IncomeStatementData {
  // Payee info
  payeeName: string
  payeeEmail: string
  payeeAddress?: {
    street?: string
    city?: string
    state?: string
    zip?: string
    country?: string
  }

  // Period
  periodStart: Date
  periodEnd: Date

  // Income details
  activeSubscribers: number
  totalEarnings: number // cents (net - what they received)
  payments: PaymentRecord[]

  // Deposit info
  depositDate: Date | null
  depositMethod: string // "Direct Deposit", "Bank Transfer"
  bankLast4: string | null

  // YTD & History
  ytdEarnings: number // cents
  ytdPaymentCount: number
  earningsSince: Date
  avgMonthlyEarnings: number // cents

  // Verification
  statementId: string
  verificationUrl: string

  // Currency
  currency: string
}

// ============================================
// FORMATTING HELPERS
// ============================================

function formatCurrency(cents: number, currency: string): string {
  const amount = cents / 100
  const symbols: Record<string, string> = {
    USD: '$',
    NGN: '₦',
    KES: 'KSh',
    ZAR: 'R',
    GBP: '£',
    EUR: '€',
  }
  const symbol = symbols[currency] || currency + ' '
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function formatPeriod(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startStr} - ${endStr}`
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

async function generateQRCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 80,
    margin: 1,
    color: {
      dark: COLORS.neutral800,
      light: '#FFFFFF',
    },
  })
}

// ============================================
// PDF GENERATION
// ============================================

async function generateIncomeStatement(data: IncomeStatementData): Promise<Buffer> {
  const qrDataUrl = await generateQRCodeDataUrl(data.verificationUrl)
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64')

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: 50,
        info: {
          Title: `Income Statement - ${data.statementId}`,
          Author: 'NatePay',
          Subject: `Income Statement for ${formatPeriod(data.periodStart, data.periodEnd)}`,
        },
      })

      // Register custom fonts
      doc.registerFont('SF-Regular', fontRegular)
      doc.registerFont('SF-Semibold', fontSemibold)

      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = 612
      const margin = 50
      const contentWidth = pageWidth - (margin * 2)

      // ==========================================
      // HEADER - Company Info
      // ==========================================

      // Logo
      doc.image(logoPath, margin, 35, { height: 32 })

      // Document title
      doc
        .font('SF-Semibold')
        .fontSize(18)
        .fillColor(COLORS.neutral900)
        .text('Income Statement', pageWidth - margin - 150, 40, { width: 150, align: 'right' })

      // Company info
      doc
        .font('SF-Regular')
        .fontSize(9)
        .fillColor(COLORS.neutral600)
        .text('NATEPAY, LLC', margin, 75)
        .text('natepay.co', margin, 87)

      // Statement ID
      doc
        .font('SF-Regular')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text(`Statement ID: ${data.statementId}`, pageWidth - margin - 150, 60, { width: 150, align: 'right' })
        .text(`Issued: ${formatDate(new Date())}`, pageWidth - margin - 150, 72, { width: 150, align: 'right' })

      // Divider
      doc
        .moveTo(margin, 105)
        .lineTo(pageWidth - margin, 105)
        .strokeColor(COLORS.neutral200)
        .lineWidth(1)
        .stroke()

      // ==========================================
      // PAYEE & PERIOD INFO
      // ==========================================

      let y = 125

      // Payee section
      doc
        .font('SF-Semibold')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('PAYEE', margin, y)

      y += 14

      doc
        .font('SF-Semibold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(data.payeeName, margin, y)

      y += 16

      if (data.payeeAddress) {
        doc
          .font('SF-Regular')
          .fontSize(10)
          .fillColor(COLORS.neutral600)

        const { street, city, state, zip, country } = data.payeeAddress
        if (street) {
          doc.text(street, margin, y)
          y += 13
        }
        const cityLine = [city, state, zip].filter(Boolean).join(', ')
        if (cityLine) {
          doc.text(cityLine, margin, y)
          y += 13
        }
        if (country) {
          doc.text(country, margin, y)
          y += 13
        }
      }

      // Period section (right side)
      doc
        .font('SF-Semibold')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('PAY PERIOD', 380, 120)

      doc
        .font('SF-Semibold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(formatPeriod(data.periodStart, data.periodEnd), 380, 134)

      // ==========================================
      // INCOME SUMMARY BOX
      // ==========================================

      const summaryY = 215
      const summaryHeight = 75

      // Box
      doc
        .roundedRect(margin, summaryY, contentWidth, summaryHeight, 8)
        .fill(COLORS.neutral50)

      doc
        .roundedRect(margin, summaryY, contentWidth, summaryHeight, 8)
        .strokeColor(COLORS.neutral200)
        .lineWidth(1)
        .stroke()

      // Left side - subscriber info
      doc
        .font('SF-Regular')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('Active Subscribers', margin + 20, summaryY + 12)

      doc
        .font('SF-Semibold')
        .fontSize(20)
        .fillColor(COLORS.neutral900)
        .text(data.activeSubscribers.toString(), margin + 20, summaryY + 26)

      doc
        .font('SF-Regular')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('Recurring Monthly', margin + 20, summaryY + 50)

      // Center divider
      doc
        .moveTo(margin + 150, summaryY + 12)
        .lineTo(margin + 150, summaryY + summaryHeight - 12)
        .strokeColor(COLORS.neutral200)
        .lineWidth(1)
        .stroke()

      // Right side - earnings
      doc
        .font('SF-Regular')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('Total Earnings This Period', margin + 170, summaryY + 12)

      doc
        .font('SF-Semibold')
        .fontSize(22)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.totalEarnings, data.currency), margin + 170, summaryY + 26)

      // Deposit info
      if (data.depositDate && data.bankLast4) {
        doc
          .font('SF-Regular')
          .fontSize(9)
          .fillColor(COLORS.neutral500)
          .text(`Deposited ${formatShortDate(data.depositDate)} to account ending ${data.bankLast4}`, margin + 170, summaryY + 52)
      }

      // ==========================================
      // PAYMENT HISTORY TABLE
      // ==========================================

      const tableY = summaryY + summaryHeight + 25

      doc
        .font('SF-Semibold')
        .fontSize(11)
        .fillColor(COLORS.neutral900)
        .text('Payment History', margin, tableY)

      doc
        .font('SF-Regular')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text(`${data.payments.length} payments received`, margin + 120, tableY + 2)

      // Table header
      const headerY = tableY + 22

      doc
        .rect(margin, headerY, contentWidth, 22)
        .fill(COLORS.neutral100)

      doc
        .font('SF-Semibold')
        .fontSize(9)
        .fillColor(COLORS.neutral600)
        .text('Date', margin + 15, headerY + 6)
        .text('Description', margin + 100, headerY + 6)
        .text('Amount', pageWidth - margin - 80, headerY + 6, { width: 65, align: 'right' })

      // Table rows - show up to 6 payments to fit on one page
      const maxRows = 6
      const visiblePayments = data.payments.slice(0, maxRows)
      let rowY = headerY + 22

      visiblePayments.forEach((payment, index) => {
        const isEven = index % 2 === 0

        if (isEven) {
          doc
            .rect(margin, rowY, contentWidth, 20)
            .fill(COLORS.white)
        }

        doc
          .font('SF-Regular')
          .fontSize(9)
          .fillColor(COLORS.neutral700)
          .text(formatShortDate(payment.date), margin + 15, rowY + 5)
          .text(payment.description, margin + 100, rowY + 5)

        doc
          .font('SF-Semibold')
          .fontSize(9)
          .fillColor(COLORS.neutral800)
          .text(formatCurrency(payment.amount, data.currency), pageWidth - margin - 80, rowY + 5, { width: 65, align: 'right' })

        rowY += 20
      })

      // Show "more payments" if truncated
      if (data.payments.length > maxRows) {
        doc
          .font('SF-Regular')
          .fontSize(9)
          .fillColor(COLORS.neutral500)
          .text(`+ ${data.payments.length - maxRows} more payments`, margin + 15, rowY + 5)
        rowY += 20
      }

      // Table footer - total
      doc
        .rect(margin, rowY, contentWidth, 24)
        .fill(COLORS.neutral100)

      doc
        .font('SF-Semibold')
        .fontSize(10)
        .fillColor(COLORS.neutral900)
        .text('Period Total', margin + 15, rowY + 8)

      doc
        .font('SF-Semibold')
        .fontSize(11)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.totalEarnings, data.currency), pageWidth - margin - 80, rowY + 7, { width: 65, align: 'right' })

      // ==========================================
      // YEAR-TO-DATE SUMMARY
      // ==========================================

      const ytdY = rowY + 45

      doc
        .font('SF-Semibold')
        .fontSize(11)
        .fillColor(COLORS.neutral900)
        .text('Year-to-Date Summary', margin, ytdY)

      const ytdBoxY = ytdY + 15
      const ytdBoxHeight = 55

      doc
        .roundedRect(margin, ytdBoxY, contentWidth, ytdBoxHeight, 8)
        .fill(COLORS.neutral50)

      // YTD Grid - 4 columns
      const colWidth = contentWidth / 4

      // Total Earnings
      doc
        .font('SF-Regular')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Total Earnings', margin + 15, ytdBoxY + 10)

      doc
        .font('SF-Semibold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.ytdEarnings, data.currency), margin + 15, ytdBoxY + 23)

      // Payments Received
      doc
        .font('SF-Regular')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Payments Received', margin + colWidth + 15, ytdBoxY + 10)

      doc
        .font('SF-Semibold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(data.ytdPaymentCount.toString(), margin + colWidth + 15, ytdBoxY + 23)

      // Avg Monthly
      doc
        .font('SF-Regular')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Avg Monthly', margin + (colWidth * 2) + 15, ytdBoxY + 10)

      doc
        .font('SF-Semibold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.avgMonthlyEarnings, data.currency), margin + (colWidth * 2) + 15, ytdBoxY + 23)

      // Earning Since
      doc
        .font('SF-Regular')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Earning Since', margin + (colWidth * 3) + 15, ytdBoxY + 10)

      doc
        .font('SF-Semibold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(formatMonthYear(data.earningsSince), margin + (colWidth * 3) + 15, ytdBoxY + 23)

      // ==========================================
      // FOOTER - Verification
      // ==========================================

      const footerY = ytdBoxY + ytdBoxHeight + 25

      doc
        .moveTo(margin, footerY)
        .lineTo(pageWidth - margin, footerY)
        .strokeColor(COLORS.neutral200)
        .lineWidth(1)
        .stroke()

      // Verification text
      doc
        .font('SF-Regular')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('This statement can be verified at:', margin, footerY + 15)

      doc
        .font('SF-Semibold')
        .fontSize(9)
        .fillColor(COLORS.accent)
        .text(data.verificationUrl, margin, footerY + 28, { link: data.verificationUrl })

      // QR Code
      doc.image(qrBuffer, pageWidth - margin - 60, footerY + 10, { width: 50 })

      // Legal disclaimer
      doc
        .font('SF-Regular')
        .fontSize(8)
        .fillColor(COLORS.neutral400)
        .text(
          'This is an official income statement issued by NATEPAY, LLC, a Delaware limited liability company. ' +
          'The information contained herein accurately reflects the earnings deposited to the payee during the specified period. ' +
          'For verification, scan the QR code or visit the URL above.',
          margin,
          footerY + 50,
          { width: contentWidth - 70 }
        )

      // Company footer
      doc
        .font('SF-Regular')
        .fontSize(7)
        .fillColor(COLORS.neutral400)
        .text(
          'NATEPAY, LLC • 131 Continental Dr, Suite 305, Newark, DE 19713 • support@natepay.co • natepay.co',
          margin,
          footerY + 80
        )

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

// ============================================
// MAIN - Generate samples
// ============================================

async function main() {
  console.log('\nGenerating income statement samples...\n')

  // Sample 1: USD Creator with good history
  const usdSample: IncomeStatementData = {
    payeeName: 'Sarah Johnson',
    payeeEmail: 'sarah@designstudio.com',
    payeeAddress: {
      street: '123 Creative Lane',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
      country: 'United States',
    },
    periodStart: new Date('2024-12-01'),
    periodEnd: new Date('2024-12-15'),
    activeSubscribers: 47,
    totalEarnings: 220500, // $2,205.00 net
    payments: [
      { date: new Date('2024-12-01'), amount: 4500, description: 'Pro Plan - Subscription (j***n@gmail.com)' },
      { date: new Date('2024-12-01'), amount: 9000, description: 'Premium - Subscription (m***a@outlook.com)' },
      { date: new Date('2024-12-02'), amount: 4500, description: 'Pro Plan - Subscription (s***h@yahoo.com)' },
      { date: new Date('2024-12-03'), amount: 13500, description: 'VIP Access - Subscription (d***d@gmail.com)' },
      { date: new Date('2024-12-04'), amount: 4500, description: 'Basic - Subscription (a***x@hotmail.com)' },
      { date: new Date('2024-12-05'), amount: 9000, description: 'Premium - One-time payment (r***t@gmail.com)' },
      { date: new Date('2024-12-06'), amount: 4500, description: 'Pro Plan - Subscription (l***a@icloud.com)' },
      { date: new Date('2024-12-07'), amount: 22500, description: 'Enterprise - Subscription (c***s@company.com)' },
      { date: new Date('2024-12-08'), amount: 4500, description: 'Basic - Subscription (e***n@gmail.com)' },
      { date: new Date('2024-12-09'), amount: 9000, description: 'Premium - Subscription (k***y@outlook.com)' },
      { date: new Date('2024-12-10'), amount: 4500, description: 'Pro Plan - Subscription (b***n@yahoo.com)' },
      { date: new Date('2024-12-11'), amount: 13500, description: 'VIP Access - Subscription (t***r@gmail.com)' },
    ],
    depositDate: new Date('2024-12-16'),
    depositMethod: 'Direct Deposit',
    bankLast4: '4242',
    ytdEarnings: 4365000, // $43,650.00
    ytdPaymentCount: 284,
    earningsSince: new Date('2023-03-15'),
    avgMonthlyEarnings: 363750, // $3,637.50
    statementId: 'INC-2024-12A-SJ8X9K',
    verificationUrl: 'https://natepay.co/verify/INC-2024-12A-SJ8X9K',
    currency: 'USD',
  }

  const usdBuffer = await generateIncomeStatement(usdSample)
  writeFileSync('sample-income-statement-usd.pdf', usdBuffer)
  console.log('✓ Generated: sample-income-statement-usd.pdf')
  console.log(`  Payee: ${usdSample.payeeName}`)
  console.log(`  Earnings: $${(usdSample.totalEarnings / 100).toFixed(2)}`)
  console.log(`  Subscribers: ${usdSample.activeSubscribers}\n`)

  // Sample 2: NGN Creator
  const ngnSample: IncomeStatementData = {
    payeeName: 'Chukwuemeka Okonkwo',
    payeeEmail: 'emeka@techservices.ng',
    payeeAddress: {
      street: '45 Marina Road',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
    },
    periodStart: new Date('2024-12-01'),
    periodEnd: new Date('2024-12-15'),
    activeSubscribers: 23,
    totalEarnings: 67500000, // ₦675,000.00 net
    payments: [
      { date: new Date('2024-12-01'), amount: 7500000, description: 'Gold Plan - Subscription (a***i@gmail.com)' },
      { date: new Date('2024-12-02'), amount: 10000000, description: 'Premium - Subscription (c***a@yahoo.com)' },
      { date: new Date('2024-12-03'), amount: 5000000, description: 'Basic - Subscription (o***n@gmail.com)' },
      { date: new Date('2024-12-05'), amount: 12500000, description: 'VIP Access - Subscription (e***e@outlook.com)' },
      { date: new Date('2024-12-07'), amount: 7500000, description: 'Gold Plan - Subscription (n***a@gmail.com)' },
      { date: new Date('2024-12-09'), amount: 10000000, description: 'Premium - One-time payment (k***i@yahoo.com)' },
      { date: new Date('2024-12-11'), amount: 7500000, description: 'Gold Plan - Subscription (s***u@gmail.com)' },
      { date: new Date('2024-12-13'), amount: 7500000, description: 'Gold Plan - Subscription (f***a@hotmail.com)' },
    ],
    depositDate: new Date('2024-12-17'),
    depositMethod: 'Bank Transfer',
    bankLast4: '1234',
    ytdEarnings: 135000000, // ₦1,350,000.00
    ytdPaymentCount: 156,
    earningsSince: new Date('2024-01-10'),
    avgMonthlyEarnings: 11250000, // ₦112,500.00
    statementId: 'INC-2024-12A-NG7M2P',
    verificationUrl: 'https://natepay.co/verify/INC-2024-12A-NG7M2P',
    currency: 'NGN',
  }

  const ngnBuffer = await generateIncomeStatement(ngnSample)
  writeFileSync('sample-income-statement-ngn.pdf', ngnBuffer)
  console.log('✓ Generated: sample-income-statement-ngn.pdf')
  console.log(`  Payee: ${ngnSample.payeeName}`)
  console.log(`  Earnings: ₦${(ngnSample.totalEarnings / 100).toLocaleString()}`)
  console.log(`  Subscribers: ${ngnSample.activeSubscribers}\n`)

  console.log('Done! Open the PDF files to preview.')
}

main().catch(console.error)
