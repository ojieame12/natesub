import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, User, Phone, Mail, ChevronRight, Users, Loader2 } from 'lucide-react'
import { useRequestStore, type Recipient } from './store'
import { useCurrentUser, useRequests } from '../api/hooks'
import { Pressable, Skeleton } from '../components'
import './request.css'

export default function SelectRecipient() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const isService = userData?.profile?.purpose === 'service'
    const { setRecipient, reset } = useRequestStore()

    // Fetch past requests to get recent recipients
    const { data: requestsData, isLoading: loadingRequests } = useRequests('all')

    // Extract unique recent recipients from past requests
    const recentRecipients = useMemo(() => {
        if (!requestsData?.pages) return []

        const allRequests = requestsData.pages.flatMap(page => page.requests)
        const seen = new Set<string>()
        const recipients: Recipient[] = []

        for (const req of allRequests) {
            const key = req.recipientEmail || req.recipientName
            if (!seen.has(key) && recipients.length < 5) {
                seen.add(key)
                recipients.push({
                    id: `recent-${req.id}`,
                    name: req.recipientName,
                    email: req.recipientEmail || undefined,
                })
            }
        }

        return recipients
    }, [requestsData])

    const [manualName, setManualName] = useState('')
    const [manualContact, setManualContact] = useState('')

    const handleSelectRecipient = (recipient: Recipient) => {
        setRecipient(recipient)
        navigate('/request/relationship')
    }

    const handleManualSubmit = () => {
        if (!manualName.trim()) return

        const isEmail = manualContact.includes('@')
        const newRecipient: Recipient = {
            id: `manual-${Date.now()}`,
            name: manualName.trim(),
            ...(isEmail ? { email: manualContact } : { phone: manualContact }),
        }
        setRecipient(newRecipient)
        navigate('/request/relationship')
    }

    const handleClose = () => {
        reset()
        navigate(-1)
    }

    const canContinue = manualName.trim().length > 0

    return (
        <div className="request-page">
            {/* Header */}
            <header className="request-header">
                <Pressable className="request-close-btn" onClick={handleClose}>
                    <X size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <div className="request-header-spacer" />
            </header>

            <div className="request-content">
                {/* Title */}
                <div className="request-title-section">
                    <h1 className="request-page-title">
                        {isService ? 'Bill a Client' : 'Send a Request'}
                    </h1>
                    <p className="request-page-subtitle">
                        {isService ? 'Who would you like to invoice?' : 'Who would you like to request from?'}
                    </p>
                </div>

                {/* Manual Entry Form */}
                <div className="request-manual-form">
                    <div className="request-input-group">
                        <label className="request-input-label">Name *</label>
                        <div className="request-input-wrapper">
                            <User size={18} className="request-input-icon" />
                            <input
                                type="text"
                                placeholder={isService ? "Client or company name" : "Enter name"}
                                value={manualName}
                                onChange={(e) => setManualName(e.target.value)}
                                className="request-input"
                            />
                        </div>
                    </div>

                    <div className="request-input-group">
                        <label className="request-input-label">Email or Phone</label>
                        <div className="request-input-wrapper">
                            {manualContact.includes('@') ? (
                                <Mail size={18} className="request-input-icon" />
                            ) : (
                                <Phone size={18} className="request-input-icon" />
                            )}
                            <input
                                type="text"
                                placeholder="Email address or phone number"
                                value={manualContact}
                                onChange={(e) => setManualContact(e.target.value)}
                                className="request-input"
                            />
                        </div>
                        <span className="request-input-hint">
                            Optional - you can share the link manually
                        </span>
                    </div>

                    <Pressable
                        className={`request-continue-btn ${canContinue ? '' : 'disabled'}`}
                        onClick={handleManualSubmit}
                        disabled={!canContinue}
                    >
                        Continue
                    </Pressable>
                </div>

                {/* Recent Recipients */}
                {loadingRequests ? (
                    <div className="request-contacts-section">
                        <Skeleton width={100} height={16} style={{ marginBottom: 12 }} />
                        <Skeleton width="100%" height={60} borderRadius={12} />
                        <Skeleton width="100%" height={60} borderRadius={12} style={{ marginTop: 8 }} />
                    </div>
                ) : recentRecipients.length > 0 && (
                    <div className="request-contacts-section">
                        <h3 className="request-section-title">
                            {isService ? 'Recent Clients' : 'Recent Recipients'}
                        </h3>
                        <div className="request-contacts-list">
                            {recentRecipients.map((recipient) => (
                                <Pressable
                                    key={recipient.id}
                                    className="request-contact-item"
                                    onClick={() => handleSelectRecipient(recipient)}
                                >
                                    <div className="request-contact-avatar">
                                        {recipient.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="request-contact-info">
                                        <span className="request-contact-name">{recipient.name}</span>
                                        {recipient.email && (
                                            <span className="request-contact-detail">
                                                {recipient.email}
                                            </span>
                                        )}
                                    </div>
                                    <ChevronRight size={18} className="request-chevron" />
                                </Pressable>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
