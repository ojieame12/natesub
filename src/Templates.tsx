import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Eye, Sparkles } from 'lucide-react'
import { Pressable, useToast } from './components'
import { useProfile } from './api/hooks'
import './Templates.css'

interface Template {
  id: string
  name: string
  description: string
  preview: string
  available: boolean
}

const templates: Template[] = [
  {
    id: 'boundary',
    name: 'Boundary',
    description: 'Modern card with swipeable content views',
    preview: '/templates/boundary-preview.png',
    available: true,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean and simple single-page layout',
    preview: '/templates/minimal-preview.png',
    available: false,
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Luxury serif typography with 3D effects',
    preview: '/templates/editorial-preview.png',
    available: false,
  },
]

export default function Templates() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: profileData } = useProfile()
  const profile = profileData?.profile

  // Get saved template or default to boundary
  const savedTemplate = localStorage.getItem('natepay-template') || 'boundary'
  const [selectedTemplate, setSelectedTemplate] = useState(savedTemplate)

  const handleApply = () => {
    localStorage.setItem('natepay-template', selectedTemplate)
    toast.success('Template applied')
    navigate(-1)
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
    if (template.available) {
      setSelectedTemplate(template.id)
    }
  }

  return (
    <div className="templates-page">
      {/* Header */}
      <header className="templates-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <span className="templates-title">Templates</span>
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
              className={`template-card ${selectedTemplate === template.id ? 'selected' : ''} ${!template.available ? 'coming-soon' : ''}`}
              onClick={() => handleSelectTemplate(template)}
              disabled={!template.available}
            >
              {/* Preview Image Placeholder */}
              <div className="template-preview">
                <div className="template-preview-placeholder">
                  <Sparkles size={24} />
                </div>
                {selectedTemplate === template.id && template.available && (
                  <div className="template-selected-badge">
                    <Check size={14} />
                  </div>
                )}
                {!template.available && (
                  <div className="template-coming-soon-badge">
                    Coming Soon
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
            {templates.find(t => t.id === selectedTemplate)?.name || 'Boundary'}
          </span>
        </div>
      </div>

      {/* Apply Button */}
      <div className="templates-footer">
        <Pressable
          className={`apply-btn ${selectedTemplate === savedTemplate ? 'disabled' : ''}`}
          onClick={handleApply}
          disabled={selectedTemplate === savedTemplate}
        >
          Apply Template
        </Pressable>
      </div>
    </div>
  )
}
