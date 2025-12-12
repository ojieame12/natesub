import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Plus, GripVertical, Trash2, ExternalLink, Check, X, Loader2 } from 'lucide-react'
import { Pressable, useToast, Skeleton } from './components'
import { useProfile, useUpdateProfile, uploadFile } from './api/hooks'
import { getCurrencySymbol } from './utils/currency'
import type { Tier, Perk, ImpactItem } from './api/client'
import './EditPage.css'

export default function EditPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: profileData, isLoading, error } = useProfile()
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateProfile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const profile = profileData?.profile

  // Local state for editing
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [pricingModel, setPricingModel] = useState<'single' | 'tiers'>('single')
  const [singleAmount, setSingleAmount] = useState<number>(10)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [perks, setPerks] = useState<Perk[]>([])
  const [impactItems, setImpactItems] = useState<ImpactItem[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  // Hydrate local state from profile
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '')
      setBio(profile.bio || '')
      setAvatarUrl(profile.avatarUrl)
      setPricingModel(profile.pricingModel || 'single')
      setSingleAmount(profile.singleAmount || 10)
      setTiers(profile.tiers || [])
      setPerks(profile.perks || [])
      setImpactItems(profile.impactItems || [])
    }
  }, [profile])

  const currencySymbol = getCurrencySymbol(profile?.currency || 'USD')

  // Track changes
  useEffect(() => {
    if (!profile) return
    const changed =
      displayName !== (profile.displayName || '') ||
      bio !== (profile.bio || '') ||
      avatarUrl !== (profile.avatarUrl || null) ||
      pricingModel !== profile.pricingModel ||
      singleAmount !== (profile.singleAmount || 10) ||
      JSON.stringify(tiers) !== JSON.stringify(profile.tiers || []) ||
      JSON.stringify(perks) !== JSON.stringify(profile.perks || []) ||
      JSON.stringify(impactItems) !== JSON.stringify(profile.impactItems || [])
    setHasChanges(changed)
  }, [displayName, bio, avatarUrl, pricingModel, singleAmount, tiers, perks, impactItems, profile])

  // Avatar upload handler
  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Please upload a JPG, PNG, or WebP image')
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB')
      return
    }

    setIsUploading(true)
    try {
      const url = await uploadFile(file, 'avatar')
      setAvatarUrl(url)
      toast.success('Avatar uploaded')
    } catch (err: any) {
      toast.error(err?.error || 'Failed to upload avatar')
    } finally {
      setIsUploading(false)
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
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

  const handleSave = async () => {
    if (!profile) return

    try {
      await updateProfile({
        ...profile,
        displayName,
        bio,
        avatarUrl,
        pricingModel,
        singleAmount: pricingModel === 'single' ? singleAmount : null,
        tiers: pricingModel === 'tiers' ? tiers : null,
        perks,
        impactItems,
      })
      toast.success('Changes saved')
      setHasChanges(false)
    } catch (err: any) {
      toast.error(err?.error || 'Failed to save changes')
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
              accept="image/jpeg,image/png,image/webp"
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
                  <div key={tier.id} className="tier-card">
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
                ))}
              </div>
              <Pressable className="add-tier-btn" onClick={handleAddTier}>
                <Plus size={18} />
                <span>Add Tier</span>
              </Pressable>
            </>
          )}
        </section>

        {/* Perks Section */}
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
        <Pressable
          className={`save-btn ${!hasChanges ? 'disabled' : ''}`}
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Pressable>
      </div>
    </div>
  )
}
