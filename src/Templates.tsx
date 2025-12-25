import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Eye, Loader2 } from 'lucide-react'
import { Pressable, useToast, Skeleton } from './components'
import { useProfile, useUpdateProfile } from './api/hooks'
import './Templates.css'

interface Template {
  id: 'boundary'
  name: string
  description: string
  preview: string
}

const templates: Template[] = [
  {
    id: 'boundary',
    name: 'Boundary',
    description: 'Modern card with swipeable content views',
    preview: '/templates/boundary-preview.png',
  },
]

export default function Templates() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: profileData, isLoading } = useProfile()
  const { mutateAsync: updateProfile, isPending: isSaving } = useUpdateProfile()
  const profile = profileData?.profile

  // Get saved template from profile or default to boundary
  const savedTemplate = (profile?.template || 'boundary') as 'boundary'
  const [selectedTemplate, setSelectedTemplate] = useState<'boundary'>(savedTemplate)

  // Sync selected template when profile loads
  useEffect(() => {
    if (profile?.template) {
      setSelectedTemplate(profile.template as any)
    }
  }, [profile?.template])

  const handleApply = async () => {
    if (!profile) {
      toast.error('Finish setting up your profile first')
      return
    }

    try {
      // Only send template field - minimal update to avoid validation issues
      await updateProfile({ template: selectedTemplate })
      toast.success('Template applied')
      navigate(-1)
    } catch (err: any) {
      toast.error(err?.error || 'Failed to apply template')
    }
  }

  const handlePreview = () => {
    // Preview user's own page in a new tab
    if (profile?.username) {
      window.open(`/${profile.username}`, '_blank')
    } else {
      toast.error('Set up your profile first to preview')
    }
  }

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template.id)
  }

  if (isLoading) {
    return (
      <div className="templates-page">
        <header className="templates-header">
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Pressable>
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
          <div style={{ width: 36 }} />
        </header>
        <div className="templates-content">
          <Skeleton width={200} height={16} style={{ marginBottom: 24 }} />
          <div className="templates-grid">
            <Skeleton width="100%" height={200} borderRadius="16px" />
            <Skeleton width="100%" height={200} borderRadius="16px" />
          </div>
        </div>
      </div>
    )
  }

  const hasProfile = !!profile
  const hasChanges = hasProfile && selectedTemplate !== savedTemplate

  return (
    <div className="templates-page">
      {/* Header */}
      <header className="templates-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <Pressable className="preview-btn" onClick={handlePreview}>
          <Eye size={18} />
        </Pressable>
      </header>

      <div className="templates-content">
        <p className="templates-desc">Choose a style for your subscribe page</p>

        {/* Templates Grid */}
        <div className="templates-grid">
          {templates.map((template) => (
            <Pressable
              key={template.id}
              className={`template-card ${selectedTemplate === template.id ? 'selected' : ''}`}
              onClick={() => handleSelectTemplate(template)}
            >
              {/* Preview Image Placeholder */}
              <div className={`template-preview template-preview-${template.id}`}>
                <div className="template-mini-frame" aria-hidden="true">
                  <div className="template-mini-top" />
                  <div className="template-mini-body" />
                  <div className="template-mini-cta" />
                </div>
                {selectedTemplate === template.id && (
                  <div className="template-selected-badge">
                    <Check size={14} />
                  </div>
                )}
              </div>

              {/* Template Info */}
              <div className="template-info">
                <span className="template-name">{template.name}</span>
                <span className="template-description">{template.description}</span>
              </div>
            </Pressable>
          ))}
        </div>

        {/* Current Selection */}
        <div className="templates-current">
          <span className="current-label">Currently using:</span>
          <span className="current-value">
            {templates.find(t => t.id === savedTemplate)?.name || 'Boundary'}
          </span>
        </div>
      </div>

      {/* Apply Button */}
      <div className="templates-footer">
        <Pressable
          className={`apply-btn ${!hasChanges ? 'disabled' : ''}`}
          onClick={handleApply}
          disabled={!hasProfile || !hasChanges || isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Applying...
            </>
          ) : (
            'Apply Template'
          )}
        </Pressable>
      </div>
    </div>
  )
}
