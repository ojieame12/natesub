import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Loader2, ExternalLink, ChevronDown, Check, Heart, Gift, Briefcase, Star, Sparkles, Wallet, MoreHorizontal } from 'lucide-react'
import { Pressable, useToast, Skeleton, LoadingButton, BottomDrawer } from './components'
import { useProfile, useUpdateProfile, uploadFile } from './api/hooks'
import { getCurrencySymbol, centsToDisplayAmount } from './utils/currency'
import './EditPage.css'

// Purpose options with labels and icons for visual differentiation
type Purpose = 'tips' | 'support' | 'allowance' | 'fan_club' | 'exclusive_content' | 'service' | 'other'
const PURPOSE_OPTIONS: { value: Purpose; label: string; icon: React.ReactNode }[] = [
  { value: 'support', label: 'Support Me', icon: <Heart size={20} /> },
  { value: 'tips', label: 'Tips & Appreciation', icon: <Gift size={20} /> },
  { value: 'service', label: 'Services', icon: <Briefcase size={20} /> },
  { value: 'fan_club', label: 'Fan Club', icon: <Star size={20} /> },
  { value: 'exclusive_content', label: 'Exclusive Content', icon: <Sparkles size={20} /> },
  { value: 'allowance', label: 'Allowance', icon: <Wallet size={20} /> },
  { value: 'other', label: 'Other', icon: <MoreHorizontal size={20} /> },
]

// Frequency options
type Interval = 'month' | 'one_time'

export default function EditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { data: profileData, isLoading, error } = useProfile()
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateProfile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const profile = profileData?.profile

  // Local state for editing
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [singleAmount, setSingleAmount] = useState<number>(10)
  const [priceInput, setPriceInput] = useState<string>('10')
  const [purpose, setPurpose] = useState<Purpose>('support')
  const [interval, setInterval] = useState<Interval>('month')
  const [showPurposeDrawer, setShowPurposeDrawer] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isContinuing, setIsContinuing] = useState(false)

  // When navigating from the dashboard "Launch My Page" card, we enter a guided flow
  const isLaunchFlow = new URLSearchParams(location.search).get('launch') === '1'

  // Hydrate local state from profile
  useEffect(() => {
    if (profile) {
      const currency = profile.currency || 'USD'
      setDisplayName(profile.displayName || '')
      setAvatarUrl(profile.avatarUrl)
      setPurpose((profile.purpose as Purpose) || 'support')
      // Note: interval is per-subscription, not stored on profile. Default to 'month'

      const amt = profile.singleAmount ? centsToDisplayAmount(profile.singleAmount, currency) : 10
      setSingleAmount(amt)
      setPriceInput(amt.toString())
    }
  }, [profile])

  const currencySymbol = getCurrencySymbol(profile?.currency || 'USD')

  // Track changes
  useEffect(() => {
    if (!profile) return
    const currency = profile.currency || 'USD'
    const profileAmountDisplay = profile.singleAmount ? centsToDisplayAmount(profile.singleAmount, currency) : 10

    // Parse current input for comparison
    const currentVal = parseFloat(priceInput) || 0

    const changed =
      displayName !== (profile.displayName || '') ||
      avatarUrl !== (profile.avatarUrl || null) ||
      purpose !== (profile.purpose || 'support') ||
      currentVal !== profileAmountDisplay
    setHasChanges(changed)

    // Sync numeric state for validation usage elsewhere
    setSingleAmount(currentVal)
  }, [displayName, avatarUrl, priceInput, purpose, profile])

  // ... (avatar handlers unchanged) ...

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // Allow empty string, digits, one decimal point
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setPriceInput(val)
    }
  }

  // Avatar upload handler
  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const isImage = file.type.startsWith('image/') ||
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic') ||
      file.name.toLowerCase().endsWith('.heif')

    if (!isImage) {
      toast.error('Please upload an image file')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be less than 10MB')
      return
    }

    setIsUploading(true)
    try {
      const url = await uploadFile(file, 'avatar')
      setAvatarUrl(url)
      toast.success('Avatar uploaded')
    } catch (err: any) {
      toast.error(err?.error || err?.message || 'Failed to upload avatar')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handlePreview = () => {
    if (profile?.username) {
      window.open(`/${profile.username}`, '_blank')
    }
  }

  const saveProfileAndSettings = async (options: { showSuccessToast?: boolean } = {}) => {
    if (!profile) return
    const { showSuccessToast = true } = options

    try {
      // Update only the fields being edited - don't spread entire profile to avoid
      // sending tiers (already in cents) which would be double-converted by backend
      // Also preserve existing pricingModel and isPublic unless explicitly changing
      await updateProfile({
        displayName,
        avatarUrl,
        purpose,
        // Only set singleAmount if using single pricing model
        ...(profile.pricingModel === 'single' || !profile.pricingModel ? { singleAmount } : {}),
        // Preserve existing isPublic unless this is a launch flow
        ...(isLaunchFlow ? { isPublic: true } : {}),
      })

      setHasChanges(false)
      if (showSuccessToast) toast.success('Changes saved')
      return true
    } catch (err: any) {
      toast.error(err?.error || 'Failed to save changes')
      return false
    }
  }

  const handleSave = async () => {
    await saveProfileAndSettings({ showSuccessToast: true })
  }

  const handleContinue = async () => {
    if (!profile) return

    setIsContinuing(true)
    let didNavigate = false
    try {
      // Save any pending edits first
      if (hasChanges) {
        if (singleAmount <= 0) {
          toast.error('Price must be greater than 0')
          setIsContinuing(false)
          return
        }
        const ok = await saveProfileAndSettings({ showSuccessToast: false })
        if (!ok) {
          setIsContinuing(false)
          return
        }
      }

      // If payments are not active yet, guide user to connect/finish payments next
      if (profile.payoutStatus !== 'active') {
        toast.info('Next: connect payments to start earning.')
        didNavigate = true
        navigate('/settings/payments', { state: { returnTo: '/dashboard' } })
        return
      }

      toast.success('Your page is live!')
      didNavigate = true
      navigate('/dashboard')
    } finally {
      if (!didNavigate) setIsContinuing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="edit-page">
        <header className="edit-page-header">
          <Pressable className="back-btn" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={20} />
          </Pressable>
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
          <div style={{ width: 36 }} />
        </header>
        <div className="edit-page-content">
          <section className="edit-section">
            <Skeleton width={80} height={16} style={{ marginBottom: 16 }} />
            <div className="profile-card">
              <Skeleton width={80} height={80} borderRadius="50%" />
              <div className="profile-fields" style={{ flex: 1 }}>
                <Skeleton width="100%" height={40} style={{ marginBottom: 12 }} />
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="edit-page">
        <header className="edit-page-header">
          <Pressable className="back-btn" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={20} />
          </Pressable>
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
          <div style={{ width: 36 }} />
        </header>
        <div className="edit-page-content">
          <div className="edit-error">
            <p>Failed to load profile. Please try again.</p>
            <Pressable className="retry-btn" onClick={() => window.location.reload()}>
              Retry
            </Pressable>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="edit-page">
      {/* Header */}
      <header className="edit-page-header">
        <Pressable className="back-btn" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <Pressable className="preview-btn" onClick={handlePreview}>
          <ExternalLink size={18} />
        </Pressable>
      </header>

      <div className="edit-page-content">
        {/* Profile Section - Avatar + Display Name + Purpose */}
        <section className="edit-section">
          <h3 className="section-title">Profile</h3>
          <div className="profile-card">
            <Pressable className="avatar-edit" onClick={handleAvatarClick} disabled={isUploading}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="avatar-image" />
              ) : (
                <div className="avatar-placeholder">
                  {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <div className="avatar-overlay">
                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              </div>
            </Pressable>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.heic,.heif"
              onChange={handleFileChange}
              className="hidden-input"
            />
            <div className="profile-fields">
              <div className="field">
                <label className="field-label">Display Name</label>
                <input
                  type="text"
                  className="field-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name or brand"
                />
              </div>
              {/* Purpose selector - compact inline */}
              <Pressable
                className="purpose-selector"
                onClick={() => setShowPurposeDrawer(true)}
              >
                <span className="purpose-label">For</span>
                <span className="purpose-value">
                  {PURPOSE_OPTIONS.find(p => p.value === purpose)?.label || 'Support Me'}
                </span>
                <ChevronDown size={16} className="purpose-chevron" />
              </Pressable>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="edit-section">
          <h3 className="section-title">Pricing</h3>

          {/* Frequency toggle */}
          <div className="pricing-toggle">
            <Pressable
              className={`toggle-option ${interval === 'month' ? 'active' : ''}`}
              onClick={() => setInterval('month')}
            >
              Monthly
            </Pressable>
            <Pressable
              className={`toggle-option ${interval === 'one_time' ? 'active' : ''}`}
              onClick={() => setInterval('one_time')}
            >
              One-time
            </Pressable>
          </div>

          <div className="single-price-card">
            <span className="price-currency">{currencySymbol}</span>
            <input
              type="text"
              inputMode="decimal"
              className="price-input"
              value={priceInput}
              onChange={handlePriceChange}
              placeholder="0.00"
            />
            <span className="price-period">{interval === 'month' ? '/month' : ''}</span>
          </div>
        </section>

      </div>

      {/* Save Button */}
      <div className="edit-page-footer">
        <LoadingButton
          className="save-btn"
          onClick={isLaunchFlow ? handleContinue : handleSave}
          disabled={isLaunchFlow ? false : !hasChanges}
          loading={isSaving || isUploading || isContinuing}
          fullWidth
        >
          {isLaunchFlow
            ? (profile.payoutStatus === 'active' ? 'Continue to Dashboard' : 'Continue to Payments')
            : 'Save Changes'}
        </LoadingButton>
      </div>

      {/* Purpose Drawer - with swipe-to-dismiss */}
      <BottomDrawer
        open={showPurposeDrawer}
        onClose={() => setShowPurposeDrawer(false)}
        title="What's this for?"
      >
        <div className="purpose-drawer-list">
          {PURPOSE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              className={`country-option ${purpose === option.value ? 'selected' : ''}`}
              onClick={() => {
                setPurpose(option.value)
                setShowPurposeDrawer(false)
              }}
            >
              <span className="purpose-option-icon">{option.icon}</span>
              <span className="country-option-name">{option.label}</span>
              {purpose === option.value && (
                <Check size={20} className="country-option-check" />
              )}
            </Pressable>
          ))}
        </div>
      </BottomDrawer>
    </div>
  )
}
