import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, Loader2, Check, X, AlertCircle, User, Briefcase } from 'lucide-react'
import { useOnboardingStore, type SubscriptionPurpose } from './store'
import { Button, Pressable } from './components'
import { useCheckUsername, useSaveOnboardingProgress, useCreatorMinimum, useMyMinimum } from '../api/hooks'
import { PUBLIC_DOMAIN } from '../utils/constants'
import { getCurrencySymbol, getMinimumAmount, getSuggestedAmounts } from '../utils/currency'
import { isCrossBorderCountry } from '../utils/regionConfig'
import './onboarding.css'

export default function SetupStep() {
    const {
        username,
        setUsername,
        purpose,
        setPurpose,
        singleAmount,
        setPricing,
        currency,
        country,
        countryCode,
        paymentProvider,
        nextStep,
        prevStep,
        currentStep,
        firstName,
    } = useOnboardingStore()
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()

    // Local state
    const [localUsername, setLocalUsername] = useState(username)
    const [localPurpose, setLocalPurpose] = useState<SubscriptionPurpose>(purpose || 'personal')
    const [localPrice, setLocalPrice] = useState(String(singleAmount || ''))
    const [debouncedUsername, setDebouncedUsername] = useState(username)
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    // Track if user has manually edited price
    const userHasEditedPrice = useRef(false)

    // Debounce username for API check
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedUsername(localUsername)
        }, 500)
        return () => clearTimeout(timer)
    }, [localUsername])

    // Check availability via API (only when 3+ chars)
    const { data: availabilityData, isLoading: isChecking, isError, refetch } = useCheckUsername(debouncedUsername)

    const isFormatValid = localUsername.length >= 3 && /^[a-z0-9_]+$/.test(localUsername)
    const isWaitingForDebounce = isFormatValid && debouncedUsername !== localUsername
    const canShowCheckResult = isFormatValid && !isWaitingForDebounce && !isChecking && !isError
    const isAvailable = canShowCheckResult && availabilityData?.available === true
    const isTaken = canShowCheckResult && availabilityData?.available === false

    // Allow proceeding on error (API down) - backend will validate on profile save
    const usernameReady = isAvailable || (isFormatValid && isError)

    // Price validation
    const currencySymbol = getCurrencySymbol(currency)
    const isCrossBorder = isCrossBorderCountry(countryCode?.toUpperCase() || '')

    // Get minimum for Stripe creators
    const countryMinimum = useCreatorMinimum(country)
    const { data: myMinimum } = useMyMinimum()

    const isStripe = paymentProvider === 'stripe' || isCrossBorder // Assume Stripe if cross-border
    let minAmount = getMinimumAmount(currency)
    if (isStripe && myMinimum) {
        minAmount = currency === myMinimum.minimum.currency
            ? myMinimum.minimum.local
            : myMinimum.minimum.usd
    } else if (isStripe && countryMinimum) {
        minAmount = currency === countryMinimum.currency
            ? countryMinimum.local
            : countryMinimum.usd
    }

    // Auto-set price to first suggested amount if not edited
    const suggestedAmounts = getSuggestedAmounts(currency, localPurpose === 'service' ? 'service' : 'personal')
    useEffect(() => {
        if (!userHasEditedPrice.current && !localPrice) {
            const defaultAmount = Math.max(suggestedAmounts[0] || minAmount, minAmount)
            setLocalPrice(String(defaultAmount))
        }
    }, [suggestedAmounts, minAmount]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-bump price when minimum changes (e.g. dynamic min loads)
    useEffect(() => {
        if (!userHasEditedPrice.current && minAmount > 0) {
            const currentPrice = parseFloat(localPrice)
            if (!isNaN(currentPrice) && currentPrice < minAmount) {
                setLocalPrice(String(minAmount))
            }
        }
    }, [minAmount]) // eslint-disable-line react-hooks/exhaustive-deps

    const priceNum = parseFloat(localPrice) || 0
    const isPriceValid = isStripe ? (priceNum >= minAmount) : (priceNum > 0)

    const canContinue = usernameReady && isPriceValid

    const renderUsernameStatusIcon = () => {
        if (!localUsername || !isFormatValid) return null
        if (isWaitingForDebounce || isChecking) return <Loader2 size={18} className="spin" style={{ color: 'var(--text-tertiary)' }} />
        if (isTaken) return <X size={18} style={{ color: 'var(--status-error)' }} />
        if (isAvailable) return <Check size={18} style={{ color: 'var(--status-success)' }} />
        return null
    }

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        userHasEditedPrice.current = true
        const val = e.target.value.replace(/[^0-9.]/g, '')
        const parts = val.split('.')
        if (parts.length > 2) return
        setLocalPrice(val)
    }

    const handleContinue = async () => {
        if (!canContinue) return

        setIsSaving(true)
        setSaveError(null)

        // Commit to store
        setUsername(localUsername)
        setPurpose(localPurpose)
        setPricing('single', [], priceNum)

        try {
            await saveProgress({
                step: currentStep + 1,
                stepKey: 'payments', // After setup is always payments
                data: {
                    username: localUsername,
                    purpose: localPurpose,
                    singleAmount: priceNum,
                },
            })
            nextStep()
        } catch (err) {
            console.warn('[SetupStep] Failed to save progress:', err)
            setSaveError('Failed to save. Please try again.')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-header">
                <Pressable className="onboarding-back" onClick={prevStep}>
                    <ChevronLeft size={24} />
                </Pressable>
            </div>

            <div className="onboarding-content">
                {saveError && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        background: '#FEE2E2',
                        borderRadius: 10,
                        marginBottom: 16,
                        fontSize: 13,
                        color: '#DC2626',
                    }}>
                        <AlertCircle size={18} />
                        <span>{saveError}</span>
                    </div>
                )}

                <div className="step-header">
                    <h1>Set up your page</h1>
                    <p>{firstName ? `${firstName}, let's` : "Let's"} get your subscription page ready.</p>
                </div>

                <div className="step-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Username Input */}
                    <div>
                        <label className="setup-field-label">Your link</label>
                        <div className={`username-wrapper ${isTaken ? 'input-error' : ''}`}>
                            <span className="username-prefix">{PUBLIC_DOMAIN}/</span>
                            <input
                                className="input"
                                value={localUsername}
                                onChange={(e) => setLocalUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                                placeholder="yourname"
                                maxLength={20}
                                autoFocus
                                data-testid="username-input"
                            />
                            <div className="username-status-icon">
                                {renderUsernameStatusIcon()}
                            </div>
                        </div>
                        <div className="username-helper">
                            {localUsername && !isFormatValid && (
                                <span className="username-helper-error">
                                    3-20 characters, letters, numbers, or underscores only.
                                </span>
                            )}
                            {isFormatValid && (isWaitingForDebounce || isChecking) && (
                                <span style={{ color: 'var(--text-secondary)' }}>
                                    Checking availability...
                                </span>
                            )}
                            {isFormatValid && isTaken && (
                                <span className="username-helper-error">
                                    This username is already taken.
                                </span>
                            )}
                            {isFormatValid && isAvailable && (
                                <span className="username-helper-success" data-testid="username-available">
                                    ✓ Available
                                </span>
                            )}
                            {isFormatValid && !isWaitingForDebounce && !isChecking && isError && (
                                <span style={{ color: 'var(--text-secondary)' }}>
                                    Couldn't verify. <Pressable onClick={() => refetch()} style={{ display: 'inline' }}>
                                        <span style={{ fontWeight: 600, textDecoration: 'underline' }}>Retry</span>
                                    </Pressable> or continue anyway.
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Type Toggle - Personal vs Service */}
                    <div>
                        <label className="setup-field-label">Page type</label>
                        <div className="setup-type-toggle" data-testid="purpose-toggle">
                            <Pressable
                                className={`setup-type-option ${localPurpose === 'personal' ? 'selected' : ''}`}
                                onClick={() => setLocalPurpose('personal')}
                                data-testid="purpose-personal"
                            >
                                <User size={20} />
                                <div className="setup-type-text">
                                    <span className="setup-type-label">Personal</span>
                                    <span className="setup-type-desc">Tips, support, fan club</span>
                                </div>
                            </Pressable>
                            <Pressable
                                className={`setup-type-option ${localPurpose === 'service' ? 'selected' : ''}`}
                                onClick={() => setLocalPurpose('service')}
                                data-testid="purpose-service"
                            >
                                <Briefcase size={20} />
                                <div className="setup-type-text">
                                    <span className="setup-type-label">Service</span>
                                    <span className="setup-type-desc">Coaching, consulting</span>
                                </div>
                            </Pressable>
                        </div>
                    </div>

                    {/* Price Input */}
                    <div>
                        <label className="setup-field-label">Monthly price</label>
                        <div className="service-price-input-wrapper">
                            <span className="service-price-currency">{currencySymbol}</span>
                            <input
                                type="text"
                                inputMode="decimal"
                                className="service-price-input"
                                value={localPrice}
                                onChange={handlePriceChange}
                                placeholder={String(minAmount)}
                                data-testid="price-input"
                            />
                            <span className="service-price-period">/month</span>
                        </div>
                        {localPrice && !isPriceValid && isStripe && (
                            <div className="service-description-step-hint">
                                <span className="hint-warning">
                                    Minimum {currencySymbol}{minAmount.toLocaleString()}
                                </span>
                            </div>
                        )}
                        {localPrice && priceNum <= 0 && (
                            <div className="service-description-step-hint">
                                <span className="hint-warning">Enter a valid price</span>
                            </div>
                        )}

                        {/* Suggested amounts */}
                        <div className="setup-suggested-amounts">
                            {suggestedAmounts.slice(0, 4).map((amt) => (
                                <Pressable
                                    key={amt}
                                    className={`setup-suggested-pill ${priceNum === amt ? 'active' : ''}`}
                                    onClick={() => {
                                        userHasEditedPrice.current = true
                                        setLocalPrice(String(amt))
                                    }}
                                >
                                    {currencySymbol}{amt.toLocaleString()}
                                </Pressable>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!canContinue || isSaving}
                        data-testid="setup-continue-btn"
                    >
                        {isSaving ? (
                            <Loader2 size={20} className="spin" />
                        ) : (
                            'Continue'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
