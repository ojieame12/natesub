import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCreateCheckout, useRecordPageView, useUpdatePageView, useUpdateSettings } from '../api/hooks'
import { api } from '../api/client'
import { calculateFeePreview } from '../utils/pricing'
import { useToast } from '../components'

export interface CheckoutEngineProps {
    profile: any
    isOwner?: boolean
}

export function useCheckoutEngine({ profile, isOwner }: CheckoutEngineProps) {
    const [searchParams] = useSearchParams()
    const viewIdRef = useRef<string | null>(null)
    const toast = useToast()

    // Params
    const isSuccessReturn = searchParams.get('success') === 'true'
    const paystackRef = searchParams.get('reference') || searchParams.get('trxref')
    const stripeSessionId = searchParams.get('session_id')

    // Hooks
    const { mutateAsync: createCheckout } = useCreateCheckout()
    const { mutateAsync: recordPageView } = useRecordPageView()
    const { mutateAsync: updatePageView } = useUpdatePageView()
    const { mutateAsync: updateSettings, isPending: isSettingsLoading } = useUpdateSettings()

    // State
    const [mount, setMount] = useState(false)
    const [feeMode, setFeeMode] = useState<'absorb' | 'pass_to_subscriber'>(profile.feeMode || 'pass_to_subscriber')
    const [subscriberEmail, setSubscriberEmail] = useState('')
    const [emailFocused, setEmailFocused] = useState(false)
    const [status, setStatus] = useState<'idle' | 'processing' | 'verifying' | 'success'>(
        isSuccessReturn ? 'verifying' : 'idle'
    )
    const [payerCountry, setPayerCountry] = useState<string | null>(null)

    // Derived
    const currentAmount = profile.singleAmount || 0
    const currency = profile.currency || 'USD'
    const paymentsReady = profile.payoutStatus === 'active' || profile.paymentsReady
    const isReadyToPay = paymentsReady && currentAmount > 0
    const isValidEmail = subscriberEmail.trim().length > 3 && subscriberEmail.includes('@')

    // Fees
    // Removed 'currency' arg as calculateFeePreview (pricing.ts) takes (amount, purpose, feeMode)
    const feePreview = calculateFeePreview(currentAmount, profile.purpose, feeMode)
    // Check the return type of calculateFeePreview in pricing.ts:
    // It returns { subscriberPays, creatorReceives, feeAmount, feePercent }
    // It does NOT return { serviceFee }. We need to map it.
    const subscriberPaysFee = feeMode === 'pass_to_subscriber'
    // If subscriber pays fee, feeToDisplay is the formatted fee amount to show they are paying extra
    const feeToDisplay = feePreview.feeAmount
    const total = feePreview.subscriberPays

    // 1. Mount animation
    useEffect(() => {
        const timer = setTimeout(() => setMount(true), 50)
        return () => clearTimeout(timer)
    }, [])

    // 2. Smart Provider Detection (IP-based)
    useEffect(() => {
        const CACHE_KEY = 'natepay_payer_country'
        const cached = sessionStorage.getItem(CACHE_KEY)
        if (cached && /^[A-Z]{2}$/.test(cached)) {
            setPayerCountry(cached)
        } else {
            fetch('https://ipapi.co/country/')
                .then(r => r.text())
                .then(code => {
                    const cleaned = code.trim().toUpperCase()
                    if (/^[A-Z]{2}$/.test(cleaned)) {
                        sessionStorage.setItem(CACHE_KEY, cleaned)
                        setPayerCountry(cleaned)
                    }
                }).catch(() => { })
        }
    }, [])

    // 3. Page View Tracking
    useEffect(() => {
        if (profile.id && !isOwner && !viewIdRef.current && !isSuccessReturn) {
            recordPageView({ profileId: profile.id, referrer: document.referrer })
                .then((data: any) => {
                    // Handle both string return (legacy) or object { viewId }
                    viewIdRef.current = typeof data === 'string' ? data : data.viewId
                })
                .catch(() => { })
        }
    }, [profile.id, isOwner, isSuccessReturn, recordPageView])

    // 4. Payment Verification (Success Return)
    useEffect(() => {
        if (!isSuccessReturn) return

        if (stripeSessionId) {
            api.checkout.verifySession(stripeSessionId, profile.username)
                .then(result => {
                    if (result.verified) {
                        setStatus('success')
                        if (viewIdRef.current) {
                            updatePageView({ viewId: viewIdRef.current, data: { completedCheckout: true } })
                        }
                    } else {
                        setStatus('idle')
                        toast.error('Payment verification failed')
                    }
                })
                .catch(() => {
                    setStatus('idle')
                    toast.error('Could not verify payment')
                })
        } else if (paystackRef) {
            api.checkout.verifyPaystack(paystackRef)
                .then(result => {
                    if (result.verified) {
                        setStatus('success')
                        if (viewIdRef.current) {
                            updatePageView({ viewId: viewIdRef.current, data: { completedCheckout: true } })
                        }
                    } else {
                        setStatus('idle')
                        toast.error('Payment verification failed')
                    }
                })
                .catch(() => {
                    setStatus('idle')
                    toast.error('Could not verify payment')
                })
        } else {
            setStatus('idle')
            toast.error('Invalid payment session')
        }
    }, [isSuccessReturn, stripeSessionId, paystackRef, profile.username, updatePageView, toast])

    // Handlers
    const handlePayment = async () => {
        if (!isReadyToPay) return
        if (!isValidEmail) {
            toast.error('Please enter a valid email')
            return
        }

        setStatus('processing')

        try {
            // Track intent
            if (viewIdRef.current) {
                updatePageView({ viewId: viewIdRef.current, data: { startedCheckout: true } })
            }

            const amountInCents = currentAmount // Base amount

            const result = await createCheckout({
                creatorUsername: profile.username,
                amount: amountInCents,
                interval: 'month',
                subscriberEmail: subscriberEmail.trim(),
                payerCountry: payerCountry || undefined, // Smart Routing
            })

            if (result.url) {
                window.location.href = result.url
            } else {
                throw new Error('No checkout URL returned')
            }
        } catch (err: any) {
            setStatus('idle')
            toast.error(err?.message || 'Failed to start payment')
        }
    }

    const handleToggleFeeMode = async () => {
        if (!isOwner) return
        const newMode = feeMode === 'absorb' ? 'pass_to_subscriber' : 'absorb'
        setFeeMode(newMode) // Optimistic
        try {
            await updateSettings({ feeMode: newMode })
            toast.success(`Fees will be ${newMode === 'absorb' ? 'absorbed by you' : 'passed to subscriber'}`)
        } catch {
            setFeeMode(profile.feeMode || 'pass_to_subscriber') // Revert
            toast.error('Failed to update fee setting')
        }
    }

    return {
        mount,
        status,
        feeMode,
        subscriberEmail,
        emailFocused,
        setSubscriberEmail,
        setEmailFocused,
        isReadyToPay,
        isValidEmail,
        feeToDisplay,
        total,
        currency,
        subscriberPaysFee,
        handlePayment,
        handleToggleFeeMode,
        isSettingsLoading
    }
}
