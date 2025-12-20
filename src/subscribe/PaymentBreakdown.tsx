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
    return (
        <div className="sub-breakdown-card">
            <div className="sub-breakdown-row">
                <span className="sub-breakdown-label">Subscription</span>
                <span className="sub-breakdown-value">
                    {formatAmountWithSeparators(amount, currency)}/{interval}
                </span>
            </div>

            {/* Subscriber's fee portion (4%) */}
            <div className="sub-breakdown-row sub-breakdown-fee">
                <div className="sub-breakdown-label-group">
                    <span>Secure payment</span>
                </div>
                <span className="sub-breakdown-value">
                    +{formatAmountWithSeparators(feePreview.serviceFee, currency)}
                </span>
            </div>

            <div className="sub-breakdown-divider" />

            {/* For subscribers: show what they pay */}
            {!isOwner && (
                <div className="sub-breakdown-row sub-breakdown-total">
                    <span className="sub-breakdown-label">Total Due</span>
                    <span className="sub-breakdown-total-value">
                        {formatAmountWithSeparators(feePreview.subscriberPays, currency)}
                    </span>
                </div>
            )}

            {/* For owners: show their fee and what they receive */}
            {isOwner && (
                <>
                    <div className="sub-breakdown-row sub-breakdown-fee is-owner">
                        <div className="sub-breakdown-label-group">
                            <span>Subscription management</span>
                        </div>
                        <span className="sub-breakdown-value">
                            -{formatAmountWithSeparators(feePreview.creatorFee, currency)}
                        </span>
                    </div>

                    <div className="sub-breakdown-row sub-breakdown-total">
                        <span className="sub-breakdown-label">You Receive</span>
                        <span className="sub-breakdown-total-value">
                            {formatAmountWithSeparators(feePreview.creatorReceives, currency)}
                        </span>
                    </div>

                    <div className="sub-breakdown-note">
                        <Info size={12} style={{ marginRight: 4 }} />
                        Covers billing, retries, and payment processing
                    </div>
                </>
            )}
        </div>
    )
}
