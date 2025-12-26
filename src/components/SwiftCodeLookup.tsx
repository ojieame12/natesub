/**
 * SwiftCodeLookup - Pre-Stripe onboarding modal for cross-border countries
 *
 * Shows users their bank's SWIFT code before redirecting to Stripe,
 * reducing friction for users in NG, GH, KE who may not know their SWIFT code.
 * (ZA has native Stripe support and doesn't need SWIFT lookup)
 */

import { useState } from 'react'
import { Copy, Check, ArrowRight, X, HelpCircle } from 'lucide-react'
import { Pressable } from './index'
import { getBanksForCountry, getCountryName, type BankInfo } from '../utils/swiftCodes'
import './SwiftCodeLookup.css'

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
