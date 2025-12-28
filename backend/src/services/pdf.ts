// PDF Generation Service for Income Statements
// Generates professional income statements for bank/visa verification

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// R2 client for storage
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

// Asset paths
const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, '../../assets')
const logoPath = join(assetsDir, 'logo.png')
const fontRegular = join(assetsDir, 'Manrope-Regular.ttf')
const fontSemibold = join(assetsDir, 'Manrope-SemiBold.ttf')

// ============================================
// BRAND COLORS
// ============================================
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

// ============================================
// TYPES
// ============================================

export interface PaymentRecord {
  date: Date
  amount: number // cents
  description: string
}

export interface IncomeStatementData {
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
  depositMethod: string
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

// Legacy type alias for backward compatibility
export interface PayStatementData extends IncomeStatementData {}

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

// ============================================
// QR CODE GENERATION
// ============================================

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

export async function generateIncomeStatement(data: IncomeStatementData): Promise<Buffer> {
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
      doc.registerFont('Manrope', fontRegular)
      doc.registerFont('Manrope-SemiBold', fontSemibold)

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
        .font('Manrope-SemiBold')
        .fontSize(18)
        .fillColor(COLORS.neutral900)
        .text('Income Statement', pageWidth - margin - 150, 40, { width: 150, align: 'right' })

      // Company info
      doc
        .font('Manrope')
        .fontSize(9)
        .fillColor(COLORS.neutral600)
        .text('NATEPAY, LLC', margin, 75)
        .text('natepay.co', margin, 87)

      // Statement ID
      doc
        .font('Manrope')
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
        .font('Manrope-SemiBold')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('PAYEE', margin, y)

      y += 14

      doc
        .font('Manrope-SemiBold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(data.payeeName, margin, y)

      y += 16

      if (data.payeeAddress) {
        doc
          .font('Manrope')
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
        .font('Manrope-SemiBold')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('PAY PERIOD', 380, 120)

      doc
        .font('Manrope-SemiBold')
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
        .font('Manrope')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('Active Subscribers', margin + 20, summaryY + 12)

      doc
        .font('Manrope-SemiBold')
        .fontSize(20)
        .fillColor(COLORS.neutral900)
        .text(data.activeSubscribers.toString(), margin + 20, summaryY + 26)

      doc
        .font('Manrope')
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
        .font('Manrope')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('Net Income This Period', margin + 170, summaryY + 12)

      doc
        .font('Manrope-SemiBold')
        .fontSize(22)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.totalEarnings, data.currency), margin + 170, summaryY + 26)

      // Deposit info
      if (data.depositDate && data.bankLast4) {
        doc
          .font('Manrope')
          .fontSize(9)
          .fillColor(COLORS.neutral500)
          .text(`Deposited ${formatShortDate(data.depositDate)} to account ending ${data.bankLast4}`, margin + 170, summaryY + 52)
      }

      // ==========================================
      // PAYMENT HISTORY TABLE
      // ==========================================

      const tableY = summaryY + summaryHeight + 25

      doc
        .font('Manrope-SemiBold')
        .fontSize(11)
        .fillColor(COLORS.neutral900)
        .text('Payment History', margin, tableY)

      doc
        .font('Manrope')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text(`${data.payments.length} payments received`, margin + 120, tableY + 2)

      // Table header
      const headerY = tableY + 22

      doc
        .rect(margin, headerY, contentWidth, 22)
        .fill(COLORS.neutral100)

      doc
        .font('Manrope-SemiBold')
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
          .font('Manrope')
          .fontSize(9)
          .fillColor(COLORS.neutral700)
          .text(formatShortDate(payment.date), margin + 15, rowY + 5)
          .text(payment.description, margin + 100, rowY + 5)

        doc
          .font('Manrope-SemiBold')
          .fontSize(9)
          .fillColor(COLORS.neutral800)
          .text(formatCurrency(payment.amount, data.currency), pageWidth - margin - 80, rowY + 5, { width: 65, align: 'right' })

        rowY += 20
      })

      // Show "more payments" if truncated
      if (data.payments.length > maxRows) {
        doc
          .font('Manrope')
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
        .font('Manrope-SemiBold')
        .fontSize(10)
        .fillColor(COLORS.neutral900)
        .text('Period Total', margin + 15, rowY + 8)

      doc
        .font('Manrope-SemiBold')
        .fontSize(11)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.totalEarnings, data.currency), pageWidth - margin - 80, rowY + 7, { width: 65, align: 'right' })

      // ==========================================
      // YEAR-TO-DATE SUMMARY
      // ==========================================

      const ytdY = rowY + 45

      doc
        .font('Manrope-SemiBold')
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

      // Net Income YTD
      doc
        .font('Manrope')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Net Income', margin + 15, ytdBoxY + 10)

      doc
        .font('Manrope-SemiBold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.ytdEarnings, data.currency), margin + 15, ytdBoxY + 23)

      // Payments Received
      doc
        .font('Manrope')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Payments Received', margin + colWidth + 15, ytdBoxY + 10)

      doc
        .font('Manrope-SemiBold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(data.ytdPaymentCount.toString(), margin + colWidth + 15, ytdBoxY + 23)

      // Avg Monthly
      doc
        .font('Manrope')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Avg Monthly', margin + (colWidth * 2) + 15, ytdBoxY + 10)

      doc
        .font('Manrope-SemiBold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text(formatCurrency(data.avgMonthlyEarnings, data.currency), margin + (colWidth * 2) + 15, ytdBoxY + 23)

      // Earning Since
      doc
        .font('Manrope')
        .fontSize(8)
        .fillColor(COLORS.neutral500)
        .text('Earning Since', margin + (colWidth * 3) + 15, ytdBoxY + 10)

      doc
        .font('Manrope-SemiBold')
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
        .font('Manrope')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text('This statement can be verified at:', margin, footerY + 15)

      doc
        .font('Manrope-SemiBold')
        .fontSize(9)
        .fillColor(COLORS.accent)
        .text(data.verificationUrl, margin, footerY + 28, { link: data.verificationUrl })

      // QR Code
      doc.image(qrBuffer, pageWidth - margin - 60, footerY + 10, { width: 50 })

      // Legal disclaimer
      doc
        .font('Manrope')
        .fontSize(8)
        .fillColor(COLORS.neutral400)
        .text(
          'This is an official income statement issued by NATEPAY, LLC, a Delaware limited liability company. ' +
          'The information contained herein accurately reflects the earnings deposited to the payee during the specified period. ' +
          'Platform fees are non-refundable. For verification, scan the QR code or visit the URL above.',
          margin,
          footerY + 50,
          { width: contentWidth - 70 }
        )

      // Company footer
      doc
        .font('Manrope')
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

// Legacy function name for backward compatibility
export const generatePayStatement = generateIncomeStatement

// ============================================
// STORAGE
// ============================================

export async function uploadIncomeStatement(
  userId: string,
  periodId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const key = `income-statements/${userId}/${periodId}.pdf`

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    CacheControl: 'private, max-age=31536000',
  })

  await r2.send(command)
  return key
}

// Legacy function name
export const uploadPayStatement = uploadIncomeStatement

// Generate a time-limited signed URL for secure PDF access
export async function getIncomeStatementSignedUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ResponseContentDisposition: 'inline; filename="income-statement.pdf"',
  })

  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 900 })
  return signedUrl
}

// Legacy function name
export const getPayStatementSignedUrl = getIncomeStatementSignedUrl

// ============================================
// COMBINED: GENERATE & UPLOAD
// ============================================

export async function generateAndUploadIncomeStatement(
  userId: string,
  periodId: string,
  data: IncomeStatementData
): Promise<string> {
  const pdfBuffer = await generateIncomeStatement(data)
  const pdfUrl = await uploadIncomeStatement(userId, periodId, pdfBuffer)
  return pdfUrl
}

// Legacy function name
export const generateAndUploadPayStatement = generateAndUploadIncomeStatement

// ============================================
// VERIFICATION PDF
// ============================================

export interface VerificationPdfData {
  creatorName: string
  periodStart: Date
  periodEnd: Date
  grossCents: number
  netCents: number
  currency: string
  paymentCount: number
  payoutDate: Date | null
  payoutMethod: string | null
  verificationCode: string
  verifiedAt: Date
}

// Upload verification PDF to R2
export async function uploadVerificationPdf(
  verificationCode: string,
  pdfBuffer: Buffer
): Promise<string> {
  const key = `verification-pdfs/${verificationCode}.pdf`

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    // Public verification PDFs can be cached longer since they're immutable
    CacheControl: 'public, max-age=31536000',
  })

  await r2.send(command)
  return key
}

// Get signed URL for verification PDF (returns null if not found)
export async function getVerificationPdfSignedUrl(key: string): Promise<string | null> {
  try {
    // Check if object exists first
    const command = new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      ResponseContentDisposition: 'inline; filename="verification.pdf"',
    })

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 900 }) // 15 min
    return signedUrl
  } catch {
    return null
  }
}

// Check if verification PDF exists in R2
export async function verificationPdfExists(verificationCode: string): Promise<string | null> {
  const key = `verification-pdfs/${verificationCode}.pdf`
  try {
    // HeadObject checks existence without downloading the file
    const command = new HeadObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
    })
    await r2.send(command)
    return key
  } catch {
    return null
  }
}

export async function generateVerificationPdf(data: VerificationPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: 50,
        info: {
          Title: `Income Verification - ${data.verificationCode}`,
          Author: 'NatePay',
          Subject: 'Income Verification Document',
        },
      })

      // Register custom fonts
      doc.registerFont('Manrope', fontRegular)
      doc.registerFont('Manrope-SemiBold', fontSemibold)

      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = 612
      const margin = 50
      const contentWidth = pageWidth - (margin * 2)

      // ==========================================
      // HEADER
      // ==========================================

      // Logo
      doc.image(logoPath, margin, 35, { height: 32 })

      // Document title
      doc
        .font('Manrope-SemiBold')
        .fontSize(18)
        .fillColor(COLORS.neutral900)
        .text('Income Verification', pageWidth - margin - 150, 40, { width: 150, align: 'right' })

      // Verification ID
      doc
        .font('Manrope')
        .fontSize(9)
        .fillColor(COLORS.neutral500)
        .text(`ID: ${data.verificationCode}`, pageWidth - margin - 150, 62, { width: 150, align: 'right' })

      // Divider
      doc
        .moveTo(margin, 100)
        .lineTo(pageWidth - margin, 100)
        .strokeColor(COLORS.neutral200)
        .lineWidth(1)
        .stroke()

      // ==========================================
      // VERIFIED BADGE
      // ==========================================

      let y = 120

      // Green verification box
      doc
        .roundedRect(margin, y, contentWidth, 70, 8)
        .fill('#E8F5E9')

      doc
        .roundedRect(margin, y, contentWidth, 70, 8)
        .strokeColor('#4CAF50')
        .lineWidth(1)
        .stroke()

      // Checkmark icon (simplified as text)
      doc
        .font('Manrope-SemiBold')
        .fontSize(24)
        .fillColor('#4CAF50')
        .text('✓', margin + 20, y + 18)

      doc
        .font('Manrope-SemiBold')
        .fontSize(16)
        .fillColor('#2E7D32')
        .text('VERIFIED', margin + 55, y + 20)

      doc
        .font('Manrope')
        .fontSize(10)
        .fillColor('#558B2F')
        .text(
          'This income statement has been verified by NatePay Inc.',
          margin + 55,
          y + 42
        )

      // ==========================================
      // DETAILS TABLE
      // ==========================================

      y = 210

      doc
        .font('Manrope-SemiBold')
        .fontSize(12)
        .fillColor(COLORS.neutral900)
        .text('Verification Details', margin, y)

      y += 25

      const details = [
        ['Recipient', data.creatorName],
        ['Pay Period', formatPeriod(data.periodStart, data.periodEnd)],
        ['Gross Income', formatCurrency(data.grossCents, data.currency)],
        ['Net Income', formatCurrency(data.netCents, data.currency)],
        ['Payments Received', data.paymentCount.toString()],
        ['Payout Status', data.payoutDate ? `Deposited on ${formatDate(data.payoutDate)}` : 'Pending'],
        ['Deposit Method', data.payoutMethod || 'Bank Transfer'],
        ['Verification Code', data.verificationCode],
        ['Verified On', formatDate(data.verifiedAt)],
      ]

      details.forEach(([label, value], index) => {
        const isEven = index % 2 === 0
        if (isEven) {
          doc
            .rect(margin, y - 5, contentWidth, 28)
            .fill(COLORS.neutral50)
        }

        doc
          .font('Manrope')
          .fontSize(10)
          .fillColor(COLORS.neutral500)
          .text(label, margin + 15, y + 3)

        doc
          .font('Manrope-SemiBold')
          .fontSize(10)
          .fillColor(COLORS.neutral800)
          .text(value, margin + 180, y + 3)

        y += 28
      })

      // ==========================================
      // FOOTER
      // ==========================================

      y += 30

      doc
        .moveTo(margin, y)
        .lineTo(pageWidth - margin, y)
        .strokeColor(COLORS.neutral200)
        .lineWidth(1)
        .stroke()

      doc
        .font('Manrope')
        .fontSize(8)
        .fillColor(COLORS.neutral400)
        .text(
          'This verification document confirms that the above income was processed through NATEPAY, LLC, ' +
          'a Delaware limited liability company. This document is generated for verification purposes only. ' +
          'For questions or concerns, contact support@natepay.co',
          margin,
          y + 15,
          { width: contentWidth }
        )

      doc
        .font('Manrope')
        .fontSize(7)
        .fillColor(COLORS.neutral400)
        .text('NATEPAY, LLC • 131 Continental Dr, Suite 305, Newark, DE 19713 • support@natepay.co • natepay.co', margin, y + 50)

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}
