import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Mail, Link2, Check, Mic, Plus, Calendar, CreditCard } from 'lucide-react'
import { useRequestStore, getRelationshipLabel, type RelationshipType } from './store'
import { useCreateRequest, useSendRequest, useCurrentUser } from '../api/hooks'
import { getCurrencySymbol, formatCompactNumber, displayAmountToCents } from '../utils/currency'
import { Pressable } from '../components'
import './request.css'

// SMS option removed - backend doesn't support actual SMS, only email or copy link
type SendMethod = 'email' | 'link'

// Map detailed frontend relationship types to backend coarse types
function mapRelationshipToBackend(relationship: RelationshipType | null): string {
    if (!relationship) return 'other'

    if (relationship.startsWith('family_')) return 'family'
    if (relationship.startsWith('friend_')) return 'friend'
    if (relationship.startsWith('client')) return 'client'

    // Direct matches: fan, colleague, partner, other
    return relationship
}

export default function RequestPreview() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const {
        recipient,
        relationship,
        amount,
        isRecurring,
        purpose,
        dueDate,
        message,
        voiceNoteUrl,
        voiceNoteDuration,
        setMessage,
        reset,
    } = useRequestStore()

    // Currency and user type from profile
    const currency = userData?.profile?.currency || 'USD'
    const currencySymbol = getCurrencySymbol(currency)
    const isService = userData?.profile?.purpose === 'service'
    const perks = userData?.profile?.perks || []

    // API hooks
    const { mutateAsync: createRequest } = useCreateRequest()
    const { mutateAsync: sendRequest } = useSendRequest()

    const [sendMethod, setSendMethod] = useState<SendMethod>('link')
    const [isSending, setIsSending] = useState(false)
    const [isSent, setIsSent] = useState(false)
    const [requestLink, setRequestLink] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [existingRequestId, setExistingRequestId] = useState<string | null>(null) // Prevents duplicates on retry

    // Editable contact info (SMS removed - backend doesn't support it)
    const [emailAddress, setEmailAddress] = useState(recipient?.email || '')
    const [editingEmail, setEditingEmail] = useState(false)

    // Payout Interceptor State
    const [showPayoutWall, setShowPayoutWall] = useState(false)

    // Redirect if no recipient (useEffect to avoid render-time side effects)
    useEffect(() => {
        if (!recipient) {
            navigate('/new-request', { replace: true })
        }
    }, [recipient, navigate])

    // Early return to prevent rendering errors
    if (!recipient) {
        return null
    }

    const firstName = recipient.name.split(' ')[0]
    const relationshipLabel = getRelationshipLabel(relationship)

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const canSendEmail = emailAddress.includes('@')

    const handleSelectMethod = (method: SendMethod) => {
        setSendMethod(method)
        // Open edit mode if selecting email without contact info
        if (method === 'email' && !emailAddress) {
            setEditingEmail(true)
        } else {
            setEditingEmail(false)
        }
    }

    const handleSend = async () => {
        // Intercept: Check if payouts are active
        const payoutStatus = userData?.profile?.payoutStatus
        if (payoutStatus !== 'active') {
            setShowPayoutWall(true)
            return
        }

        // Validate before sending
        if (sendMethod === 'email' && !canSendEmail) {
            setEditingEmail(true)
            return
        }

        performSend()
    }

    const performSend = async () => {
        setIsSending(true)
        setError(null)

        try {
            let requestId = existingRequestId

            // Step 1: Create the request (only if not already created)
            if (!requestId) {
                const { request } = await createRequest({
                    recipientName: recipient.name,
                    recipientEmail: sendMethod === 'email' ? emailAddress : undefined,
                    relationship: mapRelationshipToBackend(relationship),
                    amountCents: displayAmountToCents(amount, currency),
                    currency,  // Use creator's currency
                    isRecurring,
                    message: message || undefined,
                    voiceUrl: voiceNoteUrl || undefined,
                    dueDate: dueDate || undefined,  // Pass invoice due date if set
                    purpose: purpose || undefined,  // Pass purpose if set
                })
                requestId = request.id
                setExistingRequestId(request.id) // Save ID so retries don't create duplicates
            }

            // Step 2: Send via chosen method (idempotent / safe to retry)
            const { requestLink: link } = await sendRequest({
                id: requestId,
                method: sendMethod,
            })

            setRequestLink(link)

            // Auto-copy for Link method
            if (sendMethod === 'link' && link) {
                await navigator.clipboard.writeText(link)
            }

            setIsSent(true)
        } catch (err: any) {
            console.error('Request failed:', err)
            setError(err?.error || 'Failed to send request. Please try again.')
        } finally {
            setIsSending(false)
        }
    }

    const handleDone = () => {
        reset()
        navigate('/dashboard')
    }

    // Copy link handler
    const handleCopyLink = async () => {
        if (requestLink) {
            await navigator.clipboard.writeText(requestLink)
        }
    }

    // Success State
    if (isSent) {
        return (
            <div className="request-page">
                <div className="request-success-state">
                    <div className="request-success-icon">
                        <Check size={32} />
                    </div>
                    <h2 className="request-success-title">{isService ? 'Invoice Sent!' : 'Request Sent!'}</h2>
                    <p className="request-success-text">
                        Your {isService ? 'invoice' : 'request'} has been sent to {recipient.name}
                        {sendMethod === 'email' && ' via email'}
                        {sendMethod === 'link' && '. Link copied!'}
                    </p>
                    <div className="request-success-summary">
                        <div className="request-summary-row">
                            <span>Amount</span>
                            <span className="request-summary-value">{currencySymbol}{formatCompactNumber(Number(amount) || 0)}{isRecurring ? '/mo' : ''}</span>
                        </div>
                        <div className="request-summary-row">
                            <span>To</span>
                            <span className="request-summary-value">{recipient.name}</span>
                        </div>
                        {purpose && (
                            <div className="request-summary-row">
                                <span>Purpose</span>
                                <span className="request-summary-value">{purpose}</span>
                            </div>
                        )}
                    </div>
                    {requestLink && (
                        <Pressable className="request-copy-link-btn" onClick={handleCopyLink}>
                            <Link2 size={16} />
                            <span>Copy Link Again</span>
                        </Pressable>
                    )}
                    <Pressable className="request-done-btn" onClick={handleDone}>
                        Done
                    </Pressable>
                </div>
            </div>
        )
    }

    return (
        <div className="request-page">
            {/* Header */}
            <header className="request-header">
                <Pressable className="request-back-btn" onClick={() => navigate(-1)}>
                    <ChevronLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <div className="request-header-spacer" />
            </header>

            <div className="request-content">
                {/* Preview Card */}
                <div className="request-preview-card">
                    <div className="request-preview-header">
                        <span className="request-preview-label">What {firstName} will {isService ? 'receive' : 'see'}</span>
                    </div>

                    <div className="request-preview-content">
                        {/* Mini Subscribe Preview */}
                        <div className="request-preview-mini">
                            <div className="request-preview-amount">
                                <span className="request-preview-currency">{currencySymbol}</span>
                                <span className="request-preview-value">{amount}</span>
                                {isRecurring && <span className="request-preview-freq">/mo</span>}
                            </div>
                            {purpose && (
                                <span className="request-preview-purpose">{purpose}</span>
                            )}
                            {dueDate && (
                                <div className="request-preview-due-date">
                                    <Calendar size={14} />
                                    <span>Due {new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                            )}
                        </div>

                        {/* Service Mode: What's Included */}
                        {isService && perks.length > 0 && (
                            <div className="request-preview-perks">
                                <span className="request-preview-perks-title">What's included</span>
                                <ul className="request-preview-perks-list">
                                    {perks.filter((p: { enabled?: boolean }) => p.enabled !== false).map((perk: { id?: string; title: string }, i: number) => (
                                        <li key={perk.id || i} className="request-preview-perk-item">
                                            <span className="request-preview-perk-check">✓</span>
                                            <span>{perk.title}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Message Input */}
                        <div className="request-preview-message editable">
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Add a personal message..."
                                className="request-message-input"
                                rows={3}
                            />
                        </div>

                        {/* Voice Note Indicator */}
                        {voiceNoteUrl && (
                            <div className="request-preview-voice">
                                <Mic size={16} />
                                <span>Voice message attached ({formatTime(voiceNoteDuration)})</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Send Method Selection */}
                <div className="request-send-section">
                    <label className="request-label">Send via</label>
                    <div className="request-send-methods">
                        {/* Email Option */}
                        <Pressable
                            className={`request-send-method ${sendMethod === 'email' ? 'active' : ''}`}
                            onClick={() => handleSelectMethod('email')}
                        >
                            <Mail size={20} />
                            <span>Email</span>
                            {emailAddress ? (
                                <span className="request-send-detail">{emailAddress}</span>
                            ) : (
                                <span className="request-send-detail request-send-add">
                                    <Plus size={14} /> Add email
                                </span>
                            )}
                        </Pressable>

                        {/* Email input when editing */}
                        {editingEmail && sendMethod === 'email' && (
                            <div className="request-send-input-wrapper">
                                <input
                                    type="email"
                                    placeholder="Enter email address"
                                    value={emailAddress}
                                    onChange={(e) => setEmailAddress(e.target.value)}
                                    className="request-send-input"
                                    autoFocus
                                />
                            </div>
                        )}

                        {/* Copy Link Option */}
                        <Pressable
                            className={`request-send-method ${sendMethod === 'link' ? 'active' : ''}`}
                            onClick={() => handleSelectMethod('link')}
                        >
                            <Link2 size={20} />
                            <span>Copy Link</span>
                            <span className="request-send-detail">Share anywhere</span>
                        </Pressable>
                    </div>
                </div>

                {/* Summary */}
                <div className="request-final-summary">
                    <div className="request-summary-item">
                        <span className="request-summary-label">Recipient</span>
                        <span className="request-summary-value">{recipient.name}</span>
                    </div>
                    {relationshipLabel && (
                        <div className="request-summary-item">
                            <span className="request-summary-label">Relationship</span>
                            <span className="request-summary-value">{relationshipLabel}</span>
                        </div>
                    )}
                    <div className="request-summary-item">
                        <span className="request-summary-label">Amount</span>
                        <span className="request-summary-value">{currencySymbol}{formatCompactNumber(Number(amount) || 0)}{isRecurring ? '/month' : ' one-time'}</span>
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="request-error">
                    {error}
                </div>
            )}

            {/* Send Button */}
            <div className="request-footer">
                <Pressable
                    className="request-send-btn"
                    onClick={handleSend}
                    disabled={isSending}
                >
                    {isSending ? (
                        <>
                            <span className="request-sending-spinner" />
                            <span>Sending...</span>
                        </>
                    ) : (
                        <>
                            {sendMethod === 'email' && <Mail size={20} />}
                            {sendMethod === 'link' && <Link2 size={20} />}
                            <span>
                                {sendMethod === 'link' ? 'Copy Link' : 'Send Email'}
                            </span>
                        </>
                    )}
                </Pressable>
            </div>

            {/* PAYOUT INTERCEPTOR MODAL */}
            {showPayoutWall && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.8)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 20
                }}>
                    <div style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 24,
                        padding: 24,
                        width: '100%',
                        maxWidth: 360,
                        textAlign: 'center'
                    }}>
                        <div style={{
                            width: 64,
                            height: 64,
                            borderRadius: '50%',
                            background: 'var(--bg-root)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 16px'
                        }}>
                            <CreditCard size={32} />
                        </div>
                        <h3 style={{ fontSize: 20, marginBottom: 8 }}>Connect Payouts</h3>
                        <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
                            To receive this {currencySymbol}{amount}, you need to connect a bank account first.
                        </p>
                        <Pressable
                            className="btn-primary"
                            style={{ width: '100%', marginBottom: 12 }}
                            onClick={() => navigate('/settings/payments', { state: { returnTo: '/request/preview' } })}
                        >
                            Connect Now
                        </Pressable>
                        <Pressable
                            className="btn-text"
                            onClick={() => setShowPayoutWall(false)}
                        >
                            Cancel
                        </Pressable>
                    </div>
                </div>
            )}
        </div>
    )
}
