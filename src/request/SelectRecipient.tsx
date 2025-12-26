import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronRight, Zap, RefreshCw } from 'lucide-react'
import { useRequestStore, type Recipient } from './store'
import { useCurrentUser, useRequests } from '../api/hooks'
import { getCurrencySymbol, getSuggestedAmounts, formatCompactNumber, isZeroDecimalCurrency } from '../utils/currency'
import { Pressable } from '../components'
import './request.css'

export default function SelectRecipient() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const isService = userData?.profile?.purpose === 'service'
    const currency = userData?.profile?.currency || 'USD'
    const currencySymbol = getCurrencySymbol(currency)

    const { setRecipient, setAmount, setIsRecurring, setPurpose, reset } = useRequestStore()

    // Fetch past requests to get recent recipients
    const { data: requestsData } = useRequests('all')

    // Extract unique recent recipients from past requests
    const recentRecipients = useMemo(() => {
        if (!requestsData?.pages) return []

        const allRequests = requestsData.pages.flatMap(page => page.requests)
        const seen = new Set<string>()
        const recipients: Recipient[] = []

        for (const req of allRequests) {
            const key = req.recipientEmail || req.recipientName
            if (!seen.has(key) && recipients.length < 4) {
                seen.add(key)
                recipients.push({
                    id: `recent-${req.id}`,
                    name: req.recipientName,
                    email: req.recipientEmail || undefined,
                })
            }
        }

        return recipients
    }, [requestsData])

    // Form state - all on one screen
    const [recipientName, setRecipientName] = useState('')
    const [amount, setLocalAmount] = useState('')
    const [isRecurring, setLocalRecurring] = useState(false)
    const [purpose, setLocalPurpose] = useState('')

    // Get currency-aware suggested amounts (e.g., ₦5000 for NGN vs $10 for USD)
    const suggestedAmounts = getSuggestedAmounts(currency, isService ? 'service' : 'personal')
    const purposeSuggestions = isService
        ? ['Retainer', 'Project', 'Consultation', 'Services']
        : ['Support', 'Monthly', 'Tip', 'Help']

    const handleAmountSelect = (value: number) => {
        setLocalAmount(value.toString())
    }

    const handleSelectRecent = (recipient: Recipient) => {
        setRecipientName(recipient.name)
    }

    const handleContinue = () => {
        if (!recipientName.trim() || !amount) return

        const recipient: Recipient = {
            id: `manual-${Date.now()}`,
            name: recipientName.trim(),
        }

        setRecipient(recipient)
        setAmount(parseInt(amount) || 0)
        setIsRecurring(isRecurring)
        setPurpose(purpose)

        // Skip relationship/details/personalize, go straight to preview
        navigate('/request/preview')
    }

    const handleClose = () => {
        reset()
        navigate(-1)
    }

    const canContinue = recipientName.trim().length > 0 && parseInt(amount) > 0

    return (
        <div className="request-page request-page-modern">
            {/* Header */}
            <header className="request-header">
                <Pressable className="request-close-btn" onClick={handleClose}>
                    <X size={20} />
                </Pressable>
                <span className="request-header-title">
                    {isService ? 'New Invoice' : 'New Request'}
                </span>
                <div className="request-header-spacer" />
            </header>

            <div className="request-content-modern">
                {/* Amount Section - Hero */}
                <div className="request-amount-hero">
                    <div className="request-amount-display-modern">
                        <span className="request-currency-modern">{currencySymbol}</span>
                        <input
                            type="text"
                            inputMode={isZeroDecimalCurrency(currency) ? 'numeric' : 'decimal'}
                            value={amount}
                            onChange={(e) => {
                                // Allow decimals for non-zero-decimal currencies (USD, EUR, etc.)
                                // Only allow integers for zero-decimal currencies (JPY, KRW, etc.)
                                const pattern = isZeroDecimalCurrency(currency)
                                    ? /[^0-9]/g
                                    : /[^0-9.]/g
                                let value = e.target.value.replace(pattern, '')
                                // Prevent multiple decimal points
                                const parts = value.split('.')
                                if (parts.length > 2) {
                                    value = parts[0] + '.' + parts.slice(1).join('')
                                }
                                // Limit to 2 decimal places for non-zero-decimal
                                if (parts.length === 2 && parts[1].length > 2) {
                                    value = parts[0] + '.' + parts[1].slice(0, 2)
                                }
                                setLocalAmount(value)
                            }}
                            className="request-amount-input-modern"
                            placeholder="0"
                            autoFocus
                        />
                    </div>

                    {/* Quick Amounts - currency aware */}
                    <div className="request-quick-amounts-modern">
                        {suggestedAmounts.map((value) => (
                            <Pressable
                                key={value}
                                className={`request-chip ${parseFloat(amount) === value ? 'active' : ''}`}
                                onClick={() => handleAmountSelect(value)}
                            >
                                {currencySymbol}{formatCompactNumber(value)}
                            </Pressable>
                        ))}
                    </div>
                </div>

                {/* Recipient Input */}
                <div className="request-field">
                    <label className="request-field-label">To</label>
                    <input
                        type="text"
                        placeholder={isService ? "Client name" : "Recipient name"}
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        className="request-field-input"
                    />

                    {/* Recent Recipients */}
                    {recentRecipients.length > 0 && !recipientName && (
                        <div className="request-recent-chips">
                            {recentRecipients.map((r) => (
                                <Pressable
                                    key={r.id}
                                    className="request-recent-chip"
                                    onClick={() => handleSelectRecent(r)}
                                >
                                    <span className="request-recent-avatar">
                                        {r.name.charAt(0).toUpperCase()}
                                    </span>
                                    {r.name.split(' ')[0]}
                                </Pressable>
                            ))}
                        </div>
                    )}
                </div>

                {/* Payment Type Toggle */}
                <div className="request-field">
                    <label className="request-field-label">Type</label>
                    <div className="request-type-toggle-modern">
                        <Pressable
                            className={`request-type-btn ${!isRecurring ? 'active' : ''}`}
                            onClick={() => setLocalRecurring(false)}
                        >
                            <Zap size={16} />
                            One-time
                        </Pressable>
                        <Pressable
                            className={`request-type-btn ${isRecurring ? 'active' : ''}`}
                            onClick={() => setLocalRecurring(true)}
                        >
                            <RefreshCw size={16} />
                            Monthly
                        </Pressable>
                    </div>
                </div>

                {/* Purpose */}
                <div className="request-field">
                    <label className="request-field-label">For</label>
                    <div className="request-purpose-chips">
                        {purposeSuggestions.map((p) => (
                            <Pressable
                                key={p}
                                className={`request-chip ${purpose === p ? 'active' : ''}`}
                                onClick={() => setLocalPurpose(purpose === p ? '' : p)}
                            >
                                {p}
                            </Pressable>
                        ))}
                        <input
                            type="text"
                            placeholder="Custom..."
                            value={purposeSuggestions.includes(purpose) ? '' : purpose}
                            onChange={(e) => setLocalPurpose(e.target.value)}
                            className="request-purpose-input"
                        />
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="request-footer-modern">
                <Pressable
                    className={`request-continue-btn-modern ${canContinue ? '' : 'disabled'}`}
                    onClick={handleContinue}
                    disabled={!canContinue}
                >
                    Continue
                    <ChevronRight size={20} />
                </Pressable>
            </div>
        </div>
    )
}
