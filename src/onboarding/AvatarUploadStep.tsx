import { useState, useRef } from 'react'
import { ChevronLeft, Camera, User, X, RefreshCw } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import '../Dashboard.css'
import './onboarding.css'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export default function AvatarUploadStep() {
    const { avatarUrl, setAvatarUrl, nextStep, prevStep } = useOnboardingStore()
    const [avatarPreview, setAvatarPreview] = useState<string | null>(avatarUrl)
    const [error, setError] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setError(null)

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            setError('Image must be under 5MB')
            return
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            setError('Please select an image file')
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string
            setAvatarPreview(dataUrl)
            setAvatarUrl(dataUrl)
        }
        reader.onerror = () => {
            setError('Failed to read image. Please try again.')
        }
        reader.readAsDataURL(file)
    }

    const handleRemove = () => {
        setAvatarPreview(null)
        setAvatarUrl(null)
        setError(null)
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const handleChangePhoto = () => {
        fileInputRef.current?.click()
    }

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-header">
                <Pressable className="onboarding-back" onClick={prevStep}>
                    <ChevronLeft size={24} />
                </Pressable>
            </div>

            <div className="onboarding-content">
                <div className="step-header">
                    <h1>Add a photo</h1>
                    <p>Help subscribers recognize you.</p>
                </div>

                <div className="step-body" style={{ alignItems: 'center' }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />

                    {avatarPreview ? (
                        /* Photo uploaded - show preview with actions */
                        <div className="avatar-uploaded">
                            <div className="avatar-preview-large">
                                <img src={avatarPreview} alt="Avatar" />
                            </div>
                            <div className="avatar-actions">
                                <Pressable className="avatar-action-btn" onClick={handleChangePhoto}>
                                    <RefreshCw size={18} />
                                    <span>Change</span>
                                </Pressable>
                                <Pressable className="avatar-action-btn danger" onClick={handleRemove}>
                                    <X size={18} />
                                    <span>Remove</span>
                                </Pressable>
                            </div>
                        </div>
                    ) : (
                        /* No photo - show upload area */
                        <Pressable className="avatar-upload-area" onClick={handleChangePhoto}>
                            <div className="avatar-upload-icon">
                                <User size={40} />
                                <div className="avatar-upload-camera">
                                    <Camera size={16} />
                                </div>
                            </div>
                            <span className="avatar-upload-text">Tap to add photo</span>
                            <span className="avatar-upload-hint">JPG, PNG up to 5MB</span>
                        </Pressable>
                    )}

                    {error && (
                        <p className="input-error-text" style={{ marginTop: 16 }}>{error}</p>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                    >
                        {avatarPreview ? 'Continue' : 'Skip for now'}
                    </Button>
                </div>
            </div>
        </div>
    )
}
