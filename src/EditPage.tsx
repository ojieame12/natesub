import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Plus, GripVertical, Trash2, ExternalLink } from 'lucide-react'
import { useOnboardingStore } from './onboarding/store'
import { Pressable, useToast, Skeleton } from './components'
import { getCurrencySymbol } from './utils/currency'
import './EditPage.css'

interface Tier {
  id: string
  name: string
  price: number
  description: string
}

export default function EditPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { name, username, bio, currency, setName, setBio } = useOnboardingStore()
  const currencySymbol = getCurrencySymbol(currency)

  const [isLoading, setIsLoading] = useState(true)
  const [pageTitle, setPageTitle] = useState(name || '')
  const [pageDescription, setPageDescription] = useState(bio || '')
  const [tiers, setTiers] = useState<Tier[]>([
    { id: '1', name: 'Fan', price: 5, description: 'Basic access to content' },
    { id: '2', name: 'Supporter', price: 10, description: 'Extra perks and behind the scenes' },
    { id: '3', name: 'VIP', price: 25, description: 'All access plus 1-on-1 time' },
  ])

  const handleAddTier = () => {
    const newTier: Tier = {
      id: Date.now().toString(),
      name: 'New Tier',
      price: 15,
      description: 'Describe what subscribers get',
    }
    setTiers([...tiers, newTier])
  }

  const handleUpdateTier = (id: string, field: keyof Tier, value: string | number) => {
    setTiers(tiers.map(tier =>
      tier.id === id ? { ...tier, [field]: value } : tier
    ))
  }

  const handleDeleteTier = (id: string) => {
    if (tiers.length > 1) {
      setTiers(tiers.filter(tier => tier.id !== id))
    }
  }

  const handlePreview = () => {
    window.open(`https://nate.to/${username}`, '_blank')
  }

  // Simulate initial data load
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 500)
    return () => clearTimeout(timer)
  }, [])

  const handleSave = () => {
    setName(pageTitle)
    setBio(pageDescription)
    // Tiers would be saved to their own store/API
    toast.success('Changes saved')
    navigate(-1)
  }

  return (
    <div className="edit-page">
      {/* Header */}
      <header className="edit-page-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <span className="edit-page-title">Edit My Page</span>
        <Pressable className="preview-btn" onClick={handlePreview}>
          <ExternalLink size={18} />
        </Pressable>
      </header>

      <div className="edit-page-content">
        {isLoading ? (
          <>
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
            <section className="edit-section">
              <Skeleton width={140} height={16} style={{ marginBottom: 16 }} />
              <Skeleton width="100%" height={100} style={{ marginBottom: 12 }} />
              <Skeleton width="100%" height={100} style={{ marginBottom: 12 }} />
              <Skeleton width="100%" height={100} />
            </section>
          </>
        ) : (
          <>
        {/* Profile Section */}
        <section className="edit-section">
          <h3 className="section-title">Profile</h3>
          <div className="profile-card">
            <Pressable className="avatar-edit">
              <div className="avatar-placeholder">
                {pageTitle ? pageTitle.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="avatar-overlay">
                <Camera size={16} />
              </div>
            </Pressable>
            <div className="profile-fields">
              <div className="field">
                <label className="field-label">Page Title</label>
                <input
                  type="text"
                  className="field-input"
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  placeholder="Your name or brand"
                />
              </div>
              <div className="field">
                <label className="field-label">Bio</label>
                <textarea
                  className="field-textarea"
                  value={pageDescription}
                  onChange={(e) => setPageDescription(e.target.value)}
                  placeholder="Tell people what you do..."
                  rows={3}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Tiers Section */}
        <section className="edit-section">
          <div className="section-header">
            <h3 className="section-title">Subscription Tiers</h3>
            <span className="tier-count">{tiers.length} tiers</span>
          </div>

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
                        value={tier.price}
                        onChange={(e) => handleUpdateTier(tier.id, 'price', parseInt(e.target.value) || 0)}
                      />
                      <span className="tier-period">/mo</span>
                    </div>
                  </div>
                  <input
                    type="text"
                    className="tier-desc-input"
                    value={tier.description}
                    onChange={(e) => handleUpdateTier(tier.id, 'description', e.target.value)}
                    placeholder="What do subscribers get?"
                  />
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
        </section>
          </>
        )}
      </div>

      {/* Save Button */}
      <div className="edit-page-footer">
        <Pressable className="save-btn" onClick={handleSave}>
          Save Changes
        </Pressable>
      </div>
    </div>
  )
}
