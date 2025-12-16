// PDF Generation Service for Payroll Documents
// Generates pay statements with verification QR codes

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env.js'
import type { PayrollDetail } from './payroll.js'

// R2 client for storage
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

// ============================================
// TYPES
// ============================================

export interface PayStatementData {
  // Creator info
  creatorName: string
  creatorEmail: string
  creatorAddress?: {
    street?: string
    city?: string
    state?: string
    zip?: string
    country?: string
  }

  // Period info
  periodStart: Date
  periodEnd: Date
  periodType: string

  // Earnings
  grossCents: number
  platformFeeCents: number
  processingFeeCents: number
  netCents: number
  paymentCount: number

  // YTD
  ytdGrossCents: number
  ytdNetCents: number

  // Payout
  payoutDate: Date | null
  payoutMethod: string | null
  bankLast4: string | null

  // Verification
  verificationCode: string
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

function formatPeriod(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startStr} - ${endStr}`
}

// ============================================
// QR CODE GENERATION
// ============================================

async function generateQRCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 100,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  })
}

// ============================================
// PDF GENERATION
// ============================================

export async function generatePayStatement(data: PayStatementData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: 50,
        info: {
          Title: `Pay Statement - ${data.verificationCode}`,
          Author: 'NatePay',
          Subject: `Pay Statement for ${formatPeriod(data.periodStart, data.periodEnd)}`,
        },
      })

      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Generate QR code
      const qrDataUrl = await generateQRCodeDataUrl(data.verificationUrl)
      const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64')

      // ==========================================
      // HEADER
      // ==========================================

      // Logo/Brand
      doc
        .fontSize(24)
        .font('Helvetica-Bold')
        .fillColor('#1a1a1a')
        .text('NatePay', 50, 50)

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#666666')
        .text('Pay Statement', 50, 78)

      // QR Code (top right)
      doc.image(qrBuffer, 462, 50, { width: 80 })

      doc
        .fontSize(8)
        .fillColor('#666666')
        .text('Scan to verify', 462, 132, { width: 80, align: 'center' })

      // Divider
      doc
        .strokeColor('#e5e5e5')
        .lineWidth(1)
        .moveTo(50, 160)
        .lineTo(562, 160)
        .stroke()

      // ==========================================
      // CREATOR INFO
      // ==========================================

      let currentY = 180

      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#1a1a1a')
        .text('Payee Information', 50, currentY)

      currentY += 20

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#333333')
        .text(data.creatorName, 50, currentY)
        .text(data.creatorEmail, 50, currentY + 14)

      currentY += 28

      // Render Address if available
      if (data.creatorAddress) {
        const { street, city, state, zip, country } = data.creatorAddress

        if (street) {
          doc.text(street, 50, currentY); currentY += 14;
        }

        const cityStateZip = [city, state, zip].filter(Boolean).join(', ')
        if (cityStateZip) {
          doc.text(cityStateZip, 50, currentY); currentY += 14;
        }

        if (country) {
          doc.text(country, 50, currentY); currentY += 14;
        }
      }

      // ==========================================
      // PERIOD INFO (right side)
      // ==========================================

      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('Pay Period', 350, 180)

      doc
        .fontSize(10)
        .font('Helvetica')
        .text(formatPeriod(data.periodStart, data.periodEnd), 350, 200)
        .text(`Statement Date: ${formatDate(new Date())}`, 350, 214)

      // ==========================================
      // EARNINGS BOX
      // ==========================================

      const boxY = 260
      const boxHeight = 180

      // Box background
      doc
        .roundedRect(50, boxY, 512, boxHeight, 8)
        .fillColor('#f9fafb')
        .fill()

      // Box header
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#1a1a1a')
        .text('Earnings Summary', 70, boxY + 20)

      // Earnings rows
      const rowStartY = boxY + 50
      const rowHeight = 24

      // Gross earnings
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#333333')
        .text('Gross Earnings', 70, rowStartY)

      doc
        .fillColor('#666666')
        .text(`${data.paymentCount} payment${data.paymentCount !== 1 ? 's' : ''}`, 70, rowStartY + 12)

      doc
        .font('Helvetica')
        .text(formatCurrency(data.grossCents, data.currency), 442, rowStartY, { width: 100, align: 'right' })

      // Platform fee
      doc
        .fillColor('#666666')
        .text('Platform Fee (8%)', 70, rowStartY + rowHeight + 12)

      doc
        .text(`-${formatCurrency(data.platformFeeCents, data.currency)}`, 442, rowStartY + rowHeight + 12, { width: 100, align: 'right' })

      // Processing fee
      doc
        .text('Processing Fee (2%)', 70, rowStartY + (rowHeight * 2) + 12)

      doc
        .text(`-${formatCurrency(data.processingFeeCents, data.currency)}`, 442, rowStartY + (rowHeight * 2) + 12, { width: 100, align: 'right' })

      // Divider
      doc
        .strokeColor('#e5e5e5')
        .lineWidth(1)
        .moveTo(70, rowStartY + (rowHeight * 3) + 8)
        .lineTo(542, rowStartY + (rowHeight * 3) + 8)
        .stroke()

      // Net earnings
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#16a34a')
        .text('Net Earnings', 70, rowStartY + (rowHeight * 3) + 18)

      doc
        .text(formatCurrency(data.netCents, data.currency), 442, rowStartY + (rowHeight * 3) + 18, { width: 100, align: 'right' })

      // ==========================================
      // YTD SUMMARY
      // ==========================================

      const ytdY = boxY + boxHeight + 30

      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#1a1a1a')
        .text('Year-to-Date Summary', 50, ytdY)

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#333333')

      // YTD Grid
      const ytdRowY = ytdY + 25

      doc.text('YTD Gross:', 50, ytdRowY)
      doc.text(formatCurrency(data.ytdGrossCents, data.currency), 150, ytdRowY)

      doc.text('YTD Net:', 300, ytdRowY)
      doc.text(formatCurrency(data.ytdNetCents, data.currency), 400, ytdRowY)

      // ==========================================
      // PAYOUT INFO
      // ==========================================

      const payoutY = ytdY + 60

      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#1a1a1a')
        .text('Payout Information', 50, payoutY)

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#333333')

      const payoutRowY = payoutY + 25

      if (data.payoutMethod) {
        doc.text('Method:', 50, payoutRowY)
        doc.text(data.payoutMethod === 'stripe' ? 'Stripe' : 'Paystack', 150, payoutRowY)
      }

      if (data.bankLast4) {
        doc.text('Account:', 300, payoutRowY)
        doc.text(`****${data.bankLast4}`, 400, payoutRowY)
      }

      if (data.payoutDate) {
        doc.text('Payout Date:', 50, payoutRowY + 18)
        doc.text(formatDate(data.payoutDate), 150, payoutRowY + 18)
      }

      // ==========================================
      // FOOTER
      // ==========================================

      const footerY = 680

      // Divider
      doc
        .strokeColor('#e5e5e5')
        .lineWidth(1)
        .moveTo(50, footerY)
        .lineTo(562, footerY)
        .stroke()

      // Verification info
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#666666')
        .text('Verification Code:', 50, footerY + 15)

      doc
        .font('Helvetica-Bold')
        .fillColor('#333333')
        .text(data.verificationCode, 140, footerY + 15)

      doc
        .font('Helvetica')
        .fillColor('#666666')
        .text('Verify this document at:', 50, footerY + 30)

      doc
        .fillColor('#2563eb')
        .text(data.verificationUrl, 160, footerY + 30, { link: data.verificationUrl })

      // Legal disclaimer
      doc
        .fontSize(8)
        .fillColor('#999999')
        .text(
          'This document is an official pay statement generated by NatePay. ' +
          'For questions about this statement, contact support@natepay.co.',
          50,
          footerY + 55,
          { width: 512 }
        )

      // End document
      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

// ============================================
// STORAGE
// ============================================

export async function uploadPayStatement(
  userId: string,
  periodId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const key = `payroll/${userId}/${periodId}.pdf`

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    CacheControl: 'private, max-age=31536000', // Cache for 1 year (immutable)
  })

  await r2.send(command)

  // Return the storage key, not a public URL
  // Use getPayStatementSignedUrl() to generate time-limited access URLs
  return key
}

// Generate a time-limited signed URL for secure PDF access
// URLs expire after 15 minutes - sufficient for download but limits exposure
export async function getPayStatementSignedUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ResponseContentDisposition: 'inline; filename="pay-statement.pdf"',
  })

  // 15 minute expiry - enough time to download but limits exposure window
  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 900 })
  return signedUrl
}

// ============================================
// COMBINED: GENERATE & UPLOAD
// ============================================

export async function generateAndUploadPayStatement(
  userId: string,
  periodId: string,
  data: PayStatementData
): Promise<string> {
  const pdfBuffer = await generatePayStatement(data)
  const pdfUrl = await uploadPayStatement(userId, periodId, pdfBuffer)
  return pdfUrl
}
