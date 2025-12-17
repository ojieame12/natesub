import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Check, Send, Clock, Mail } from 'lucide-react'
import { Pressable, useToast } from '../components'
import { EmailPreview } from '../email-templates'
import { useCreateUpdate, useSendUpdate, useMetrics, useProfile } from '../api/hooks'
import './UpdatePreview.css'

type Tone = 'casual' | 'polished' | 'minimal'

interface PendingUpdate {
  photoUrl: string | null
  caption: string
  audience: 'all' | string
}

// Client-side tone enhancement (text transformation based on selected style)
const enhanceCaption = (caption: string, tone: Tone): { title: string; body: string } => {
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
  const toast = useToast()

  // API hooks
  const { data: profileData } = useProfile()
  const { data: metricsData } = useMetrics()
  const createUpdate = useCreateUpdate()
  const sendUpdate = useSendUpdate()

  const name = profileData?.profile?.displayName || 'You'
  const username = profileData?.profile?.username || 'you'
  const subscriberCount = metricsData?.metrics?.subscriberCount ?? 0

  const [pendingUpdate] = useState<PendingUpdate | null>(() => {
    const stored = sessionStorage.getItem('pending-update')
    if (!stored) return null
    try {
      return JSON.parse(stored) as PendingUpdate
    } catch {
      return null
    }
  })
  const [tone, setTone] = useState<Tone>('polished')
  const [isSent, setIsSent] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const isSending = createUpdate.isPending || sendUpdate.isPending

  useEffect(() => {
    if (!pendingUpdate) {
      navigate('/updates/new')
    }
  }, [navigate, pendingUpdate])

  const enhanced = useMemo(() => {
    if (!pendingUpdate) return { title: '', body: '' }
    return enhanceCaption(pendingUpdate.caption, tone)
  }, [pendingUpdate, tone])

  const handleSend = async () => {
    if (!pendingUpdate) return

    setSendError(null)

    try {
      // 1. Create the update draft
      const createResult = await createUpdate.mutateAsync({
        title: enhanced.title || undefined,
        body: enhanced.body,
        photoUrl: pendingUpdate.photoUrl || undefined,
        audience: pendingUpdate.audience,
      })

      // 2. Send the update
      const sendResult = await sendUpdate.mutateAsync(createResult.update.id)

      // 3. Success - clear session and show confirmation
      sessionStorage.removeItem('pending-update')
      setSentCount(sendResult.recipientCount)
      setIsSent(true)
    } catch (error: any) {
      console.error('Failed to send update:', error)
      const errorMessage = error?.error || error?.message || 'Failed to send update. Please try again.'
      setSendError(errorMessage)
      toast.error(errorMessage)
    }
  }

  if (isSent) {
    return (
      <div className="update-preview-page">
        <div className="update-success">
          <div className="update-success-icon success-bounce">
            <Check size={32} />
          </div>
          <h1 className="update-success-title">Update Sent!</h1>
          <p className="update-success-text">
            {sentCount} {sentCount === 1 ? 'subscriber' : 'subscribers'} will receive your update shortly
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
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
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
            <span className="preview-signoff">— {name}</span>
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

      {/* Error Display */}
      {sendError && (
        <div className="update-send-error">
          <span>{sendError}</span>
          <Pressable className="update-retry-btn" onClick={handleSend}>
            Retry
          </Pressable>
        </div>
      )}

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
          senderName={name}
          senderUsername={username}
          message={enhanced.title ? `${enhanced.title}\n\n${enhanced.body}` : enhanced.body}
          imageUrl={pendingUpdate.photoUrl || undefined}
          onClose={() => setShowEmailPreview(false)}
        />
      )}
    </div>
  )
}
