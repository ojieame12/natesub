import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Check, Send, Clock, Mail } from 'lucide-react'
import { useOnboardingStore } from '../onboarding/store'
import { Pressable } from '../components'
import { EmailPreview } from '../email-templates'
import './UpdatePreview.css'

type Tone = 'casual' | 'polished' | 'minimal'

interface PendingUpdate {
  photoUrl: string | null
  caption: string
  audience: 'all' | string
}

// Mock AI enhancement function
const enhanceCaption = (caption: string, tone: Tone): { title: string; body: string } => {
  // In real app, this would call Gemini API
  const words = caption.split(' ')
  const firstWord = words[0] || 'Update'

  switch (tone) {
    case 'casual':
      return {
        title: `${firstWord.charAt(0).toUpperCase() + firstWord.slice(1)} Time!`,
        body: caption.charAt(0).toUpperCase() + caption.slice(1) + (caption.endsWith('.') ? '' : '.') + ' Pretty excited about this one!',
      }
    case 'polished':
      return {
        title: generatePolishedTitle(caption),
        body: polishText(caption),
      }
    case 'minimal':
      return {
        title: '',
        body: caption.charAt(0).toUpperCase() + caption.slice(1),
      }
    default:
      return { title: '', body: caption }
  }
}

const generatePolishedTitle = (caption: string): string => {
  const lower = caption.toLowerCase()

  if (lower.includes('bread') || lower.includes('baked') || lower.includes('sourdough')) {
    return 'Fresh from the Oven'
  }
  if (lower.includes('new') || lower.includes('launch') || lower.includes('release')) {
    return 'Something New'
  }
  if (lower.includes('work') || lower.includes('project') || lower.includes('build')) {
    return 'Work in Progress'
  }

  return 'A Quick Update'
}

const polishText = (caption: string): string => {
  // Simple polishing - capitalize and add period
  let text = caption.trim()
  text = text.charAt(0).toUpperCase() + text.slice(1)
  if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
    text += '.'
  }
  // Add a bit more flair
  return text.replace(/pretty good/gi, 'beautifully').replace(/nice/gi, 'wonderful')
}

export default function UpdatePreview() {
  const navigate = useNavigate()
  const { name } = useOnboardingStore()

  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null)
  const [tone, setTone] = useState<Tone>('polished')
  const [enhanced, setEnhanced] = useState<{ title: string; body: string }>({ title: '', body: '' })
  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)

  const subscriberCount = pendingUpdate?.audience === 'all' ? 47 : 12

  useEffect(() => {
    const stored = sessionStorage.getItem('pending-update')
    if (stored) {
      const data = JSON.parse(stored) as PendingUpdate
      setPendingUpdate(data)
      setEnhanced(enhanceCaption(data.caption, tone))
    } else {
      navigate('/updates/new')
    }
  }, [navigate, tone])

  useEffect(() => {
    if (pendingUpdate) {
      setEnhanced(enhanceCaption(pendingUpdate.caption, tone))
    }
  }, [tone, pendingUpdate])

  const handleSend = async () => {
    setIsSending(true)
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500))
    setIsSending(false)
    setIsSent(true)
    sessionStorage.removeItem('pending-update')
  }

  if (isSent) {
    return (
      <div className="update-preview-page">
        <div className="update-success">
          <div className="update-success-icon">
            <Check size={32} />
          </div>
          <h1 className="update-success-title">Update Sent!</h1>
          <p className="update-success-text">
            {subscriberCount} subscribers will receive your update shortly
          </p>
          <Pressable className="update-done-btn" onClick={() => navigate('/dashboard')}>
            Done
          </Pressable>
        </div>
      </div>
    )
  }

  if (!pendingUpdate) {
    return null
  }

  return (
    <div className="update-preview-page">
      {/* Header */}
      <header className="update-preview-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ChevronLeft size={24} />
        </Pressable>
        <span className="update-preview-title">Preview</span>
        <div className="header-spacer" />
      </header>

      {/* Preview Card */}
      <div className="preview-container">
        <div className="preview-card">
          {pendingUpdate.photoUrl && (
            <div className="preview-photo-wrapper">
              <img src={pendingUpdate.photoUrl} alt="Update" className="preview-photo" />
            </div>
          )}

          <div className="preview-content">
            {enhanced.title && (
              <h2 className="preview-title">{enhanced.title}</h2>
            )}
            <p className="preview-body">{enhanced.body}</p>
            <span className="preview-signoff">— {name || 'You'}</span>
          </div>
        </div>
      </div>

      {/* Tone Selector */}
      <div className="tone-section">
        <span className="tone-label">Style</span>
        <div className="tone-options">
          <Pressable
            className={`tone-option ${tone === 'casual' ? 'selected' : ''}`}
            onClick={() => setTone('casual')}
          >
            Casual
          </Pressable>
          <Pressable
            className={`tone-option ${tone === 'polished' ? 'selected' : ''}`}
            onClick={() => setTone('polished')}
          >
            Polished
          </Pressable>
          <Pressable
            className={`tone-option ${tone === 'minimal' ? 'selected' : ''}`}
            onClick={() => setTone('minimal')}
          >
            Minimal
          </Pressable>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="action-section">
        <Pressable
          className="send-btn"
          onClick={handleSend}
          disabled={isSending}
        >
          {isSending ? (
            <>
              <div className="send-spinner" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Send size={20} />
              <span>Send to {subscriberCount} subscribers</span>
            </>
          )}
        </Pressable>

        <Pressable className="schedule-btn" disabled={isSending}>
          <Clock size={18} />
          <span>Schedule for later</span>
        </Pressable>

        <Pressable
          className="preview-email-btn"
          onClick={() => setShowEmailPreview(true)}
          disabled={isSending}
        >
          <Mail size={18} />
          <span>Preview Email</span>
        </Pressable>
      </div>

      {/* Email Preview Modal */}
      {showEmailPreview && (
        <EmailPreview
          senderName={name || 'You'}
          senderUsername={name?.toLowerCase().replace(/\s+/g, '') || 'you'}
          message={enhanced.title ? `${enhanced.title}\n\n${enhanced.body}` : enhanced.body}
          imageUrl={pendingUpdate.photoUrl || undefined}
          onClose={() => setShowEmailPreview(false)}
        />
      )}
    </div>
  )
}
