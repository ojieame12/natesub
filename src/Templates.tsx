import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Eye } from 'lucide-react'
import { Pressable } from './components'
import './Templates.css'

const templates = [
  {
    id: 'boundary',
    name: 'Boundary',
    description: 'Modern card with avatar overlap',
    route: '/subscribe/boundary'
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Luxury serif with 3D card',
    route: '/subscribe/editorial'
  },
]

export default function Templates() {
  const navigate = useNavigate()
  const [selectedTemplate, setSelectedTemplate] = useState('boundary')

  const handleApply = () => {
    // Save template selection to localStorage
    localStorage.setItem('natepay-template', selectedTemplate)
    navigate(-1)
  }

  const handlePreview = (route: string) => {
    navigate(route)
  }

  return (
    <div className="templates-page">
      {/* Header */}
      <header className="templates-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <span className="templates-title">Templates</span>
        <div className="header-spacer" />
      </header>

      <div className="templates-content">
        <p className="templates-desc">Choose a style for your subscribe page</p>

        {/* Templates List */}
        <div className="templates-list">
          {templates.map((template) => (
            <div key={template.id} className="template-row">
              <Pressable
                className={`template-card-row ${selectedTemplate === template.id ? 'selected' : ''}`}
                onClick={() => setSelectedTemplate(template.id)}
              >
                <div className="template-radio">
                  {selectedTemplate === template.id && (
                    <div className="template-radio-inner" />
                  )}
                </div>
                <div className="template-info">
                  <span className="template-name">{template.name}</span>
                  <span className="template-description">{template.description}</span>
                </div>
                {selectedTemplate === template.id && (
                  <div className="template-check">
                    <Check size={16} />
                  </div>
                )}
              </Pressable>
              <Pressable
                className="template-preview-btn"
                onClick={() => handlePreview(template.route)}
              >
                <Eye size={18} />
                <span>Preview</span>
              </Pressable>
            </div>
          ))}
        </div>
      </div>

      {/* Apply Button */}
      <div className="templates-footer">
        <Pressable className="apply-btn" onClick={handleApply}>
          Apply Template
        </Pressable>
      </div>
    </div>
  )
}
