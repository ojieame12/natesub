import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, MessageSquare, Mail, Link2, Check, Mic, Plus } from 'lucide-react'
import { useRequestStore, getRelationshipLabel } from './store'
import { Pressable } from '../components'
import './request.css'

type SendMethod = 'sms' | 'email' | 'link'

export default function RequestPreview() {
    const navigate = useNavigate()
    const {
        recipient,
        relationship,
        amount,
        isRecurring,
        purpose,
        message,
        voiceNoteUrl,
        voiceNoteDuration,
        reset,
    } = useRequestStore()

    const [sendMethod, setSendMethod] = useState<SendMethod>('link')
    const [isSending, setIsSending] = useState(false)
    const [isSent, setIsSent] = useState(false)

    // Editable contact info
    const [phoneNumber, setPhoneNumber] = useState(recipient?.phone || '')
    const [emailAddress, setEmailAddress] = useState(recipient?.email || '')
    const [editingPhone, setEditingPhone] = useState(false)
    const [editingEmail, setEditingEmail] = useState(false)

    if (!recipient) {
        navigate('/request/new')
        return null
    }

    const firstName = recipient.name.split(' ')[0]
    const relationshipLabel = getRelationshipLabel(relationship)

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const canSendSMS = phoneNumber.length >= 10
    const canSendEmail = emailAddress.includes('@')

    const handleSelectMethod = (method: SendMethod) => {
        setSendMethod(method)
        // Open edit mode if selecting a method without contact info
        if (method === 'sms' && !phoneNumber) {
            setEditingPhone(true)
            setEditingEmail(false)
        } else if (method === 'email' && !emailAddress) {
            setEditingEmail(true)
            setEditingPhone(false)
        } else {
            setEditingPhone(false)
            setEditingEmail(false)
        }
    }

    const handleSend = async () => {
        // Validate before sending
        if (sendMethod === 'sms' && !canSendSMS) {
            setEditingPhone(true)
            return
        }
        if (sendMethod === 'email' && !canSendEmail) {
            setEditingEmail(true)
            return
        }

        setIsSending(true)

        // Simulate sending
        await new Promise(resolve => setTimeout(resolve, 1500))

        setIsSending(false)
        setIsSent(true)

        // In real implementation:
        // - SMS: Use Twilio or native SMS API
        // - Email: Use SendGrid or similar
        // - Link: Copy to clipboard
    }

    const handleDone = () => {
        reset()
        navigate('/dashboard')
    }

    // Success State
    if (isSent) {
        return (
            <div className="request-page">
                <div className="request-success-state">
                    <div className="request-success-icon">
                        <Check size={32} />
                    </div>
                    <h2 className="request-success-title">Request Sent!</h2>
                    <p className="request-success-text">
                        Your request has been sent to {recipient.name}
                        {sendMethod === 'sms' && ' via SMS'}
                        {sendMethod === 'email' && ' via email'}
                        {sendMethod === 'link' && '. Link copied!'}
                    </p>
                    <div className="request-success-summary">
                        <div className="request-summary-row">
                            <span>Amount</span>
                            <span className="request-summary-value">${amount}{isRecurring ? '/mo' : ''}</span>
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
                <span className="request-title">Preview</span>
                <div className="request-header-spacer" />
            </header>

            <div className="request-content">
                {/* Preview Card */}
                <div className="request-preview-card">
                    <div className="request-preview-header">
                        <span className="request-preview-label">What {firstName} will see</span>
                    </div>

                    <div className="request-preview-content">
                        {/* Mini Subscribe Preview */}
                        <div className="request-preview-mini">
                            <div className="request-preview-amount">
                                <span className="request-preview-currency">$</span>
                                <span className="request-preview-value">{amount}</span>
                                {isRecurring && <span className="request-preview-freq">/mo</span>}
                            </div>
                            {purpose && (
                                <span className="request-preview-purpose">{purpose}</span>
                            )}
                        </div>

                        {/* Message Preview */}
                        <div className="request-preview-message">
                            <p>{message}</p>
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
                        {/* SMS Option */}
                        <Pressable
                            className={`request-send-method ${sendMethod === 'sms' ? 'active' : ''}`}
                            onClick={() => handleSelectMethod('sms')}
                        >
                            <MessageSquare size={20} />
                            <span>SMS</span>
                            {phoneNumber ? (
                                <span className="request-send-detail">{phoneNumber}</span>
                            ) : (
                                <span className="request-send-detail request-send-add">
                                    <Plus size={14} /> Add number
                                </span>
                            )}
                        </Pressable>

                        {/* Phone input when editing */}
                        {editingPhone && sendMethod === 'sms' && (
                            <div className="request-send-input-wrapper">
                                <input
                                    type="tel"
                                    placeholder="Enter phone number"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                    className="request-send-input"
                                    autoFocus
                                />
                            </div>
                        )}

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
                        <span className="request-summary-value">${amount}{isRecurring ? '/month' : ' one-time'}</span>
                    </div>
                </div>
            </div>

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
                            {sendMethod === 'sms' && <MessageSquare size={20} />}
                            {sendMethod === 'email' && <Mail size={20} />}
                            {sendMethod === 'link' && <Link2 size={20} />}
                            <span>
                                {sendMethod === 'link' ? 'Copy Link' : `Send ${sendMethod === 'sms' ? 'SMS' : 'Email'}`}
                            </span>
                        </>
                    )}
                </Pressable>
            </div>
        </div>
    )
}
