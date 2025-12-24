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
    // Check if using new tiered model (has platformFee field)
    const hasTieredFees = feePreview.platformFee !== undefined

    return (
        <div className="sub-breakdown-card">
            <div className="sub-breakdown-row">
                <span className="sub-breakdown-label">Subscription</span>
                <span className="sub-breakdown-value">
                    {formatAmountWithSeparators(amount, currency)}/{interval}
                </span>
            </div>

            {/* For subscribers: show total (no fee breakdown, clean UX) */}
            {!isOwner && (
                <>
                    <div className="sub-breakdown-divider" />
                    <div className="sub-breakdown-row sub-breakdown-total">
                        <span className="sub-breakdown-label">Total</span>
                        <span className="sub-breakdown-total-value">
                            {formatAmountWithSeparators(amount, currency)}/{interval}
                        </span>
                    </div>
                </>
            )}

            {/* For owners: show fee breakdown and what they receive */}
            {isOwner && (
                <>
                    <div className="sub-breakdown-divider" />

                    {/* New tiered model: show platform + processing separately */}
                    {hasTieredFees ? (
                        <>
                            <div className="sub-breakdown-row sub-breakdown-fee is-owner">
                                <div className="sub-breakdown-label-group">
                                    <span>Instant payout ({feePreview.platformFeePercent})</span>
                                </div>
                                <span className="sub-breakdown-value">
                                    -{formatAmountWithSeparators(feePreview.platformFee!, currency)}
                                </span>
                            </div>

                            <div className="sub-breakdown-row sub-breakdown-fee is-owner">
                                <div className="sub-breakdown-label-group">
                                    <span>Processing ({feePreview.processingFeePercent})</span>
                                </div>
                                <span className="sub-breakdown-value">
                                    -{formatAmountWithSeparators(feePreview.processingFee!, currency)}
                                </span>
                            </div>
                        </>
                    ) : (
                        /* Legacy model: single combined fee */
                        <div className="sub-breakdown-row sub-breakdown-fee is-owner">
                            <div className="sub-breakdown-label-group">
                                <span>Instant payout ({feePreview.effectiveRatePercent})</span>
                            </div>
                            <span className="sub-breakdown-value">
                                -{formatAmountWithSeparators(feePreview.totalFee, currency)}
                            </span>
                        </div>
                    )}

                    <div className="sub-breakdown-row sub-breakdown-total">
                        <span className="sub-breakdown-label">You Receive</span>
                        <span className="sub-breakdown-total-value">
                            {formatAmountWithSeparators(feePreview.creatorReceives, currency)}
                        </span>
                    </div>

                    <div className="sub-breakdown-note">
                        <Info size={12} style={{ marginRight: 4 }} />
                        Covers instant payouts, billing & payment processing
                    </div>
                </>
            )}
        </div>
    )
}
