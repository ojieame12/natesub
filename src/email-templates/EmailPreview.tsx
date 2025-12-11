import { X } from 'lucide-react'
import { Pressable } from '../components'
import './EmailPreview.css'

interface EmailPreviewProps {
    senderName: string
    senderUsername: string
    senderAvatar?: string
    message: string
    imageUrl?: string
    onClose?: () => void
}

export default function EmailPreview({
    senderName,
    senderUsername,
    senderAvatar,
    message,
    imageUrl,
    onClose,
}: EmailPreviewProps) {
    const senderInitial = senderName.charAt(0).toUpperCase()
    const senderFirstName = senderName.split(' ')[0]

    return (
        <div className="email-preview-overlay">
            <div className="email-preview-container">
                {/* Close button */}
                {onClose && (
                    <Pressable className="email-preview-close" onClick={onClose}>
                        <X size={20} />
                    </Pressable>
                )}

                {/* Email client chrome */}
                <div className="email-preview-chrome">
                    <div className="email-chrome-dots">
                        <span className="dot red" />
                        <span className="dot yellow" />
                        <span className="dot green" />
                    </div>
                    <span className="email-chrome-title">Email Preview</span>
                </div>

                {/* Email header bar */}
                <div className="email-header-bar">
                    <div className="email-header-row">
                        <span className="email-header-label">From:</span>
                        <span className="email-header-value">{senderName} &lt;{senderUsername}@natepay.co&gt;</span>
                    </div>
                    <div className="email-header-row">
                        <span className="email-header-label">Subject:</span>
                        <span className="email-header-value">{senderName} sent you an update</span>
                    </div>
                </div>

                {/* Email body */}
                <div className="email-preview-body">
                    <div className="email-card">
                        {/* Header with avatar */}
                        <div className="email-sender-header">
                            {senderAvatar ? (
                                <img
                                    src={senderAvatar}
                                    alt={senderName}
                                    className="email-sender-avatar"
                                />
                            ) : (
                                <div className="email-sender-avatar placeholder">
                                    {senderInitial}
                                </div>
                            )}
                            <div className="email-sender-info">
                                <span className="email-sender-name">{senderName}</span>
                                <span className="email-sender-username">@{senderUsername}</span>
                            </div>
                        </div>

                        <div className="email-divider" />

                        {/* Image */}
                        {imageUrl && (
                            <div className="email-image">
                                <img src={imageUrl} alt="" />
                            </div>
                        )}

                        {/* Message */}
                        <div className="email-message">
                            <p>{message}</p>
                        </div>

                        {/* Signature */}
                        <div className="email-signature">
                            — {senderFirstName}
                        </div>

                        {/* Reply CTA */}
                        <div className="email-cta">
                            <button className="email-reply-btn">
                                Reply to {senderFirstName}
                            </button>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="email-footer">
                        <p className="email-footer-sub">You're subscribed to {senderName}</p>
                        <p className="email-footer-links">
                            <a href="#manage">Manage subscription</a>
                            <span className="email-footer-dot">·</span>
                            <a href="#unsubscribe">Unsubscribe</a>
                        </p>
                        <div className="email-footer-logo">
                            <img src="/logo.svg" alt="NatePay" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
