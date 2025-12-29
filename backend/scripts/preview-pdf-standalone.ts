/**
 * Standalone Income Statement PDF Preview
 * Bypasses env validation and generates directly
 *
 * Run: npx tsx scripts/preview-pdf-standalone.ts
 */

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, '../assets')
const logoPath = join(assetsDir, 'logo.png')
const fontRegular = join(assetsDir, 'Barlow-Regular.ttf')
const fontSemiBold = join(assetsDir, 'Barlow-SemiBold.ttf')

// Brand colors
const COLORS = {
  accent: '#FF941A',
  neutral50: '#FAFAF9',
  neutral100: '#F5F5F4',
  neutral200: '#E7E5E4',
  neutral400: '#A8A29E',
  neutral500: '#78716C',
  neutral600: '#57534E',
  neutral700: '#44403C',
  neutral800: '#292524',
  neutral900: '#1C1917',
  green: '#34C759',
  white: '#FFFFFF',
}

interface PaymentRecord {
  date: Date
  amount: number
  description: string
}

interface IncomeStatementData {
  payeeName: string
  payeeEmail: string
  payeeAddress?: {
    street?: string
    city?: string
    state?: string
    zip?: string
    country?: string
  }
  periodStart: Date
  periodEnd: Date
  activeSubscribers: number
  totalEarnings: number
  payments: PaymentRecord[]
  depositDate: Date | null
  depositMethod: string
  bankLast4: string | null
  ytdEarnings: number
  ytdPaymentCount: number
  earningsSince: Date
  avgMonthlyEarnings: number
  statementId: string
  verificationUrl: string
  currency: string
}

function formatCurrency(cents: number, currency: string): string {
  const amount = cents / 100
  const symbols: Record<string, string> = { USD: '$', NGN: '₦', GBP: '£', EUR: '€' }
  const symbol = symbols[currency] || currency + ' '
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatPeriod(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startStr} - ${endStr}`
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

async function generateQRCodeBuffer(url: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(url, {
    width: 80,
    margin: 1,
    color: { dark: COLORS.neutral800, light: '#FFFFFF' },
  })
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

async function generateIncomeStatement(data: IncomeStatementData): Promise<Buffer> {
  const qrBuffer = await generateQRCodeBuffer(data.verificationUrl)

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: 50,
        info: {
          Title: `Income Statement - ${data.statementId}`,
          Author: 'NatePay',
        },
      })

      // Register Barlow fonts
      doc.registerFont('Barlow', fontRegular)
      doc.registerFont('Barlow-SemiBold', fontSemiBold)

      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = 612
      const margin = 50
      const contentWidth = pageWidth - (margin * 2)

      // ==========================================
      // HEADER - Clean minimal design
      // ==========================================

      // Accent bar at very top
      doc.rect(0, 0, pageWidth, 4).fill(COLORS.accent)

      // Logo (smaller, cleaner)
      doc.image(logoPath, margin, 24, { height: 24 })

      // Document type badge - right aligned
      const badgeWidth = 120
      const badgeX = pageWidth - margin - badgeWidth
      doc.roundedRect(badgeX, 20, badgeWidth, 28, 4).fill(COLORS.neutral100)

      doc.font('Barlow-SemiBold').fontSize(11).fillColor(COLORS.neutral700)
      doc.text('INCOME STATEMENT', badgeX, 28, { width: badgeWidth, align: 'center', lineBreak: false })

      // Thin divider
      doc.moveTo(margin, 65).lineTo(pageWidth - margin, 65).strokeColor(COLORS.neutral200).lineWidth(0.5).stroke()

      // Metadata row - clean grid layout (title case labels)
      const metaY = 80

      // Statement ID
      doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral400)
      doc.text('Statement', margin, metaY, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(11).fillColor(COLORS.neutral800)
      doc.text(data.statementId, margin, metaY + 14, { lineBreak: false })

      // Period
      doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral400)
      doc.text('Period', margin + 160, metaY, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(11).fillColor(COLORS.neutral800)
      doc.text(formatPeriod(data.periodStart, data.periodEnd), margin + 160, metaY + 14, { lineBreak: false })

      // Issued date
      doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral400)
      doc.text('Issued', margin + 360, metaY, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(11).fillColor(COLORS.neutral800)
      doc.text(formatDate(new Date()), margin + 360, metaY + 14, { lineBreak: false })

      // ==========================================
      // PAYEE SECTION
      // ==========================================

      let y = 125

      // Payee header with accent
      doc.rect(margin, y, 3, 40).fill(COLORS.accent)

      doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral400)
      doc.text('Payee', margin + 14, y, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(14).fillColor(COLORS.neutral900)
      doc.text(data.payeeName, margin + 14, y + 13, { lineBreak: false })

      if (data.payeeAddress) {
        const { street, city, state, zip, country } = data.payeeAddress
        const addressParts = []
        if (street) addressParts.push(street)
        const cityLine = [city, state, zip].filter(Boolean).join(', ')
        if (cityLine) addressParts.push(cityLine)
        if (country) addressParts.push(country)

        doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral500)
        doc.text(addressParts.join(' • '), margin + 14, y + 30, { lineBreak: false })
      }

      // INCOME SUMMARY BOX
      const summaryY = 180
      const summaryHeight = 70

      doc.roundedRect(margin, summaryY, contentWidth, summaryHeight, 6).fill(COLORS.neutral50)
      doc.roundedRect(margin, summaryY, contentWidth, summaryHeight, 6).strokeColor(COLORS.neutral200).lineWidth(1).stroke()

      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('Active Subscribers', margin + 16, summaryY + 10, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(18).fillColor(COLORS.neutral900)
      doc.text(data.activeSubscribers.toString(), margin + 16, summaryY + 24, { lineBreak: false })
      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('Recurring Monthly', margin + 16, summaryY + 48, { lineBreak: false })

      doc.moveTo(margin + 140, summaryY + 10).lineTo(margin + 140, summaryY + summaryHeight - 10).strokeColor(COLORS.neutral200).lineWidth(1).stroke()

      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('Net Income This Period', margin + 156, summaryY + 10, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(20).fillColor(COLORS.neutral900)
      doc.text(formatCurrency(data.totalEarnings, data.currency), margin + 156, summaryY + 24, { lineBreak: false })

      if (data.depositDate && data.bankLast4) {
        doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
        doc.text(`Deposited ${formatShortDate(data.depositDate)} to account ending ${data.bankLast4}`, margin + 156, summaryY + 48, { lineBreak: false })
      }

      // PAYMENT HISTORY TABLE
      const tableY = summaryY + summaryHeight + 30

      // Section header with count badge
      doc.font('Barlow-SemiBold').fontSize(11).fillColor(COLORS.neutral900)
      doc.text('Payment History', margin, tableY, { continued: false })

      // Payment count badge
      const countText = `${data.payments.length} payments`
      doc.font('Barlow')
      const countWidth = doc.widthOfString(countText) + 14
      doc.roundedRect(margin + 110, tableY - 1, countWidth, 16, 8).fill(COLORS.neutral100)
      doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral600)
      doc.text(countText, margin + 117, tableY + 2, { lineBreak: false })

      // Table header row
      const headerY = tableY + 24
      doc.rect(margin, headerY, contentWidth, 22).fill(COLORS.neutral100)

      // Column positions
      const dateCol = margin + 12
      const descCol = margin + 100
      const amountCol = pageWidth - margin - 75

      doc.font('Barlow-SemiBold').fontSize(9).fillColor(COLORS.neutral500)
      doc.text('Date', dateCol, headerY + 6, { lineBreak: false })
      doc.text('Description', descCol, headerY + 6, { lineBreak: false })
      doc.text('Amount', amountCol, headerY + 6, { width: 60, align: 'right', lineBreak: false })

      // Table rows - show first 6 payments with divider lines
      const maxRows = 6
      const visiblePayments = data.payments.slice(0, maxRows)
      let rowY = headerY + 22
      const rowHeight = 24

      visiblePayments.forEach((payment, index) => {
        // Row content - explicit positioning for each
        doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral600)
        doc.text(formatShortDate(payment.date), dateCol, rowY + 6, { lineBreak: false })

        doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral800)
        doc.text(payment.description, descCol, rowY + 6, { lineBreak: false })

        doc.font('Barlow-SemiBold').fontSize(9).fillColor(COLORS.neutral900)
        doc.text(formatCurrency(payment.amount, data.currency), amountCol, rowY + 6, { width: 60, align: 'right', lineBreak: false })

        rowY += rowHeight

        // Divider line between rows
        if (index < visiblePayments.length - 1) {
          doc.moveTo(margin, rowY).lineTo(pageWidth - margin, rowY).strokeColor(COLORS.neutral200).lineWidth(0.5).stroke()
        }
      })

      // "+ X more payments" row if needed
      if (data.payments.length > maxRows) {
        doc.moveTo(margin, rowY).lineTo(pageWidth - margin, rowY).strokeColor(COLORS.neutral200).lineWidth(0.5).stroke()
        doc.font('Barlow').fontSize(9).fillColor(COLORS.neutral400)
        doc.text(`+ ${data.payments.length - maxRows} more payments`, dateCol, rowY + 6, { lineBreak: false })
        rowY += rowHeight
      }

      // Total row with border
      doc.moveTo(margin, rowY).lineTo(pageWidth - margin, rowY).strokeColor(COLORS.neutral300).lineWidth(1).stroke()
      rowY += 2

      doc.rect(margin, rowY, contentWidth, 26).fill(COLORS.neutral50)
      doc.font('Barlow-SemiBold').fontSize(10).fillColor(COLORS.neutral900)
      doc.text('Period Total', dateCol, rowY + 8, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(10).fillColor(COLORS.neutral900)
      doc.text(formatCurrency(data.totalEarnings, data.currency), amountCol, rowY + 8, { width: 60, align: 'right', lineBreak: false })

      // YTD SUMMARY
      const ytdY = rowY + 45
      doc.font('Barlow-SemiBold').fontSize(11).fillColor(COLORS.neutral900)
      doc.text('Year-to-Date Summary', margin, ytdY, { lineBreak: false })

      const ytdBoxY = ytdY + 18
      const ytdBoxHeight = 55
      doc.roundedRect(margin, ytdBoxY, contentWidth, ytdBoxHeight, 6).fill(COLORS.neutral50)

      const colWidth = contentWidth / 4

      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('Net Income', margin + 12, ytdBoxY + 10, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(12).fillColor(COLORS.neutral900)
      doc.text(formatCurrency(data.ytdEarnings, data.currency), margin + 12, ytdBoxY + 24, { lineBreak: false })

      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('Payments Received', margin + colWidth + 12, ytdBoxY + 10, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(12).fillColor(COLORS.neutral900)
      doc.text(data.ytdPaymentCount.toString(), margin + colWidth + 12, ytdBoxY + 24, { lineBreak: false })

      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('Avg Monthly', margin + (colWidth * 2) + 12, ytdBoxY + 10, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(12).fillColor(COLORS.neutral900)
      doc.text(formatCurrency(data.avgMonthlyEarnings, data.currency), margin + (colWidth * 2) + 12, ytdBoxY + 24, { lineBreak: false })

      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('Earning Since', margin + (colWidth * 3) + 12, ytdBoxY + 10, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(12).fillColor(COLORS.neutral900)
      doc.text(formatMonthYear(data.earningsSince), margin + (colWidth * 3) + 12, ytdBoxY + 24, { lineBreak: false })

      // FOOTER
      const footerY = ytdBoxY + ytdBoxHeight + 25
      doc.moveTo(margin, footerY).lineTo(pageWidth - margin, footerY).strokeColor(COLORS.neutral200).lineWidth(1).stroke()

      doc.font('Barlow').fontSize(8).fillColor(COLORS.neutral500)
      doc.text('This statement can be verified at:', margin, footerY + 12, { lineBreak: false })
      doc.font('Barlow-SemiBold').fontSize(8).fillColor(COLORS.accent)
      doc.text(data.verificationUrl, margin, footerY + 24, { link: data.verificationUrl })

      doc.image(qrBuffer, pageWidth - margin - 55, footerY + 8, { width: 45 })

      doc.font('Barlow').fontSize(7).fillColor(COLORS.neutral400)
      doc.text(
        'This is an official income statement issued by NATEPAY, LLC, a Delaware limited liability company. ' +
        'The information contained herein accurately reflects the earnings deposited to the payee during the specified period. ' +
        'Platform fees are non-refundable. For verification, scan the QR code or visit the URL above.',
        margin, footerY + 42, { width: contentWidth - 65, lineBreak: true }
      )

      doc.font('Barlow').fontSize(7).fillColor(COLORS.neutral400)
      doc.text('NATEPAY, LLC • 131 Continental Dr, Suite 305, Newark, DE 19713 • support@natepay.co • natepay.co', margin, footerY + 72, { lineBreak: false })

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

// Sample data for Vanessa Bilboan
const sampleData: IncomeStatementData = {
  payeeName: 'Vanessa Bilboan',
  payeeEmail: 'vanessa.bilboan@gmail.com',
  payeeAddress: {
    street: '45 Wellness Boulevard, Apt 12B',
    city: 'Los Angeles',
    state: 'CA',
    zip: '90210',
    country: 'United States',
  },
  periodStart: new Date('2024-12-01'),
  periodEnd: new Date('2024-12-31'),
  activeSubscribers: 12,
  totalEarnings: 1086336, // $10,863.36 net
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
  depositDate: new Date('2024-12-28'),
  depositMethod: 'Bank Transfer',
  bankLast4: '4892',
  ytdEarnings: 4345344, // $43,453.44
  ytdPaymentCount: 48,
  earningsSince: new Date('2024-08-01'),
  avgMonthlyEarnings: 1086336,
  statementId: 'PAY-2024-12-0847',
  verificationUrl: 'https://natepay.co/verify/PAY2024120847',
  currency: 'USD',
}

async function main() {
  console.log('🔄 Generating Income Statement PDF for Vanessa Bilboan...')

  try {
    const pdfBuffer = await generateIncomeStatement(sampleData)
    const outputPath = join(process.cwd(), 'preview-income-statement.pdf')
    writeFileSync(outputPath, pdfBuffer)

    console.log(`✅ PDF generated: ${outputPath}`)
    console.log('📄 Opening in Preview...')
    execSync(`open "${outputPath}"`)
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()
