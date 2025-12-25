import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../../api/client'

type VerificationStatus = 'idle' | 'verifying' | 'success' | 'failed'

interface UsePaymentVerificationResult {
    status: VerificationStatus
    isVerifying: boolean
    isSuccess: boolean
    error: string | null
}

/**
 * usePaymentVerification - Handles Stripe/Paystack payment verification on return
 *
 * Checks URL params for:
 * - success=true (required)
 * - session_id (Stripe)
 * - reference/trxref (Paystack)
 */
export function usePaymentVerification(username: string): UsePaymentVerificationResult {
    const [searchParams] = useSearchParams()
    const [status, setStatus] = useState<VerificationStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const verificationAttemptedRef = useRef(false)

    const isSuccessReturn = searchParams.get('success') === 'true'
    const stripeSessionId = searchParams.get('session_id')
    const paystackRef = searchParams.get('reference') || searchParams.get('trxref')

    useEffect(() => {
        if (!isSuccessReturn || verificationAttemptedRef.current) return
        verificationAttemptedRef.current = true

        setStatus('verifying')

        if (stripeSessionId) {
            // Stripe verification
            api.checkout.verifySession(stripeSessionId, username)
                .then(result => {
                    if (result.verified) {
                        setStatus('success')
                    } else {
                        setStatus('failed')
                        setError('Payment verification failed')
                    }
                })
                .catch(() => {
                    setStatus('failed')
                    setError('Could not verify payment')
                })
        } else if (paystackRef) {
            // Paystack verification
            api.checkout.verifyPaystack(paystackRef)
                .then(result => {
                    if (result.verified) {
                        setStatus('success')
                    } else {
                        setStatus('failed')
                        setError('Payment verification failed')
                    }
                })
                .catch(() => {
                    setStatus('failed')
                    setError('Could not verify payment')
                })
        } else {
            // Invalid session (spoofed URL)
            setStatus('failed')
            setError('Invalid payment session')
        }
    }, [isSuccessReturn, stripeSessionId, paystackRef, username])

    return {
        status,
        isVerifying: status === 'verifying',
        isSuccess: status === 'success',
        error,
    }
}
