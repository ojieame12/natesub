import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, RefreshCw, Zap } from 'lucide-react'
import { useRequestStore, getSuggestedAmounts, getRelationshipLabel } from './store'
import { useCurrentUser } from '../api/hooks'
import { getCurrencySymbol } from '../utils/currency'
import { Pressable } from '../components'
import './request.css'

export default function RequestDetails() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const isService = userData?.profile?.purpose === 'service'
    const {
        recipient,
        relationship,
        amount,
        isRecurring,
        purpose,
        dueDate,
        setAmount,
        setIsRecurring,
        setPurpose,
        setDueDate,
    } = useRequestStore()

    const currency = userData?.profile?.currency || 'USD'
    const currencySymbol = getCurrencySymbol(currency)
    const [customAmount, setCustomAmount] = useState(amount.toString())

    if (!recipient) {
        navigate('/request/new')
        return null
    }

    const suggestedAmounts = getSuggestedAmounts(relationship)
    const relationshipLabel = getRelationshipLabel(relationship)
    const firstName = recipient.name.split(' ')[0]

    const handleAmountSelect = (value: number) => {
        setAmount(value)
        setCustomAmount(value.toString())
    }

    const handleCustomAmountChange = (value: string) => {
        const cleaned = value.replace(/[^0-9]/g, '')
        setCustomAmount(cleaned)
        const num = parseInt(cleaned) || 0
        setAmount(num)
    }

    const handleContinue = () => {
        if (amount > 0) {
            navigate('/request/personalize')
        }
    }

    // Purpose suggestions based on relationship and user type
    const purposeSuggestions = isService
        ? ['Retainer', 'Project fee', 'Consultation', 'Coaching session', 'Services rendered']
        : relationship?.startsWith('family_')
        ? ['Help with bills', 'Allowance', 'Support my goals', 'Just because']
        : relationship?.startsWith('client')
        ? ['Retainer', 'Project fee', 'Consultation', 'Services']
        : ['Support my work', 'Monthly support', 'Tip jar', 'General support']

    return (
        <div className="request-page">
            {/* Header */}
            <header className="request-header">
                <Pressable className="request-back-btn" onClick={() => navigate(-1)}>
                    <ChevronLeft size={20} />
                </Pressable>
                <span className="request-title">{isService ? 'Invoice Details' : 'Request Details'}</span>
                <div className="request-header-spacer" />
            </header>

            <div className="request-content">
                {/* Recipient Badge */}
                <div className="request-recipient-badge">
                    <div className="request-recipient-avatar-small">
                        {recipient.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="request-recipient-badge-name">{firstName}</span>
                    {relationshipLabel && (
                        <span className="request-recipient-badge-relationship">{relationshipLabel}</span>
                    )}
                </div>

                {/* Amount Section */}
                <div className="request-amount-section">
                    <label className="request-label">How much?</label>
                    <div className="request-amount-display">
                        <span className="request-currency">{currencySymbol}</span>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={customAmount}
                            onChange={(e) => handleCustomAmountChange(e.target.value)}
                            className="request-amount-input"
                            placeholder="0"
                        />
                    </div>

                    {/* Quick Amounts */}
                    <div className="request-quick-amounts">
                        {suggestedAmounts.map((value) => (
                            <Pressable
                                key={value}
                                className={`request-quick-amount ${amount === value ? 'active' : ''}`}
                                onClick={() => handleAmountSelect(value)}
                            >
                                {currencySymbol}{value}
                            </Pressable>
                        ))}
                    </div>
                </div>

                {/* Payment Type Toggle */}
                <div className="request-option-section">
                    <label className="request-label">Payment type</label>
                    <div className="request-type-toggle">
                        <Pressable
                            className={`request-type-option ${!isRecurring ? 'active' : ''}`}
                            onClick={() => setIsRecurring(false)}
                        >
                            <Zap size={16} />
                            <span>One-time</span>
                        </Pressable>
                        <Pressable
                            className={`request-type-option ${isRecurring ? 'active' : ''}`}
                            onClick={() => setIsRecurring(true)}
                        >
                            <RefreshCw size={16} />
                            <span>Monthly</span>
                        </Pressable>
                    </div>
                </div>

                {/* Purpose Section */}
                <div className="request-option-section">
                    <label className="request-label">
                        {isService ? 'Service description (optional)' : "What's this for? (optional)"}
                    </label>
                    <input
                        type="text"
                        value={purpose}
                        onChange={(e) => setPurpose(e.target.value)}
                        placeholder={isService ? "Describe the service..." : "Add a purpose..."}
                        className="request-text-input"
                    />
                    <div className="request-purpose-suggestions">
                        {purposeSuggestions.map((suggestion) => (
                            <Pressable
                                key={suggestion}
                                className={`request-purpose-chip ${purpose === suggestion ? 'active' : ''}`}
                                onClick={() => setPurpose(suggestion)}
                            >
                                {suggestion}
                            </Pressable>
                        ))}
                    </div>
                </div>

                {/* Due Date - Service providers only */}
                {isService && (
                    <div className="request-option-section">
                        <label className="request-label">Due date (optional)</label>
                        <input
                            type="date"
                            value={dueDate || ''}
                            onChange={(e) => setDueDate(e.target.value || null)}
                            className="request-text-input"
                            min={new Date().toISOString().split('T')[0]}
                        />
                    </div>
                )}
            </div>

            {/* Continue Button */}
            <div className="request-footer">
                <Pressable
                    className="request-continue-btn"
                    onClick={handleContinue}
                    disabled={amount <= 0}
                >
                    Continue
                </Pressable>
            </div>
        </div>
    )
}
