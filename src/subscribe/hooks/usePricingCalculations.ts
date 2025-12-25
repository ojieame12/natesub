import { useMemo } from 'react'
import { calculateFeePreview as calculateFee, type FeePreview } from '../../utils/currency'
import type { Profile } from '../../api/client'

interface PricingCalculations {
    currentAmount: number
    currency: string
    feePreview: FeePreview
    total: number
    paymentsReady: boolean
    isReadyToPay: boolean
}

/**
 * usePricingCalculations - Centralized pricing/fee calculations for subscribe page
 *
 * Uses split fee model: 4% subscriber + 4% creator = 8% total
 */
export function usePricingCalculations(profile: Profile): PricingCalculations {
    const currentAmount = profile.singleAmount || 0
    const currency = profile.currency || 'USD'

    // Check if payments are ready
    const paymentsReady = profile.payoutStatus === 'active' || profile.paymentsReady || false
    const isReadyToPay = paymentsReady && currentAmount > 0

    // Calculate fees using split model
    const feePreview = useMemo(
        () => calculateFee(currentAmount, currency),
        [currentAmount, currency]
    )

    // Total subscriber pays (base + their 4% fee)
    const total = feePreview.subscriberPays

    return {
        currentAmount,
        currency,
        feePreview,
        total,
        paymentsReady,
        isReadyToPay,
    }
}
