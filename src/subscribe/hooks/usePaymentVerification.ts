import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../../api/client'

type VerificationStatus = 'idle' | 'verifying' | 'success' | 'failed'

interface UsePaymentVerificationResult {
    status: VerificationStatus
    isVerifying: boolean
    isSuccess: boolean
    error: string | null
}

const MAX_RETRIES = 5
const RETRY_DELAY_MS = 1500

/**
 * usePaymentVerification - Handles Stripe/Paystack payment verification on return
 *
 * Checks URL params for:
 * - success=true (required)
 * - session_id (Stripe)
 * - reference/trxref (Paystack)
 *
 * Includes retry logic: If verification fails (network error or webhook delay),
 * retries up to 5 times with 1.5s delay between attempts.
 */
export function usePaymentVerification(username: string): UsePaymentVerificationResult {
    const [searchParams] = useSearchParams()
    const [status, setStatus] = useState<VerificationStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const verificationStartedRef = useRef(false)
    const retryCountRef = useRef(0)
    const timerRef = useRef<number | null>(null)

    const isSuccessReturn = searchParams.get('success') === 'true'
    const stripeSessionId = searchParams.get('session_id')
    const paystackRef = searchParams.get('reference') || searchParams.get('trxref')

    const verifyStripe = useCallback(async (): Promise<boolean> => {
        if (!stripeSessionId) return false
        try {
            const result = await api.checkout.verifySession(stripeSessionId, username)
            return result.verified === true
        } catch {
            return false
        }
    }, [stripeSessionId, username])

    const verifyPaystack = useCallback(async (): Promise<{ verified: boolean; error?: string }> => {
        if (!paystackRef) return { verified: false, error: 'No reference' }
        try {
            const result = await api.checkout.verifyPaystack(paystackRef, username)
            return { verified: result.verified === true, error: result.error }
        } catch {
            return { verified: false, error: 'Network error' }
        }
    }, [paystackRef, username])

    useEffect(() => {
        if (!isSuccessReturn || verificationStartedRef.current) return
        verificationStartedRef.current = true

        let isMounted = true
        retryCountRef.current = 0

        const attemptVerification = async () => {
            if (!isMounted) return

            setStatus('verifying')

            if (stripeSessionId) {
                const verified = await verifyStripe()
                if (!isMounted) return

                if (verified) {
                    setStatus('success')
                } else if (retryCountRef.current < MAX_RETRIES) {
                    // Retry - webhook might be slow to process
                    retryCountRef.current++
                    timerRef.current = window.setTimeout(attemptVerification, RETRY_DELAY_MS)
                } else {
                    setStatus('failed')
                    setError('Payment verification failed after multiple attempts')
                }
            } else if (paystackRef) {
                const result = await verifyPaystack()
                if (!isMounted) return

                if (result.verified) {
                    setStatus('success')
                } else if (retryCountRef.current < MAX_RETRIES) {
                    // Retry - webhook might be slow to process
                    retryCountRef.current++
                    timerRef.current = window.setTimeout(attemptVerification, RETRY_DELAY_MS)
                } else {
                    setStatus('failed')
                    setError(result.error || 'Payment verification failed after multiple attempts')
                }
            } else {
                // Invalid session (spoofed URL) - no retry needed
                setStatus('failed')
                setError('Invalid payment session')
            }
        }

        attemptVerification()

        return () => {
            isMounted = false
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current)
            }
        }
    }, [isSuccessReturn, stripeSessionId, paystackRef, verifyStripe, verifyPaystack])

    return {
        status,
        isVerifying: status === 'verifying',
        isSuccess: status === 'success',
        error,
    }
}
