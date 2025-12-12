import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronDown, Check, Loader2, AlertCircle, Building2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { usePaystackBanks, usePaystackResolveAccount, usePaystackConnect } from '../api/hooks'
import './onboarding.css'

interface Bank {
    code: string
    name: string
    type: string
}

export default function PaystackConnect() {
    const navigate = useNavigate()
    const store = useOnboardingStore()
    const { countryCode, prevStep, reset } = store

    // Form state
    const [selectedBank, setSelectedBank] = useState<Bank | null>(null)
    const [accountNumber, setAccountNumber] = useState('')
    const [idNumber, setIdNumber] = useState('') // For South Africa
    const [showBankDropdown, setShowBankDropdown] = useState(false)
    const [bankSearchQuery, setBankSearchQuery] = useState('')

    // API hooks
    const { data: banksData, isLoading: loadingBanks } = usePaystackBanks(countryCode || '')
    const resolveAccount = usePaystackResolveAccount()
    const connectPaystack = usePaystackConnect()

    // Verification state
    const [verifiedName, setVerifiedName] = useState<string | null>(null)
    const [verifyError, setVerifyError] = useState<string | null>(null)

    const banks = banksData?.banks || []
    const isSouthAfrica = countryCode?.toUpperCase() === 'ZA'

    // Filter banks by search query
    const filteredBanks = banks.filter(bank =>
        bank.name.toLowerCase().includes(bankSearchQuery.toLowerCase())
    )

    // Auto-verify account when account number is complete (10 digits for Nigeria)
    useEffect(() => {
        const verifyAccount = async () => {
            if (!selectedBank || accountNumber.length < 10) {
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
                } else {
                    setVerifiedName(null)
                    setVerifyError(result.error || 'Could not verify account')
                }
            } catch (err: any) {
                setVerifiedName(null)
                setVerifyError(err?.error || 'Could not verify account')
            }
        }

        const debounce = setTimeout(verifyAccount, 500)
        return () => clearTimeout(debounce)
    }, [accountNumber, selectedBank, idNumber, isSouthAfrica])

    const handleSelectBank = (bank: Bank) => {
        setSelectedBank(bank)
        setShowBankDropdown(false)
        setBankSearchQuery('')
        // Reset verification when bank changes
        setVerifiedName(null)
        setVerifyError(null)
    }

    const canSubmit = selectedBank && accountNumber.length >= 10 && verifiedName && !resolveAccount.isPending
        && (!isSouthAfrica || idNumber.length >= 13)

    const handleSubmit = async () => {
        if (!canSubmit || !selectedBank || !verifiedName) return

        try {
            await connectPaystack.mutateAsync({
                bankCode: selectedBank.code,
                accountNumber,
                accountName: verifiedName,
                ...(isSouthAfrica && { idNumber }),
            })

            // Success - go to dashboard
            reset()
            navigate('/dashboard')
        } catch (err: any) {
            setVerifyError(err?.error || 'Failed to connect bank account')
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
                <div className="step-header">
                    <h1>Connect your bank</h1>
                    <p>Add your bank account to receive payments directly.</p>
                </div>

                <div className="step-body">
                    {/* Error display */}
                    {(verifyError || connectPaystack.isError) && (
                        <div className="paystack-error">
                            <AlertCircle size={18} />
                            <span>{verifyError || 'Failed to connect. Please try again.'}</span>
                        </div>
                    )}

                    {/* Bank Selection */}
                    <div className="paystack-field">
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
                            <div className="paystack-dropdown">
                                <input
                                    type="text"
                                    className="paystack-dropdown-search"
                                    placeholder="Search banks..."
                                    value={bankSearchQuery}
                                    onChange={(e) => setBankSearchQuery(e.target.value)}
                                    autoFocus={false}
                                />
                                <div className="paystack-dropdown-list">
                                    {filteredBanks.length > 0 ? (
                                        filteredBanks.map(bank => (
                                            <Pressable
                                                key={bank.code}
                                                className={`paystack-dropdown-item ${selectedBank?.code === bank.code ? 'selected' : ''}`}
                                                onClick={() => handleSelectBank(bank)}
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
                            maxLength={15}
                        />
                    </div>

                    {/* Verification Status */}
                    {resolveAccount.isPending && (
                        <div className="paystack-verifying">
                            <Loader2 size={16} className="spin" />
                            <span>Verifying account...</span>
                        </div>
                    )}

                    {verifiedName && (
                        <div className="paystack-verified">
                            <Check size={16} />
                            <span>{verifiedName}</span>
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
                            'Connect Bank Account'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
