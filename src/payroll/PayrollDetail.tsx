import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, CheckCircle, Clock, ExternalLink, Loader2 } from 'lucide-react'
import { Pressable, Skeleton, ErrorState, useToast } from '../components'
import { usePayrollPeriod, useCurrentUser } from '../api/hooks'
import { getCurrencySymbol } from '../utils/currency'
import './payroll.css'

// Format date for display
const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    })
}

// Format date range
const formatPeriodRange = (start: string, end: string) => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default function PayrollDetail() {
    const { periodId } = useParams<{ periodId: string }>()
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const currencySymbol = getCurrencySymbol(userData?.profile?.currency || 'USD')

    const { data, isLoading, isError, refetch } = usePayrollPeriod(periodId || '')
    const period = data?.period
    const toast = useToast()
    const [downloading, setDownloading] = useState(false)

    const handleDownloadPdf = async () => {
        if (!periodId) return

        setDownloading(true)
        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
            const token = localStorage.getItem('nate_auth_token')

            const response = await fetch(`${API_URL}/payroll/periods/${periodId}/pdf`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            })

            if (response.status === 401) {
                toast.error('Please sign in to download')
                return
            }

            if (response.status === 404) {
                toast.error('Pay statement not found')
                return
            }

            if (!response.ok) {
                toast.error('Failed to generate PDF')
                return
            }

            // Backend returns JSON with pdfUrl - open in new tab for download
            const data = await response.json()
            if (data.pdfUrl) {
                // Open PDF URL in new tab (browser will handle download/display)
                window.open(data.pdfUrl, '_blank')
            } else {
                toast.error('PDF URL not available')
            }
        } catch {
            toast.error('Failed to download PDF')
        } finally {
            setDownloading(false)
        }
    }

    return (
        <div className="payroll-page">
            {/* Header */}
            <header className="payroll-header">
                <Pressable className="payroll-back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="payroll-logo" />
                <div className="payroll-header-spacer" />
            </header>

            {/* Page Title */}
            <div className="payroll-page-title">
                <h1>Pay Statement</h1>
            </div>

            {/* Content */}
            <div className="payroll-content">
                {isError ? (
                    <ErrorState
                        title="Couldn't load statement"
                        message="We had trouble loading this pay statement."
                        onRetry={refetch}
                    />
                ) : isLoading ? (
                    <div className="payroll-document">
                        <div className="payroll-doc-header">
                            <Skeleton width={100} height={28} />
                            <Skeleton width={160} height={14} style={{ marginTop: 8 }} />
                        </div>
                        <div className="payroll-doc-body">
                            <Skeleton width="100%" height={200} borderRadius="8px" />
                        </div>
                    </div>
                ) : !period ? (
                    <ErrorState
                        title="Statement not found"
                        message="This pay statement doesn't exist."
                        onRetry={() => navigate('/payroll')}
                    />
                ) : (
                    <>
                        {/* Document Preview */}
                        <div className="payroll-document">
                            {/* Document Header */}
                            <div className="payroll-doc-header">
                                <img src="/logo.svg" alt="NatePay" className="payroll-doc-logo" />
                                <h2 className="payroll-doc-title">PAY STATEMENT</h2>
                                <p className="payroll-doc-period">
                                    {formatPeriodRange(period.startDate, period.endDate)}
                                </p>
                            </div>

                            {/* Status Badge */}
                            <div className="payroll-doc-status">
                                {period.status === 'paid' && period.payoutDate ? (
                                    <div className="payroll-status-row paid">
                                        <CheckCircle size={16} />
                                        <span>Paid on {formatDate(period.payoutDate)}</span>
                                    </div>
                                ) : (
                                    <div className="payroll-status-row pending">
                                        <Clock size={16} />
                                        <span>Payout pending</span>
                                    </div>
                                )}
                            </div>

                            {/* Earnings Section */}
                            <div className="payroll-doc-section">
                                <h3 className="payroll-doc-section-title">Earnings</h3>
                                <div className="payroll-doc-table">
                                    <div className="payroll-doc-row">
                                        <span className="payroll-doc-label">Client Payments</span>
                                        <span className="payroll-doc-value">
                                            {currencySymbol}{(period.grossAmount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    {period.payments && period.payments.length > 0 && (
                                        <div className="payroll-doc-breakdown">
                                            {period.payments.slice(0, 5).map((payment: any) => (
                                                <div key={payment.id} className="payroll-doc-breakdown-row">
                                                    <span>{payment.clientName || 'Client'}</span>
                                                    <span>{currencySymbol}{(payment.amount / 100).toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {period.payments.length > 5 && (
                                                <div className="payroll-doc-breakdown-row more">
                                                    <span>+{period.payments.length - 5} more payments</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Deductions Section */}
                            <div className="payroll-doc-section">
                                <h3 className="payroll-doc-section-title">Deductions</h3>
                                <div className="payroll-doc-table">
                                    <div className="payroll-doc-row deduction">
                                        <span className="payroll-doc-label">Platform Fee (8%)</span>
                                        <span className="payroll-doc-value">
                                            -{currencySymbol}{(period.platformFee / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Net Pay Section */}
                            <div className="payroll-doc-section net">
                                <div className="payroll-doc-row total">
                                    <span className="payroll-doc-label">NET PAY</span>
                                    <span className="payroll-doc-value">
                                        {currencySymbol}{(period.netAmount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>

                            {/* Payout Details */}
                            <div className="payroll-doc-footer">
                                <div className="payroll-doc-footer-row">
                                    <span>Paid to</span>
                                    <span>****{period.bankLast4 || '****'}</span>
                                </div>
                                <div className="payroll-doc-footer-row">
                                    <span>Verification</span>
                                    <span className="payroll-verification-code">{period.verificationCode}</span>
                                </div>
                            </div>
                        </div>

                        {/* Download Button */}
                        {period.status === 'paid' && (
                            <Pressable
                                className={`payroll-download-btn${downloading ? ' downloading' : ''}`}
                                onClick={handleDownloadPdf}
                                disabled={downloading}
                            >
                                {downloading ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        <span>Downloading...</span>
                                    </>
                                ) : (
                                    <>
                                        <Download size={18} />
                                        <span>Download PDF</span>
                                    </>
                                )}
                            </Pressable>
                        )}

                        {period.status !== 'paid' && (
                            <div className="payroll-download-note">
                                PDF will be available after payout is complete.
                            </div>
                        )}

                        {/* Verification Link */}
                        <div className="payroll-verify-section">
                            <p className="payroll-verify-text">
                                Third parties can verify this statement at:
                            </p>
                            <div className="payroll-verify-link">
                                <span>natepay.co/verify/{period.verificationCode}</span>
                                <ExternalLink size={14} />
                            </div>
                        </div>

                        {/* Disclaimer */}
                        <p className="payroll-disclaimer">
                            This document reflects payments processed through NatePay and does not constitute employment verification.
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
