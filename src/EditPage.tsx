import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Plus, GripVertical, Trash2, ExternalLink, Check, X, Loader2 } from 'lucide-react'
import { Pressable, useToast, Skeleton, VoiceRecorder, LoadingButton } from './components'
import { useProfile, useUpdateProfile, useUpdateSettings, uploadFile, uploadBlob } from './api/hooks'
import { getCurrencySymbol, formatCompactNumber, centsToDisplayAmount } from './utils/currency'
import { calculateFeePreview, getPricing } from './utils/pricing'
import type { Tier, Perk, ImpactItem } from './api/client'
import './EditPage.css'

export default function EditPage() {
  const navigate = useNavigate()
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

  // ... (avatar handlers omitted for brevity) ...

  const handleSave = async () => {
    if (!profile) return

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

      toast.success('Changes saved')
      setHasChanges(false)
    } catch (err: any) {
      toast.error(err?.error || 'Failed to save changes')
    }
  }

  // ... (render logic) ...

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
            const baseAmount = pricingModel === 'single'
              ? (singleAmount || 0) * 100  // Convert to cents
              : (tiers[0]?.amount || 0) * 100
            const preview = calculateFeePreview(baseAmount, profile.purpose, feeMode)
            return (
              <div className="fee-mode-preview">
                <div className="fee-preview-row">
                  <span>Subscribers pay</span>
                  <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(preview.subscriberPays / 100)}</span>
                </div>
                <div className="fee-preview-row">
                  <span>You receive</span>
                  <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(preview.creatorReceives / 100)}</span>
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
          onClick={handleSave}
          disabled={!hasChanges}
          loading={isSaving || isUploading || isVoiceUploading}
          fullWidth
        >
          Save Changes
        </LoadingButton>
      </div>
    </div>
  )
}
