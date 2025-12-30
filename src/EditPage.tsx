import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Loader2, ExternalLink, ChevronDown, Check, Heart, Gift, Briefcase, Star, Sparkles, Wallet, MoreHorizontal, Edit3, Wand2, ImageIcon, Plus, X } from 'lucide-react'
import { Pressable, useToast, Skeleton, LoadingButton, BottomDrawer } from './components'
import { useProfile, useUpdateProfile, uploadFile, useGeneratePerks, useGenerateBanner, useAIConfig } from './api/hooks'
import { getCurrencySymbol, centsToDisplayAmount } from './utils/currency'
import type { Perk } from './api/client'
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

export default function EditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { data: profileData, isLoading, error } = useProfile()
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateProfile()
  const generatePerksMutation = useGeneratePerks()
  const generateBannerMutation = useGenerateBanner()
  const { data: aiConfig } = useAIConfig()
  const isAIAvailable = aiConfig?.available ?? false
  const fileInputRef = useRef<HTMLInputElement>(null)

  const profile = profileData?.profile

  // Local state for editing
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [singleAmount, setSingleAmount] = useState<number>(10)
  const [priceInput, setPriceInput] = useState<string>('10')
  const [purpose, setPurpose] = useState<Purpose>('support')
  const [showPurposeDrawer, setShowPurposeDrawer] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isContinuing, setIsContinuing] = useState(false)

  // Service mode state
  const [bio, setBio] = useState('')
  const [perks, setPerks] = useState<Perk[]>([])
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)
  const [editingPerkIndex, setEditingPerkIndex] = useState<number | null>(null)
  const [editingPerkValue, setEditingPerkValue] = useState('')
  const [isAddingPerk, setIsAddingPerk] = useState(false)
  const [newPerkValue, setNewPerkValue] = useState('')

  // Check if in service mode
  const isServiceMode = purpose === 'service'

  // When navigating from the dashboard "Launch My Page" card, we enter a guided flow
  const isLaunchFlow = new URLSearchParams(location.search).get('launch') === '1'

  // Hydrate local state from profile
  useEffect(() => {
    if (profile) {
      const currency = profile.currency || 'USD'
      setDisplayName(profile.displayName || '')
      setAvatarUrl(profile.avatarUrl)
      setPurpose((profile.purpose as Purpose) || 'support')

      const amt = profile.singleAmount ? centsToDisplayAmount(profile.singleAmount, currency) : 10
      setSingleAmount(amt)
      setPriceInput(amt.toString())

      // Service mode fields
      setBio(profile.bio || '')
      setPerks(profile.perks || [])
      setBannerUrl(profile.bannerUrl || null)
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

    // Check if perks have changed (compare titles)
    const perksChanged = JSON.stringify(perks.map(p => p.title)) !==
      JSON.stringify((profile.perks || []).map(p => p.title))

    const changed =
      displayName !== (profile.displayName || '') ||
      avatarUrl !== (profile.avatarUrl || null) ||
      purpose !== (profile.purpose || 'support') ||
      currentVal !== profileAmountDisplay ||
      // Service mode changes
      bio !== (profile.bio || '') ||
      perksChanged ||
      bannerUrl !== (profile.bannerUrl || null)
    setHasChanges(changed)

    // Sync numeric state for validation usage elsewhere
    setSingleAmount(currentVal)
  }, [displayName, avatarUrl, priceInput, purpose, profile, bio, perks, bannerUrl])

  // Warn user about unsaved changes when navigating away
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasChanges])

  // Service mode: Generate perks
  const handleGeneratePerks = async () => {
    if (!bio.trim()) {
      toast.error('Please add a service description first')
      return
    }
    try {
      const result = await generatePerksMutation.mutateAsync({
        description: bio.trim(),
        pricePerMonth: singleAmount,
        displayName: displayName || undefined,
      })
      setPerks(result.perks)
      toast.success('Perks generated')
    } catch (err: any) {
      toast.error(err?.error || 'Failed to generate perks')
    }
  }

  // Service mode: Generate banner
  const handleGenerateBanner = async () => {
    if (!avatarUrl) {
      toast.error('Please upload an avatar first')
      return
    }
    try {
      // Pass current bio so AI uses latest text (not stale saved version)
      const result = await generateBannerMutation.mutateAsync({
        serviceDescription: bio.trim() || undefined,
      })
      setBannerUrl(result.bannerUrl)
      toast.success(result.wasGenerated ? 'Banner generated' : 'Using avatar as banner')
    } catch (err: any) {
      toast.error(err?.error || 'Failed to generate banner')
    }
  }

  // Service mode: Edit perk inline
  const startEditingPerk = (index: number) => {
    setEditingPerkIndex(index)
    setEditingPerkValue(perks[index]?.title || '')
  }

  const savePerkEdit = () => {
    if (editingPerkIndex === null) return
    const newPerks = [...perks]
    if (newPerks[editingPerkIndex]) {
      newPerks[editingPerkIndex] = {
        ...newPerks[editingPerkIndex],
        title: editingPerkValue.trim() || newPerks[editingPerkIndex].title,
      }
      setPerks(newPerks)
    }
    setEditingPerkIndex(null)
    setEditingPerkValue('')
  }

  const cancelPerkEdit = () => {
    setEditingPerkIndex(null)
    setEditingPerkValue('')
  }

  // Add new perk manually
  const handleAddPerk = () => {
    if (!newPerkValue.trim()) return
    const newPerk: Perk = {
      id: `perk-${Date.now()}-${perks.length}`,
      title: newPerkValue.trim(),
      enabled: true,
    }
    setPerks([...perks, newPerk])
    setNewPerkValue('')
    setIsAddingPerk(false)
    setHasChanges(true)
  }

  // Delete a perk
  const handleDeletePerk = (index: number) => {
    const newPerks = perks.filter((_, i) => i !== index)
    setPerks(newPerks)
    setHasChanges(true)
  }

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

  const saveProfileAndSettings = async (options: { showSuccessToast?: boolean; publishIfReady?: boolean } = {}) => {
    if (!profile) return
    const { showSuccessToast = true, publishIfReady } = options

    // Warn if service mode user has fewer than 3 perks (non-blocking)
    if (isServiceMode && perks.length > 0 && perks.length < 3) {
      toast.warning(`Only ${perks.length} perk${perks.length === 1 ? '' : 's'} - at least 3 required`)
    }

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
        // Only publish if explicitly requested (payouts must be active first)
        ...(publishIfReady ? { isPublic: true } : {}),
        // Service mode fields
        ...(isServiceMode && {
          bio,
          bannerUrl: bannerUrl || undefined,
          perks: perks as any,
        }),
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
    const success = await saveProfileAndSettings({ showSuccessToast: true })
    if (success) {
      // Navigate back to dashboard after saving
      navigate('/dashboard')
    }
  }

  const handleContinue = async () => {
    if (!profile) return

    setIsContinuing(true)
    let didNavigate = false
    try {
      // Validate price first
      if (singleAmount <= 0) {
        toast.error('Price must be greater than 0')
        setIsContinuing(false)
        return
      }

      // Service mode: require at least 3 perks before publishing
      if (isServiceMode && perks.length < 3) {
        toast.error('Add at least 3 perks before publishing')
        setIsContinuing(false)
        return
      }

      // Check payout status BEFORE saving with isPublic: true
      // This prevents publishing an incomplete page
      const payoutsActive = profile.payoutStatus === 'active'

      if (hasChanges) {
        // Save changes, but only set isPublic if payouts are active
        const ok = await saveProfileAndSettings({
          showSuccessToast: false,
          publishIfReady: payoutsActive,
        })
        if (!ok) {
          setIsContinuing(false)
          return
        }
      } else if (payoutsActive && !profile.isPublic) {
        // No changes to save, but need to publish
        await updateProfile({ isPublic: true })
      }

      // If payments are not active yet, guide user to connect/finish payments next
      if (!payoutsActive) {
        toast.info('Next: connect payments to start earning.')
        didNavigate = true
        navigate('/settings/payments', { state: { returnTo: '/edit?launch=1' } })
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

        {/* Service Mode: Description Section */}
        {isServiceMode && (
          <section className="edit-section">
            <h3 className="section-title">Service Description</h3>
            <div className="service-description-card">
              <textarea
                className="service-description-textarea"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Describe what you offer to subscribers..."
                rows={3}
              />
            </div>
          </section>
        )}

        {/* Service Mode: Perks Section */}
        {isServiceMode && (
          <section className="edit-section">
            <div className="section-header-row">
              <h3 className="section-title">What Subscribers Get</h3>
              {isAIAvailable && (
                <Pressable
                  className="generate-btn"
                  onClick={handleGeneratePerks}
                  disabled={generatePerksMutation.isPending || !bio.trim()}
                >
                  {generatePerksMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Wand2 size={14} />
                  )}
                  <span>{perks.length > 0 ? 'Regenerate' : 'Generate'}</span>
                </Pressable>
              )}
            </div>
            {perks.length > 0 ? (
              <div className="perks-list">
                {perks.map((perk, index) => (
                  <div key={perk.id} className="perk-item">
                    {editingPerkIndex === index ? (
                      <div className="perk-edit-row">
                        <input
                          type="text"
                          value={editingPerkValue}
                          onChange={(e) => setEditingPerkValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') savePerkEdit()
                            if (e.key === 'Escape') cancelPerkEdit()
                          }}
                          autoFocus
                          maxLength={60}
                          className="perk-edit-input"
                        />
                        <Pressable onClick={savePerkEdit} className="perk-save-btn">
                          <Check size={14} />
                        </Pressable>
                      </div>
                    ) : (
                      <>
                        <span className="perk-check">✓</span>
                        <span className="perk-title">{perk.title}</span>
                        <div className="perk-actions">
                          <Pressable
                            className="perk-edit-btn"
                            onClick={() => startEditingPerk(index)}
                          >
                            <Edit3 size={12} />
                          </Pressable>
                          <Pressable
                            className="perk-delete-btn"
                            onClick={() => handleDeletePerk(index)}
                            disabled={isServiceMode && perks.length <= 3}
                          >
                            <X size={12} />
                          </Pressable>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {/* Add perk manually */}
            {isAddingPerk ? (
              <div className="perk-add-form">
                <input
                  type="text"
                  value={newPerkValue}
                  onChange={(e) => setNewPerkValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddPerk()
                    if (e.key === 'Escape') {
                      setIsAddingPerk(false)
                      setNewPerkValue('')
                    }
                  }}
                  placeholder="Enter perk description..."
                  autoFocus
                  maxLength={60}
                  className="perk-add-input"
                />
                <Pressable onClick={handleAddPerk} className="perk-save-btn" disabled={!newPerkValue.trim()}>
                  <Check size={14} />
                </Pressable>
                <Pressable onClick={() => { setIsAddingPerk(false); setNewPerkValue('') }} className="perk-cancel-btn">
                  <X size={14} />
                </Pressable>
              </div>
            ) : perks.length < 5 ? (
              <Pressable
                className="perk-add-btn"
                onClick={() => setIsAddingPerk(true)}
              >
                <Plus size={14} />
                <span>Add perk</span>
              </Pressable>
            ) : null}

            {perks.length === 0 && !isAddingPerk && (
              <p className="perks-empty-hint">
                {isAIAvailable
                  ? 'Add a description above, then click Generate to create your perks.'
                  : 'Click "Add perk" above to add perks manually.'}
              </p>
            )}
          </section>
        )}

        {/* Service Mode: Banner Section */}
        {isServiceMode && (
          <section className="edit-section">
            <div className="section-header-row">
              <h3 className="section-title">Banner Image</h3>
              {isAIAvailable && (
                <Pressable
                  className="generate-btn"
                  onClick={handleGenerateBanner}
                  disabled={generateBannerMutation.isPending || !avatarUrl}
                >
                  {generateBannerMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ImageIcon size={14} />
                  )}
                  <span>{bannerUrl ? 'Regenerate' : 'Generate'}</span>
                </Pressable>
              )}
            </div>
            {bannerUrl ? (
              <div className="banner-preview">
                <img src={bannerUrl} alt="Banner" className="banner-image" />
              </div>
            ) : (
              <p className="banner-empty">
                {isAIAvailable
                  ? 'Upload an avatar above, then click Generate to create your banner.'
                  : 'AI is temporarily unavailable. Your avatar will be used as the banner.'}
              </p>
            )}
          </section>
        )}

        {/* Pricing Section */}
        <section className="edit-section">
          <h3 className="section-title">Monthly Price</h3>

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
            <span className="price-period">/month</span>
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
