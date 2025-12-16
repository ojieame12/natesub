import { Info } from 'lucide-react'
import { formatAmountWithSeparators } from '../utils/currency'
import type { FeePreview } from '../utils/currency'

interface PaymentBreakdownProps {
    amount: number
    currency: string
    feePreview: FeePreview
    isOwner: boolean
    interval?: string
}

export default function PaymentBreakdown({
    amount,
    currency,
    feePreview,
    isOwner,
    interval = 'mo'
}: PaymentBreakdownProps) {
    // If creator absorbs fees, we don't show the fee line to the subscriber
    // unless it's the owner viewing it (transparency)
    const showFeeLine = isOwner || feePreview.serviceFee > 0

    return (
        <div className="sub-breakdown-card">
            <div className="sub-breakdown-row">
                <span className="sub-breakdown-label">Subscription</span>
                <span className="sub-breakdown-value">
                    {formatAmountWithSeparators(amount, currency)}/{interval}
                </span>
            </div>

            {showFeeLine && (
                <div className={`sub-breakdown-row sub-breakdown-fee ${isOwner ? 'is-owner' : ''}`}>
                    <div className="sub-breakdown-label-group">
                        <span>Service fee</span>
                        {isOwner && (
                            <span className="sub-fee-badge">
                                {feePreview.effectiveRatePercent}
                            </span>
                        )}
                    </div>
                    <span className="sub-breakdown-value">
                        {isOwner ? '-' : '+'}{formatAmountWithSeparators(feePreview.serviceFee, currency)}
                    </span>
                </div>
            )}

            <div className="sub-breakdown-divider" />

            <div className="sub-breakdown-row sub-breakdown-total">
                <span className="sub-breakdown-label">
                    {isOwner ? 'You Receive' : 'Total Due'}
                </span>
                <span className="sub-breakdown-total-value">
                    {formatAmountWithSeparators(
                        isOwner ? feePreview.creatorReceives : feePreview.subscriberPays,
                        currency
                    )}
                </span>
            </div>

            {isOwner && (
                <div className="sub-breakdown-note">
                    <Info size={12} style={{ marginRight: 4 }} />
                    {feePreview.serviceFee === 0
                        ? "Subscriber pays processing fees"
                        : "You are absorbing processing fees"
                    }
                </div>
            )}
        </div>
    )
}
