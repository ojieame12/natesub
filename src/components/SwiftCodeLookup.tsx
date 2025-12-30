/**
 * SwiftCodeLookup - Pre-Stripe onboarding modal for cross-border countries
 *
 * Shows users their bank's SWIFT code before redirecting to Stripe,
 * reducing friction for users in NG, GH, KE who may not know their SWIFT code.
 * (ZA has native Stripe support and doesn't need SWIFT lookup)
 */

import { useState } from 'react'
import { Copy, Check, ArrowRight, X, HelpCircle, Pencil } from 'lucide-react'
import { Pressable } from './index'
import { getBanksForCountry, getCountryName, type BankInfo } from '../utils/swiftCodes'
import './SwiftCodeLookup.css'

// Postal code guidance by country
const POSTAL_CODE_HINTS: Record<string, { format: string; example: string; note?: string }> = {
  NG: { format: '6 digits', example: '100001', note: 'Lagos Island' },
  GH: { format: '2 letters + numbers', example: 'GA-123-4567', note: 'or just use GA for Accra' },
  KE: { format: '5 digits', example: '00100', note: 'Nairobi GPO' },
}

interface SwiftCodeLookupProps {
  countryCode: string
  onContinue: () => void
  onClose: () => void
}

export function SwiftCodeLookup({ countryCode, onContinue, onClose }: SwiftCodeLookupProps) {
  const [selectedBank, setSelectedBank] = useState<BankInfo | null>(null)
  const [copied, setCopied] = useState(false)

  const banks = getBanksForCountry(countryCode)
  const countryName = getCountryName(countryCode)
  const postalHint = POSTAL_CODE_HINTS[countryCode]

  const handleCopy = async () => {
    if (!selectedBank) return

    try {
      await navigator.clipboard.writeText(selectedBank.swiftCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = selectedBank.swiftCode
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleBankChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const bankName = e.target.value
    const bank = banks.find((b) => b.name === bankName) || null
    setSelectedBank(bank)
    setCopied(false)
  }

  return (
    <>
      <div className="swift-overlay" onClick={onClose} />
      <div className="swift-modal">
        <div className="swift-header">
          <div className="swift-header-content">
            <HelpCircle size={24} className="swift-header-icon" />
            <h2 className="swift-title">Before you continue</h2>
          </div>
          <Pressable className="swift-close" onClick={onClose}>
            <X size={20} />
          </Pressable>
        </div>

        <p className="swift-description">
          Stripe will ask for your bank's SWIFT code. Select your {countryName} bank below to find it.
        </p>

        <div className="swift-select-wrapper">
          <select
            className="swift-select"
            value={selectedBank?.name || ''}
            onChange={handleBankChange}
          >
            <option value="">Select your bank</option>
            {banks.map((bank) => (
              <option key={bank.swiftCode} value={bank.name}>
                {bank.name}
              </option>
            ))}
          </select>
        </div>

        {selectedBank && (
          <div className="swift-result">
            <div className="swift-result-label">Your SWIFT code:</div>
            <div className="swift-result-code">
              <span className="swift-code-text">{selectedBank.swiftCode}</span>
              <Pressable className="swift-copy-btn" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check size={16} />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    <span>Copy</span>
                  </>
                )}
              </Pressable>
            </div>
          </div>
        )}

        {/* Postal code guidance */}
        {postalHint && (
          <div className="swift-postal">
            <div className="swift-result-label">Your postal code:</div>
            <p className="swift-postal-hint">
              Stripe will also ask for your postal code. In {countryName}, use {postalHint.format}.
            </p>
            <div className="swift-postal-example">
              Example: <strong>{postalHint.example}</strong>
              {postalHint.note && <span className="swift-postal-note"> ({postalHint.note})</span>}
            </div>
          </div>
        )}

        {/* Write it down reminder */}
        <div className="swift-reminder">
          <Pencil size={16} />
          <span>Write these down before continuing — you'll need them on the next screen.</span>
        </div>

        <div className="swift-actions">
          <Pressable className="swift-continue-btn" onClick={onContinue}>
            <span>Continue to Stripe</span>
            <ArrowRight size={18} />
          </Pressable>
        </div>

        <p className="swift-footer">
          Don't see your bank? You can find your SWIFT code on your bank's website or mobile app.
        </p>
      </div>
    </>
  )
}
