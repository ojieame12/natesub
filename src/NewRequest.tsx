import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Copy, Share2, Check } from 'lucide-react'
import { Pressable } from './components'
import { useCurrentUser } from './api/hooks'
import { getCurrencySymbol } from './utils/currency'
import './NewRequest.css'

const quickAmounts = [5, 10, 25, 50]

export default function NewRequest() {
  const navigate = useNavigate()
  const { data: userData } = useCurrentUser()
  const currencySymbol = getCurrencySymbol(userData?.profile?.currency || 'USD')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [copied, setCopied] = useState(false)

  const displayAmount = amount || '0'
  const isValidAmount = parseFloat(amount) > 0

  const handleAmountChange = (value: string) => {
    // Only allow numbers and one decimal point
    const cleaned = value.replace(/[^0-9.]/g, '')
    const parts = cleaned.split('.')
    if (parts.length > 2) return
    if (parts[1]?.length > 2) return
    setAmount(cleaned)
  }

  const handleQuickAmount = (value: number) => {
    setAmount(value.toString())
  }

  const handleCopyLink = async () => {
    const link = `https://nate.to/pay?amount=${amount}&recurring=${isRecurring}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleShare = async () => {
    const link = `https://nate.to/pay?amount=${amount}&recurring=${isRecurring}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Payment Request - ${currencySymbol}${amount}`,
          text: note || `Payment request for ${currencySymbol}${amount}`,
          url: link,
        })
      } catch (err) {
        console.error('Failed to share:', err)
      }
    } else {
      handleCopyLink()
    }
  }

  return (
    <div className="new-request-page">
      {/* Header */}
      <header className="new-request-header">
        <Pressable className="close-btn" onClick={() => navigate(-1)}>
          <X size={20} />
        </Pressable>
        <span className="new-request-title">New Request</span>
        <div className="header-spacer" />
      </header>

      {/* Amount Section */}
      <div className="amount-section">
        <div className="amount-display">
          <span className="currency">$</span>
          <input
            type="text"
            inputMode="decimal"
            className="amount-input"
            value={displayAmount}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="0"
          />
        </div>

        {/* Quick Amounts */}
        <div className="quick-amounts">
          {quickAmounts.map((value) => (
            <Pressable
              key={value}
              className={`quick-amount-btn ${amount === value.toString() ? 'active' : ''}`}
              onClick={() => handleQuickAmount(value)}
            >
              ${value}
            </Pressable>
          ))}
        </div>
      </div>

      {/* Options Section */}
      <div className="options-section">
        {/* Note Input */}
        <div className="option-card">
          <label className="option-label">What's this for?</label>
          <input
            type="text"
            className="option-input"
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Payment Type */}
        <div className="option-card">
          <label className="option-label">Payment type</label>
          <div className="payment-type-toggle">
            <Pressable
              className={`toggle-option ${!isRecurring ? 'active' : ''}`}
              onClick={() => setIsRecurring(false)}
            >
              One-time
            </Pressable>
            <Pressable
              className={`toggle-option ${isRecurring ? 'active' : ''}`}
              onClick={() => setIsRecurring(true)}
            >
              Monthly
            </Pressable>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="action-section">
        <Pressable
          className="action-btn primary"
          onClick={handleShare}
          disabled={!isValidAmount}
        >
          <Share2 size={20} />
          <span>Share Request</span>
        </Pressable>
        <Pressable
          className="action-btn secondary"
          onClick={handleCopyLink}
          disabled={!isValidAmount}
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
          <span>{copied ? 'Copied!' : 'Copy Link'}</span>
        </Pressable>
      </div>
    </div>
  )
}
