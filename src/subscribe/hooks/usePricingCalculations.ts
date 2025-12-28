import { useMemo } from 'react'
import { calculateFeePreview as calculateFee, type FeePreview } from '../../utils/currency'
import { useFeeConfig } from '../../api/hooks'
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
 * Uses split fee model: 4.5% subscriber + 4.5% creator = 9% total
 * Fee rates are sourced from backend API via useFeeConfig()
 */
export function usePricingCalculations(profile: Profile): PricingCalculations {
    const currentAmount = profile.singleAmount || 0
    const currency = profile.currency || 'USD'

    // Get fee config from backend (falls back to static defaults if unavailable)
    const { data: feeConfig } = useFeeConfig()

    // Check if payments are ready
    const paymentsReady = profile.payoutStatus === 'active' || profile.paymentsReady || false
    const isReadyToPay = paymentsReady && currentAmount > 0

    // Calculate fees using split model with backend-sourced config
    const feePreview = useMemo(
        () => calculateFee(currentAmount, currency, null, null, false, feeConfig || undefined),
        [currentAmount, currency, feeConfig]
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
