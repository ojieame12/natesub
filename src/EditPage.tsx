import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Plus, GripVertical, Trash2, ExternalLink, Check, X, Loader2 } from 'lucide-react'
import { Pressable, useToast, Skeleton, VoiceRecorder, LoadingButton } from './components'
import { useProfile, useUpdateProfile, useUpdateSettings, uploadFile, uploadBlob } from './api/hooks'
import { getCurrencySymbol, formatCompactNumber, centsToDisplayAmount, displayAmountToCents } from './utils/currency'
import { calculateFeePreview, getPricing } from './utils/pricing'
import type { Tier, Perk, ImpactItem } from './api/client'
import './EditPage.css'

export default function EditPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { data: profileData, isLoading, error } = useProfile()
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateProfile()
  const { mutateAsync: updateSettings } = useUpdateSettings()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const profile = profileData?.profile

  // Local state for editing
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [voiceIntroUrl, setVoiceIntroUrl] = useState<string | null>(null)
  const [pricingModel, setPricingModel] = useState<'single' | 'tiers'>('single')
  const [singleAmount, setSingleAmount] = useState<number>(10)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [perks, setPerks] = useState<Perk[]>([])
  const [impactItems, setImpactItems] = useState<ImpactItem[]>([])
  const [feeMode, setFeeMode] = useState<'absorb' | 'pass_to_subscriber'>('pass_to_subscriber')
  const [isPublic, setIsPublic] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isVoiceUploading, setIsVoiceUploading] = useState(false)
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null)
  const [isContinuing, setIsContinuing] = useState(false)

  // When navigating from the dashboard "Launch My Page" card, we enter a guided flow:
  // save/publish → connect payments (if needed) → return to dashboard.
  const isLaunchFlow = new URLSearchParams(location.search).get('launch') === '1'

  // Hydrate local state from profile
  useEffect(() => {
    if (profile) {
      const currency = profile.currency || 'USD'
      setDisplayName(profile.displayName || '')
      setBio(profile.bio || '')
      setAvatarUrl(profile.avatarUrl)
      setVoiceIntroUrl(profile.voiceIntroUrl || null)
      setPricingModel(profile.pricingModel || 'single')
      setSingleAmount(profile.singleAmount ? centsToDisplayAmount(profile.singleAmount, currency) : 10)
      setTiers((profile.tiers || []).map(t => ({
        ...t,
        amount: centsToDisplayAmount(t.amount, currency)
      })))
      setPerks(profile.perks || [])
      setImpactItems(profile.impactItems || [])
      setFeeMode(profile.feeMode || 'pass_to_subscriber')
      setIsPublic(profile.isPublic || false)
    }
  }, [profile])

  const currencySymbol = getCurrencySymbol(profile?.currency || 'USD')

  // Track changes
  useEffect(() => {
    if (!profile) return
    const currency = profile.currency || 'USD'
    const profileAmountDisplay = profile.singleAmount ? centsToDisplayAmount(profile.singleAmount, currency) : 10
    const profileTiersDisplay = (profile.tiers || []).map(t => ({
      ...t,
      amount: centsToDisplayAmount(t.amount, currency)
    }))
    const changed =
      displayName !== (profile.displayName || '') ||
      bio !== (profile.bio || '') ||
      avatarUrl !== (profile.avatarUrl || null) ||
      voiceIntroUrl !== (profile.voiceIntroUrl || null) ||
      pricingModel !== profile.pricingModel ||
      singleAmount !== profileAmountDisplay ||
      JSON.stringify(tiers) !== JSON.stringify(profileTiersDisplay) ||
      JSON.stringify(perks) !== JSON.stringify(profile.perks || []) ||
      JSON.stringify(impactItems) !== JSON.stringify(profile.impactItems || []) ||
      feeMode !== (profile.feeMode || 'pass_to_subscriber') ||
      isPublic !== (profile.isPublic || false)
    setHasChanges(changed)
  }, [displayName, bio, avatarUrl, voiceIntroUrl, pricingModel, singleAmount, tiers, perks, impactItems, feeMode, isPublic, profile])

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

  // Voice intro handlers
  const handleVoiceRecorded = async (blob: Blob, _duration: number) => {
    setVoiceBlob(blob)
    setIsVoiceUploading(true)
    try {
      const url = await uploadBlob(blob, 'voice')
      setVoiceIntroUrl(url)
      setVoiceBlob(null)
      toast.success('Voice intro saved')
    } catch (err: any) {
      toast.error(err?.error || 'Failed to upload voice intro')
      setVoiceBlob(null)
    } finally {
      setIsVoiceUploading(false)
    }
  }

  const handleVoiceRemove = () => {
    setVoiceBlob(null)
    setVoiceIntroUrl(null)
  }

  // Tier handlers
  const handleAddTier = () => {
    const newTier: Tier = {
      id: Date.now().toString(),
      name: 'New Tier',
      amount: 15,
      perks: [],
    }
    setTiers([...tiers, newTier])
  }

  const handleUpdateTier = (id: string, field: keyof Tier, value: string | number | string[]) => {
    setTiers(tiers.map(tier =>
      tier.id === id ? { ...tier, [field]: value } : tier
    ))
  }

  const handleDeleteTier = (id: string) => {
    if (tiers.length > 1) {
      setTiers(tiers.filter(tier => tier.id !== id))
    }
  }

  // Tier perk handlers
  const handleAddTierPerk = (tierId: string) => {
    setTiers(tiers.map(tier => {
      if (tier.id === tierId) {
        return { ...tier, perks: [...(tier.perks || []), ''] }
      }
      return tier
    }))
  }

  const handleUpdateTierPerk = (tierId: string, perkIndex: number, value: string) => {
    setTiers(tiers.map(tier => {
      if (tier.id === tierId) {
        const newPerks = [...(tier.perks || [])]
        newPerks[perkIndex] = value
        return { ...tier, perks: newPerks }
      }
      return tier
    }))
  }

  const handleDeleteTierPerk = (tierId: string, perkIndex: number) => {
    setTiers(tiers.map(tier => {
      if (tier.id === tierId) {
        const newPerks = [...(tier.perks || [])]
        newPerks.splice(perkIndex, 1)
        return { ...tier, perks: newPerks }
      }
      return tier
    }))
  }

  // Perk handlers
  const handleAddPerk = () => {
    const newPerk: Perk = {
      id: Date.now().toString(),
      title: 'New perk',
      enabled: true,
    }
    setPerks([...perks, newPerk])
  }

  const handleUpdatePerk = (id: string, field: keyof Perk, value: string | boolean) => {
    setPerks(perks.map(perk =>
      perk.id === id ? { ...perk, [field]: value } : perk
    ))
  }

  const handleDeletePerk = (id: string) => {
    setPerks(perks.filter(perk => perk.id !== id))
  }

  // Impact item handlers
  const handleAddImpact = () => {
    const newItem: ImpactItem = {
      id: Date.now().toString(),
      title: '',
      subtitle: '',
    }
    setImpactItems([...impactItems, newItem])
  }

  const handleUpdateImpact = (id: string, field: keyof ImpactItem, value: string) => {
    setImpactItems(impactItems.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ))
  }

  const handleDeleteImpact = (id: string) => {
    setImpactItems(impactItems.filter(item => item.id !== id))
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
      // 1. Update Profile Data
      await updateProfile({
        ...profile,
        displayName,
        bio,
        avatarUrl,
        voiceIntroUrl,
        pricingModel,
        singleAmount: pricingModel === 'single' ? singleAmount : null,
        tiers: pricingModel === 'tiers' ? tiers : null,
        perks,
        impactItems,
        feeMode,
      })

      // 2. Update Settings (Visibility) if changed
      if (isPublic !== profile.isPublic) {
        await updateSettings({ isPublic })
      }

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

    // Prevent accidental "launch" without publishing.
    if (!isPublic) {
      toast.error('Turn on Page Visibility to launch your page.')
      return
    }

    setIsContinuing(true)
    let didNavigate = false
    try {
      // Save any pending edits first (including publishing via settings).
      const ok = hasChanges ? await saveProfileAndSettings({ showSuccessToast: false }) : true
      if (!ok) return

      // If payments are not active yet, guide user to connect/finish payments next.
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
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
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
                <Skeleton width="100%" height={80} />
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
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
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

  const isService = profile.purpose === 'service'

  return (
    <div className="edit-page">
      {/* Header */}
      <header className="edit-page-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <Pressable className="preview-btn" onClick={handlePreview}>
          <ExternalLink size={18} />
        </Pressable>
      </header>

      <div className="edit-page-content">
        {/* Visibility Section */}
        <section className="edit-section">
          <div className="section-header">
            <h3 className="section-title">Page Visibility</h3>
            <Pressable
              onClick={() => setIsPublic(!isPublic)}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                background: isPublic ? 'var(--success)' : 'var(--neutral-200)',
                position: 'relative',
                transition: 'background 0.2s'
              }}
            >
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: 2,
                left: isPublic ? 22 : 2,
                transition: 'left 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }} />
            </Pressable>
          </div>
          <p className="section-hint">
            {isPublic ? 'Your page is live.' : 'Your page is private (Draft mode).'}
          </p>
        </section>

        {/* Profile Section */}
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
              <div className="field">
                <label className="field-label">Bio</label>
                <textarea
                  className="field-textarea"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell people what you do..."
                  rows={3}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Voice Intro Section */}
        <section className="edit-section">
          <h3 className="section-title">Voice Intro</h3>
          <p className="section-hint">Let subscribers hear from you directly</p>
          <VoiceRecorder
            onRecorded={handleVoiceRecorded}
            onRemove={handleVoiceRemove}
            audioBlob={voiceBlob}
            existingAudioUrl={voiceIntroUrl}
            maxDuration={60}
            label=""
            hint="Up to 60 seconds"
            isUploading={isVoiceUploading}
          />
        </section>

        {/* Pricing Section */}
        <section className="edit-section">
          <h3 className="section-title">Pricing</h3>

          <div className="pricing-toggle">
            <Pressable
              className={`toggle-option ${pricingModel === 'single' ? 'active' : ''}`}
              onClick={() => setPricingModel('single')}
            >
              Single Price
            </Pressable>
            <Pressable
              className={`toggle-option ${pricingModel === 'tiers' ? 'active' : ''}`}
              onClick={() => setPricingModel('tiers')}
            >
              Multiple Tiers
            </Pressable>
          </div>

          {pricingModel === 'single' ? (
            <div className="single-price-card">
              <span className="price-currency">{currencySymbol}</span>
              <input
                type="number"
                className="price-input"
                value={singleAmount}
                onChange={(e) => setSingleAmount(parseInt(e.target.value) || 0)}
                min={1}
              />
              <span className="price-period">/month</span>
            </div>
          ) : (
            <>
              <div className="tiers-list">
                {tiers.map((tier) => (
                  <div key={tier.id} className="tier-card tier-card-expanded">
                    <div className="tier-header-row">
                      <div className="tier-drag">
                        <GripVertical size={16} />
                      </div>
                      <div className="tier-content">
                        <div className="tier-row">
                          <input
                            type="text"
                            className="tier-name-input"
                            value={tier.name}
                            onChange={(e) => handleUpdateTier(tier.id, 'name', e.target.value)}
                            placeholder="Tier name"
                          />
                          <div className="tier-price-wrap">
                            <span className="tier-currency">{currencySymbol}</span>
                            <input
                              type="number"
                              className="tier-price-input"
                              value={tier.amount}
                              onChange={(e) => handleUpdateTier(tier.id, 'amount', parseInt(e.target.value) || 0)}
                            />
                            <span className="tier-period">/mo</span>
                          </div>
                        </div>
                      </div>
                      <Pressable
                        className="tier-delete"
                        onClick={() => handleDeleteTier(tier.id)}
                      >
                        <Trash2 size={16} />
                      </Pressable>
                    </div>

                    {/* Tier Perks */}
                    <div className="tier-perks-section">
                      <span className="tier-perks-label">What's included</span>
                      <div className="tier-perks-list">
                        {(tier.perks || []).map((perk, index) => (
                          <div key={index} className="tier-perk-row">
                            <Check size={14} className="tier-perk-check" />
                            <input
                              type="text"
                              className="tier-perk-input"
                              value={perk}
                              onChange={(e) => handleUpdateTierPerk(tier.id, index, e.target.value)}
                              placeholder="Perk description"
                            />
                            <Pressable
                              className="tier-perk-delete"
                              onClick={() => handleDeleteTierPerk(tier.id, index)}
                            >
                              <X size={14} />
                            </Pressable>
                          </div>
                        ))}
                      </div>
                      <Pressable
                        className="tier-add-perk-btn"
                        onClick={() => handleAddTierPerk(tier.id)}
                      >
                        <Plus size={14} />
                        <span>Add perk</span>
                      </Pressable>
                    </div>
                  </div>
                ))}
              </div>
              <Pressable className="add-tier-btn" onClick={handleAddTier}>
                <Plus size={18} />
                <span>Add Tier</span>
              </Pressable>
            </>
          )}
        </section>

        {/* Fee Mode Section */}
        <section className="edit-section">
          <h3 className="section-title">Platform Fee ({getPricing(profile.purpose).transactionFeeLabel})</h3>

          <div className="fee-mode-toggle">
            <Pressable
              className={`toggle-option ${feeMode === 'absorb' ? 'active' : ''}`}
              onClick={() => setFeeMode('absorb')}
            >
              I absorb
            </Pressable>
            <Pressable
              className={`toggle-option ${feeMode === 'pass_to_subscriber' ? 'active' : ''}`}
              onClick={() => setFeeMode('pass_to_subscriber')}
            >
              Subscriber pays
            </Pressable>
          </div>

          {(() => {
            const currency = profile.currency || 'USD'
            const baseAmountCents = pricingModel === 'single'
              ? displayAmountToCents(singleAmount || 0, currency)
              : displayAmountToCents(tiers[0]?.amount || 0, currency)
            const preview = calculateFeePreview(baseAmountCents, profile.purpose, feeMode)
            const subscriberPaysDisplay = centsToDisplayAmount(preview.subscriberPays, currency)
            const creatorReceivesDisplay = centsToDisplayAmount(preview.creatorReceives, currency)
            return (
              <div className="fee-mode-preview">
                <div className="fee-preview-row">
                  <span>Subscribers pay</span>
                  <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(subscriberPaysDisplay)}</span>
                </div>
                <div className="fee-preview-row">
                  <span>You receive</span>
                  <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(creatorReceivesDisplay)}</span>
                </div>
              </div>
            )
          })()}
        </section>

        {/* Perks Section - Hidden when service account has multiple tiers (perks are per-tier) */}
        {!(isService && pricingModel === 'tiers') && (
          <section className="edit-section">
            <div className="section-header">
              <h3 className="section-title">{isService ? "What's Included" : 'Subscriber Perks'}</h3>
              <span className="item-count">{perks.filter(p => p.enabled).length} active</span>
            </div>

            <div className="perks-list">
              {perks.map((perk) => (
                <div key={perk.id} className="perk-card">
                  <Pressable
                    className={`perk-toggle ${perk.enabled ? 'enabled' : ''}`}
                    onClick={() => handleUpdatePerk(perk.id, 'enabled', !perk.enabled)}
                  >
                    {perk.enabled && <Check size={12} />}
                  </Pressable>
                  <input
                    type="text"
                    className="perk-input"
                    value={perk.title}
                    onChange={(e) => handleUpdatePerk(perk.id, 'title', e.target.value)}
                    placeholder="Perk title"
                  />
                  <Pressable className="perk-delete" onClick={() => handleDeletePerk(perk.id)}>
                    <X size={16} />
                  </Pressable>
                </div>
              ))}
            </div>

            <Pressable className="add-tier-btn" onClick={handleAddPerk}>
              <Plus size={18} />
              <span>Add Perk</span>
            </Pressable>
          </section>
        )}

        {/* Impact Section */}
        <section className="edit-section">
          <div className="section-header">
            <h3 className="section-title">{isService ? 'Why Work With Me' : 'How It Helps'}</h3>
            <span className="item-count">{impactItems.length} items</span>
          </div>

          <div className="impact-list">
            {impactItems.map((item, index) => (
              <div key={item.id} className="impact-card">
                <div className="impact-number">{index + 1}</div>
                <div className="impact-fields">
                  <input
                    type="text"
                    className="impact-title-input"
                    value={item.title}
                    onChange={(e) => handleUpdateImpact(item.id, 'title', e.target.value)}
                    placeholder="Main point"
                  />
                  <input
                    type="text"
                    className="impact-subtitle-input"
                    value={item.subtitle}
                    onChange={(e) => handleUpdateImpact(item.id, 'subtitle', e.target.value)}
                    placeholder="Optional details"
                  />
                </div>
                <Pressable className="impact-delete" onClick={() => handleDeleteImpact(item.id)}>
                  <Trash2 size={16} />
                </Pressable>
              </div>
            ))}
          </div>

          <Pressable className="add-tier-btn" onClick={handleAddImpact}>
            <Plus size={18} />
            <span>Add Item</span>
          </Pressable>
        </section>
      </div>

      {/* Save Button */}
      <div className="edit-page-footer">
        <LoadingButton
          className="save-btn"
          onClick={isLaunchFlow ? handleContinue : handleSave}
          disabled={isLaunchFlow ? false : !hasChanges}
          loading={isSaving || isUploading || isVoiceUploading || isContinuing}
          fullWidth
        >
          {isLaunchFlow
            ? (!isPublic
              ? 'Launch Page'
              : (profile.payoutStatus === 'active' ? 'Continue to Dashboard' : 'Continue to Payments'))
            : 'Save Changes'}
        </LoadingButton>
      </div>
    </div>
  )
}
