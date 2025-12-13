import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronDown, Check, Loader2, AlertCircle, Building2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { usePaystackBanks, usePaystackResolveAccount, usePaystackConnect, useProfile } from '../api/hooks'
import './onboarding.css'

interface Bank {
    code: string
    name: string
    type: string
}

export default function PaystackConnect() {
    const navigate = useNavigate()
    const store = useOnboardingStore()
    const { data: profileData } = useProfile()

    // Use onboarding store countryCode, fallback to profile (for Settings → Paystack flow)
    const countryCode = store.countryCode || profileData?.profile?.countryCode || ''

    // Refs
    const dropdownRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // Form state
    const [selectedBank, setSelectedBank] = useState<Bank | null>(null)
    const [accountNumber, setAccountNumber] = useState('')
    const [idNumber, setIdNumber] = useState('') // For South Africa
    const [showBankDropdown, setShowBankDropdown] = useState(false)
    const [bankSearchQuery, setBankSearchQuery] = useState('')
    const [connectError, setConnectError] = useState<string | null>(null)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowBankDropdown(false)
                setHighlightedIndex(-1)
            }
        }

        if (showBankDropdown) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showBankDropdown])

    // Reset highlighted index when search query changes
    useEffect(() => {
        setHighlightedIndex(-1)
    }, [bankSearchQuery])

    // Keyboard navigation for dropdown
    const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
        if (!showBankDropdown) return

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setHighlightedIndex(prev =>
                    prev < filteredBanks.length - 1 ? prev + 1 : prev
                )
                break
            case 'ArrowUp':
                e.preventDefault()
                setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0)
                break
            case 'Enter':
                e.preventDefault()
                if (highlightedIndex >= 0 && highlightedIndex < filteredBanks.length) {
                    handleSelectBank(filteredBanks[highlightedIndex])
                }
                break
            case 'Escape':
                e.preventDefault()
                setShowBankDropdown(false)
                setHighlightedIndex(-1)
                break
        }
    }

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightedIndex >= 0 && listRef.current) {
            const items = listRef.current.querySelectorAll('.paystack-dropdown-item')
            if (items[highlightedIndex]) {
                items[highlightedIndex].scrollIntoView({ block: 'nearest' })
            }
        }
    }, [highlightedIndex])

    // API hooks
    const { data: banksData, isLoading: loadingBanks, isError: banksError } = usePaystackBanks(countryCode || '')
    const resolveAccount = usePaystackResolveAccount()
    const connectPaystack = usePaystackConnect()

    // Verification state
    const [verifiedName, setVerifiedName] = useState<string | null>(null)
    const [verifyError, setVerifyError] = useState<string | null>(null)
    const [isTyping, setIsTyping] = useState(false)
    const [verificationSkipped, setVerificationSkipped] = useState(false)
    const [manualAccountName, setManualAccountName] = useState('')

    const banks = banksData?.banks || []
    const isSouthAfrica = countryCode?.toUpperCase() === 'ZA'
    const isKenya = countryCode?.toUpperCase() === 'KE'

    // Account number length varies by country
    const minAccountLength = isSouthAfrica ? 9 : isKenya ? 10 : 10 // NG: 10, KE: 10-14, ZA: 9-11
    const accountHint = isSouthAfrica ? '9-11 digits' : isKenya ? '10-14 digits' : '10 digits'

    // Go back to payment method step
    const handleBack = () => {
        navigate(-1)
    }

    // Filter banks by search query
    const filteredBanks = banks.filter(bank =>
        bank.name.toLowerCase().includes(bankSearchQuery.toLowerCase())
    )

    // Auto-verify account when account number meets minimum length
    useEffect(() => {
        // Show typing indicator during debounce if we have enough characters
        if (selectedBank && accountNumber.length >= minAccountLength) {
            setIsTyping(true)
        }

        const verifyAccount = async () => {
            setIsTyping(false)

            if (!selectedBank || accountNumber.length < minAccountLength) {
                setVerifiedName(null)
                setVerifyError(null)
                return
            }

            try {
                const result = await resolveAccount.mutateAsync({
                    accountNumber,
                    bankCode: selectedBank.code,
                    ...(isSouthAfrica && idNumber ? { idNumber } : {}),
                })
                if (result.verified && result.accountName) {
                    setVerifiedName(result.accountName)
                    setVerifyError(null)
                    setVerificationSkipped(false)
                } else if (result.verificationSkipped) {
                    // Kenya: verification not available, allow manual name entry
                    setVerifiedName(null)
                    setVerifyError(null)
                    setVerificationSkipped(true)
                } else {
                    setVerifiedName(null)
                    setVerifyError(result.error || 'Could not verify account. Please check the details.')
                    setVerificationSkipped(false)
                }
            } catch (err: any) {
                setVerifiedName(null)
                setVerifyError(err?.error || 'Could not verify account. Please check the details.')
                setVerificationSkipped(false)
            }
        }

        const debounce = setTimeout(verifyAccount, 500)
        return () => {
            clearTimeout(debounce)
            setIsTyping(false)
        }
    }, [accountNumber, selectedBank, idNumber, isSouthAfrica, minAccountLength])

    const handleSelectBank = (bank: Bank) => {
        setSelectedBank(bank)
        setShowBankDropdown(false)
        setBankSearchQuery('')
        // Reset verification when bank changes
        setVerifiedName(null)
        setVerifyError(null)
        setConnectError(null)
        setVerificationSkipped(false)
        setManualAccountName('')
    }

    // Allow submission if verified OR if verification was skipped (Kenya) with manual name
    const effectiveAccountName = verifiedName || (verificationSkipped && manualAccountName.trim().length >= 2 ? manualAccountName.trim() : null)
    const canSubmit = selectedBank && accountNumber.length >= minAccountLength && effectiveAccountName && !resolveAccount.isPending
        && (!isSouthAfrica || idNumber.length >= 13)

    const handleSubmit = async () => {
        if (!canSubmit || !selectedBank || !effectiveAccountName) return

        // Check for network connection
        if (!navigator.onLine) {
            setConnectError("You're offline. Please check your internet connection and try again.")
            return
        }

        setConnectError(null)
        try {
            await connectPaystack.mutateAsync({
                bankCode: selectedBank.code,
                accountNumber,
                accountName: effectiveAccountName,
                ...(isSouthAfrica && { idNumber }),
            })

            // Success - go to success page (don't reset here, success page will do it)
            navigate('/onboarding/paystack/complete')
        } catch (err: any) {
            setConnectError(err?.error || 'Failed to connect bank account. Please try again.')
        }
    }

    if (loadingBanks) {
        return (
            <div className="onboarding">
                <div className="onboarding-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                    <Loader2 size={32} className="spin" />
                </div>
            </div>
        )
    }

    // Banks API error
    if (banksError) {
        return (
            <div className="onboarding">
                <div className="onboarding-logo-header">
                    <img src="/logo.svg" alt="NatePay" />
                </div>
                <div className="onboarding-header">
                    <Pressable className="onboarding-back" onClick={handleBack}>
                        <ChevronLeft size={24} />
                    </Pressable>
                </div>
                <div className="onboarding-content">
                    <div className="paystack-error" style={{ marginTop: 32 }}>
                        <AlertCircle size={18} />
                        <span>Failed to load banks. Please check your connection and try again.</span>
                    </div>
                    <div style={{ marginTop: 16 }}>
                        <Button variant="secondary" size="lg" fullWidth onClick={handleBack}>
                            Go Back
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-header">
                <Pressable className="onboarding-back" onClick={handleBack}>
                    <ChevronLeft size={24} />
                </Pressable>
            </div>

            <div className="onboarding-content">
                <div className="step-header">
                    <h1>Connect your bank</h1>
                    <p>Add your bank account to receive payments directly.</p>
                </div>

                <div className="step-body">
                    {/* Error display */}
                    {(verifyError || connectError) && (
                        <div className="paystack-error">
                            <AlertCircle size={18} />
                            <span>{connectError || verifyError}</span>
                        </div>
                    )}

                    {/* Bank Selection */}
                    <div className="paystack-field" ref={dropdownRef}>
                        <label className="paystack-label">Select your bank</label>
                        <Pressable
                            className={`paystack-dropdown-trigger ${showBankDropdown ? 'open' : ''}`}
                            onClick={() => setShowBankDropdown(!showBankDropdown)}
                        >
                            {selectedBank ? (
                                <div className="paystack-selected-bank">
                                    <Building2 size={18} />
                                    <span>{selectedBank.name}</span>
                                </div>
                            ) : (
                                <span className="paystack-placeholder">Choose a bank...</span>
                            )}
                            <ChevronDown size={18} className={`paystack-chevron ${showBankDropdown ? 'rotated' : ''}`} />
                        </Pressable>

                        {showBankDropdown && (
                            <div className="paystack-dropdown" onKeyDown={handleDropdownKeyDown}>
                                <input
                                    type="text"
                                    className="paystack-dropdown-search"
                                    placeholder="Search banks..."
                                    value={bankSearchQuery}
                                    onChange={(e) => setBankSearchQuery(e.target.value)}
                                    onKeyDown={handleDropdownKeyDown}
                                    autoFocus
                                />
                                <div className="paystack-dropdown-list" ref={listRef}>
                                    {filteredBanks.length > 0 ? (
                                        filteredBanks.map((bank, index) => (
                                            <Pressable
                                                key={bank.code}
                                                className={`paystack-dropdown-item ${selectedBank?.code === bank.code ? 'selected' : ''} ${highlightedIndex === index ? 'highlighted' : ''}`}
                                                onClick={() => handleSelectBank(bank)}
                                                onMouseEnter={() => setHighlightedIndex(index)}
                                            >
                                                <span>{bank.name}</span>
                                                {selectedBank?.code === bank.code && <Check size={16} />}
                                            </Pressable>
                                        ))
                                    ) : (
                                        <div className="paystack-dropdown-empty">No banks found</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Account Number */}
                    <div className="paystack-field">
                        <label className="paystack-label">Account number</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="paystack-input"
                            placeholder="Enter account number"
                            value={accountNumber}
                            onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && canSubmit) {
                                    e.preventDefault()
                                    handleSubmit()
                                }
                            }}
                            maxLength={15}
                        />
                        <span className="paystack-hint">{accountHint}</span>
                    </div>

                    {/* Verification Status */}
                    {isTyping && !resolveAccount.isPending && (
                        <div className="paystack-typing">
                            <span>Will verify when you stop typing...</span>
                        </div>
                    )}

                    {resolveAccount.isPending && (
                        <div className="paystack-verifying">
                            <Loader2 size={16} className="spin" />
                            <span>Verifying account...</span>
                        </div>
                    )}

                    {verifiedName && !isTyping && !resolveAccount.isPending && (
                        <div className="paystack-verified">
                            <Check size={16} />
                            <span>{verifiedName}</span>
                        </div>
                    )}

                    {/* Kenya: Manual account name entry (verification not available) */}
                    {verificationSkipped && !isTyping && !resolveAccount.isPending && (
                        <div className="paystack-field">
                            <label className="paystack-label">Account holder name</label>
                            <input
                                type="text"
                                className="paystack-input"
                                placeholder="Enter the name on this account"
                                value={manualAccountName}
                                onChange={(e) => setManualAccountName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && canSubmit) {
                                        e.preventDefault()
                                        handleSubmit()
                                    }
                                }}
                                maxLength={100}
                            />
                            <span className="paystack-hint">
                                Account verification is not available in Kenya. Please enter the exact name on your bank account.
                            </span>
                        </div>
                    )}

                    {/* SA ID Number (South Africa only) */}
                    {isSouthAfrica && (
                        <div className="paystack-field">
                            <label className="paystack-label">SA ID Number</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                className="paystack-input"
                                placeholder="Enter your SA ID number"
                                value={idNumber}
                                onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ''))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && canSubmit) {
                                        e.preventDefault()
                                        handleSubmit()
                                    }
                                }}
                                maxLength={13}
                            />
                            <span className="paystack-hint">Required for South African bank accounts</span>
                        </div>
                    )}

                    {/* Security note */}
                    <p className="paystack-security-note">
                        Your bank details are encrypted and securely stored. We use Paystack, a licensed payment processor.
                    </p>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleSubmit}
                        disabled={!canSubmit || connectPaystack.isPending}
                    >
                        {connectPaystack.isPending ? (
                            <>
                                <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                                Connecting...
                            </>
                        ) : (
                            'Connect Payment Method'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
