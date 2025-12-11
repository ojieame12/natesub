import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Camera, Image, Sparkles } from 'lucide-react'
import { useMetrics } from '../api/hooks'
import { Pressable } from '../components'
import './NewUpdate.css'

const MAX_CAPTION_LENGTH = 200

export default function NewUpdate() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: metricsData } = useMetrics()

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [audience, setAudience] = useState<'all' | string>('all')

  const isValid = caption.trim().length > 0
  const subscriberCount = metricsData?.metrics?.subscriberCount ?? 0
  const vipCount = 0 // VIP tier count would need a separate API call

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setPhotoUrl(url)
    }
  }

  const handleRemovePhoto = () => {
    setPhotoUrl(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handlePreview = () => {
    // Store update data in sessionStorage for preview page
    sessionStorage.setItem('pending-update', JSON.stringify({
      photoUrl,
      caption,
      audience,
    }))
    navigate('/updates/preview')
  }

  return (
    <div className="new-update-page">
      {/* Header */}
      <header className="new-update-header">
        <Pressable className="close-btn" onClick={() => navigate(-1)}>
          <X size={20} />
        </Pressable>
        <span className="new-update-title">New Update</span>
        <div className="header-spacer" />
      </header>

      {/* Photo Section */}
      <div className="photo-section">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoSelect}
          className="photo-input-hidden"
        />

        {photoUrl ? (
          <div className="photo-preview-container">
            <img src={photoUrl} alt="Update" className="photo-preview" />
            <Pressable className="photo-remove-btn" onClick={handleRemovePhoto}>
              <X size={16} />
            </Pressable>
          </div>
        ) : (
          <Pressable
            className="photo-upload-area"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="photo-upload-icons">
              <Camera size={24} />
              <Image size={24} />
            </div>
            <span className="photo-upload-text">Add Photo</span>
            <span className="photo-upload-hint">(optional)</span>
          </Pressable>
        )}
      </div>

      {/* Caption Section */}
      <div className="caption-section">
        <div className="caption-card">
          <label className="caption-label">What's happening?</label>
          <textarea
            className="caption-input"
            placeholder="Share what you're up to..."
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
            rows={4}
          />
          <div className="caption-counter">
            {caption.length}/{MAX_CAPTION_LENGTH}
          </div>
        </div>
      </div>

      {/* Audience Section */}
      <div className="audience-section">
        <span className="audience-label">Who receives this?</span>
        <div className="audience-options">
          <Pressable
            className={`audience-option ${audience === 'all' ? 'selected' : ''}`}
            onClick={() => setAudience('all')}
          >
            <div className="audience-radio">
              {audience === 'all' && <div className="audience-radio-dot" />}
            </div>
            <div className="audience-info">
              <span className="audience-name">All subscribers</span>
              <span className="audience-count">{subscriberCount} people</span>
            </div>
          </Pressable>

          {vipCount > 0 && (
            <Pressable
              className={`audience-option ${audience === 'vip' ? 'selected' : ''}`}
              onClick={() => setAudience('vip')}
            >
              <div className="audience-radio">
                {audience === 'vip' && <div className="audience-radio-dot" />}
              </div>
              <div className="audience-info">
                <span className="audience-name">VIP tier only</span>
                <span className="audience-count">{vipCount} people</span>
              </div>
            </Pressable>
          )}
        </div>
      </div>

      {/* Action Button */}
      <div className="action-section">
        <Pressable
          className="preview-btn"
          onClick={handlePreview}
          disabled={!isValid}
        >
          <Sparkles size={20} />
          <span>Preview with AI</span>
        </Pressable>
      </div>
    </div>
  )
}
