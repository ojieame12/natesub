import { useParams } from 'react-router-dom'
import { CheckCircle, XCircle, Loader2, FileText, Download } from 'lucide-react'
import { Pressable } from '../components'
import { usePayrollVerify } from '../api/hooks'
import { formatCurrencyFromCents } from '../utils/currency'
import './payroll.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Format date for display
const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    })
}

// Format date range for period
const formatPeriodRange = (start: string, end: string) => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default function PayrollVerify() {
    const { code } = useParams<{ code: string }>()
    const { data, isLoading, isError } = usePayrollVerify(code || '')

    // Loading state
    if (isLoading) {
        return (
            <div className="payroll-page payroll-verify-page">
                <header className="payroll-header">
                    <img src="/logo.svg" alt="NatePay" className="payroll-logo" />
                </header>
                <div className="payroll-verify-container">
                    <div className="payroll-verify-icon loading">
                        <Loader2 size={32} className="spin" />
                    </div>
                    <h1 className="payroll-verify-title">Verifying...</h1>
                    <p className="payroll-verify-message">Please wait while we verify this pay statement.</p>
                </div>
            </div>
        )
    }

    // Error or not found state (backend returns { verified: true, document: {...} })
    if (isError || !data?.verified || !data?.document) {
        return (
            <div className="payroll-page payroll-verify-page">
                <header className="payroll-header">
                    <img src="/logo.svg" alt="NatePay" className="payroll-logo" />
                </header>
                <div className="payroll-verify-container">
                    <div className="payroll-verify-icon error">
                        <XCircle size={32} />
                    </div>
                    <h1 className="payroll-verify-title">Verification Failed</h1>
                    <p className="payroll-verify-message">
                        This verification code is invalid or the pay statement doesn't exist.
                        Please check the code and try again.
                    </p>
                </div>
            </div>
        )
    }

    const doc = data.document

    // Verified state
    return (
        <div className="payroll-page payroll-verify-page">
            <header className="payroll-header">
                <img src="/logo.svg" alt="NatePay" className="payroll-logo" />
            </header>
            <div className="payroll-verify-container">
                <div className="payroll-verify-icon success">
                    <CheckCircle size={32} />
                </div>
                <h1 className="payroll-verify-title">Income Statement Verified</h1>
                <p className="payroll-verify-message">
                    This is a valid income statement issued by NatePay.
                </p>

                {/* Verified Details */}
                <div className="payroll-verify-details">
                    <div className="payroll-verify-row">
                        <span className="payroll-verify-label">Recipient</span>
                        <span className="payroll-verify-value">{doc.creatorName}</span>
                    </div>
                    <div className="payroll-verify-row">
                        <span className="payroll-verify-label">Period</span>
                        <span className="payroll-verify-value">{formatPeriodRange(doc.periodStart, doc.periodEnd)}</span>
                    </div>
                    <div className="payroll-verify-row">
                        <span className="payroll-verify-label">Net Income</span>
                        <span className="payroll-verify-value highlight">
                            {formatCurrencyFromCents(doc.netCents, doc.currency || 'USD')}
                        </span>
                    </div>
                    <div className="payroll-verify-row">
                        <span className="payroll-verify-label">Payments</span>
                        <span className="payroll-verify-value">{doc.paymentCount}</span>
                    </div>
                    {doc.payoutDate && (
                        <div className="payroll-verify-row">
                            <span className="payroll-verify-label">Deposited</span>
                            <span className="payroll-verify-value">{formatDate(doc.payoutDate)}</span>
                        </div>
                    )}
                    <div className="payroll-verify-row">
                        <span className="payroll-verify-label">Issued</span>
                        <span className="payroll-verify-value">{formatDate(doc.createdAt)}</span>
                    </div>
                </div>

                {/* Platform Confirmation */}
                <div className="payroll-verified-badge">
                    <CheckCircle size={14} />
                    <span>Confirmed by NatePay</span>
                </div>

                <div className="payroll-verify-badge">
                    <FileText size={16} />
                    <span>Verification Code: {doc.verificationCode}</span>
                </div>

                {/* Download Button */}
                <Pressable
                    className="payroll-verify-download-btn"
                    onClick={() => window.open(`${API_URL}/payroll/verify/${code}/pdf`, '_blank')}
                >
                    <Download size={18} />
                    <span>Download Verification PDF</span>
                </Pressable>

                <p className="payroll-verify-disclaimer">
                    This verification confirms that a payment was processed through NatePay.
                    It does not constitute employment verification.
                </p>
            </div>
        </div>
    )
}
