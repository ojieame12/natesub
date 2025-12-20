/**
 * CreateCreator - Admin page for creating creator accounts (Concierge Onboarding)
 *
 * Allows admin to create a fully-functional creator account with:
 * - Email, display name, username
 * - Country (Paystack only: NG, KE, ZA)
 * - Bank details (from Paystack bank list)
 * - Subscription amount
 *
 * Creator receives email with their ready-to-use payment link.
 */

import { useState, useEffect } from 'react'
import { usePaystackBanks, useResolveAccount, useCreateCreator } from '../api'

type PaystackCountry = 'NG' | 'KE' | 'ZA'

const COUNTRIES: { code: PaystackCountry; name: string; currency: string; currencySymbol: string }[] = [
  { code: 'NG', name: 'Nigeria', currency: 'NGN', currencySymbol: '₦' },
  { code: 'KE', name: 'Kenya', currency: 'KES', currencySymbol: 'KSh' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', currencySymbol: 'R' },
]

export default function CreateCreator() {
  const [formData, setFormData] = useState({
    email: '',
    displayName: '',
    username: '',
    country: 'NG' as PaystackCountry,
    bankCode: '',
    accountNumber: '',
    amount: '',
  })

  const [resolvedAccount, setResolvedAccount] = useState<{ name: string; number: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ paymentLink: string; username: string } | null>(null)

  const selectedCountry = COUNTRIES.find(c => c.code === formData.country)!

  // Fetch banks for selected country
  const { data: banksData, isLoading: banksLoading } = usePaystackBanks(formData.country)

  // Account resolution mutation
  const resolveMutation = useResolveAccount()

  // Create creator mutation
  const createMutation = useCreateCreator()

  // Reset bank selection when country changes
  useEffect(() => {
    setFormData(prev => ({ ...prev, bankCode: '', accountNumber: '' }))
    setResolvedAccount(null)
  }, [formData.country])

  // Resolve account when bank and account number are filled
  const handleResolveAccount = async () => {
    if (!formData.bankCode || formData.accountNumber.length < 10) return

    // Kenya doesn't support account resolution
    if (formData.country === 'KE') {
      setResolvedAccount({ name: '(Validation on first payout)', number: formData.accountNumber })
      return
    }

    try {
      const result = await resolveMutation.mutateAsync({
        country: formData.country,
        bankCode: formData.bankCode,
        accountNumber: formData.accountNumber,
      })

      if (result.supported && result.accountName) {
        setResolvedAccount({ name: result.accountName, number: result.accountNumber || formData.accountNumber })
        setError(null)
      }
    } catch (err: any) {
      setResolvedAccount(null)
      setError(err.message || 'Could not verify account')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate required fields
    if (!formData.email || !formData.displayName || !formData.username) {
      setError('Please fill in all required fields')
      return
    }

    if (!formData.bankCode || !formData.accountNumber) {
      setError('Please select a bank and enter account number')
      return
    }

    const amount = parseFloat(formData.amount)
    if (!amount || amount <= 0) {
      setError('Please enter a valid subscription amount')
      return
    }

    try {
      const result = await createMutation.mutateAsync({
        email: formData.email,
        displayName: formData.displayName,
        username: formData.username,
        country: formData.country,
        bankCode: formData.bankCode,
        accountNumber: formData.accountNumber,
        accountName: resolvedAccount?.name,
        amount,
      })

      setSuccess({
        paymentLink: result.user.paymentLink,
        username: result.user.username,
      })

      // Reset form
      setFormData({
        email: '',
        displayName: '',
        username: '',
        country: 'NG',
        bankCode: '',
        accountNumber: '',
        amount: '',
      })
      setResolvedAccount(null)
    } catch (err: any) {
      setError(err.message || 'Failed to create account')
    }
  }

  const copyLink = () => {
    if (success) {
      navigator.clipboard.writeText(success.paymentLink)
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Create Creator Account</h1>
      <p className="admin-page-subtitle">
        Set up a fully-functional payment page for a creator. They'll receive an email with their ready-to-use link.
      </p>

      {success ? (
        <div className="admin-card" style={{ maxWidth: 600, margin: '24px auto', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: 20 }}>Account Created!</h2>
          <p style={{ color: '#666', marginBottom: 24 }}>
            Creator has been emailed their payment link.
          </p>

          <div style={{
            background: '#f5f5f5',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
          }}>
            <p style={{ fontSize: 14, color: '#888', margin: '0 0 8px 0' }}>Payment Link:</p>
            <p style={{ fontSize: 16, fontWeight: 600, margin: 0, wordBreak: 'break-all' }}>
              {success.paymentLink}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              className="admin-btn admin-btn-primary"
              onClick={copyLink}
            >
              Copy Link
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={() => setSuccess(null)}
            >
              Create Another
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="admin-card" style={{ maxWidth: 600 }}>
          {error && (
            <div className="admin-alert admin-alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Creator Info */}
          <div className="admin-form-section">
            <h3 className="admin-form-section-title">Creator Info</h3>

            <div className="admin-form-group">
              <label htmlFor="email">Email *</label>
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                placeholder="creator@example.com"
                required
              />
            </div>

            <div className="admin-form-group">
              <label htmlFor="displayName">Display Name *</label>
              <input
                id="displayName"
                type="text"
                value={formData.displayName}
                onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="John Doe"
                required
                maxLength={50}
              />
            </div>

            <div className="admin-form-group">
              <label htmlFor="username">Username *</label>
              <input
                id="username"
                type="text"
                value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                placeholder="johndoe"
                required
                maxLength={20}
                pattern="[a-z0-9_]+"
              />
              <p className="admin-form-hint">
                natepay.co/{formData.username || 'username'}
              </p>
            </div>
          </div>

          {/* Bank Details */}
          <div className="admin-form-section">
            <h3 className="admin-form-section-title">Bank Details</h3>

            <div className="admin-form-group">
              <label htmlFor="country">Country *</label>
              <select
                id="country"
                value={formData.country}
                onChange={e => setFormData({ ...formData, country: e.target.value as PaystackCountry })}
              >
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="admin-form-group">
              <label htmlFor="bank">Bank *</label>
              <select
                id="bank"
                value={formData.bankCode}
                onChange={e => {
                  setFormData({ ...formData, bankCode: e.target.value })
                  setResolvedAccount(null)
                }}
                disabled={banksLoading}
              >
                <option value="">Select a bank</option>
                {banksData?.banks?.map((bank: { code: string; name: string }) => (
                  <option key={bank.code} value={bank.code}>{bank.name}</option>
                ))}
              </select>
            </div>

            <div className="admin-form-group">
              <label htmlFor="accountNumber">Account Number *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="accountNumber"
                  type="text"
                  value={formData.accountNumber}
                  onChange={e => {
                    setFormData({ ...formData, accountNumber: e.target.value.replace(/\D/g, '') })
                    setResolvedAccount(null)
                  }}
                  placeholder="0123456789"
                  required
                  maxLength={20}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={handleResolveAccount}
                  disabled={!formData.bankCode || formData.accountNumber.length < 10 || resolveMutation.isPending}
                >
                  {resolveMutation.isPending ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </div>

            {resolvedAccount && (
              <div className="admin-form-group">
                <label>Account Name</label>
                <div style={{
                  background: '#e8f5e9',
                  padding: '12px 16px',
                  borderRadius: 8,
                  color: '#2e7d32',
                  fontWeight: 500,
                }}>
                  ✓ {resolvedAccount.name}
                </div>
              </div>
            )}
          </div>

          {/* Pricing */}
          <div className="admin-form-section">
            <h3 className="admin-form-section-title">Pricing</h3>

            <div className="admin-form-group">
              <label htmlFor="amount">Monthly Subscription Amount ({selectedCountry.currency}) *</label>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#666',
                }}>
                  {selectedCountry.currencySymbol}
                </span>
                <input
                  id="amount"
                  type="number"
                  value={formData.amount}
                  onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="500"
                  required
                  min="1"
                  step="any"
                  style={{ paddingLeft: 32 }}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="admin-btn admin-btn-primary"
            disabled={createMutation.isPending}
            style={{ width: '100%', marginTop: 16 }}
          >
            {createMutation.isPending ? 'Creating Account...' : 'Create Creator Account'}
          </button>
        </form>
      )}
    </div>
  )
}
