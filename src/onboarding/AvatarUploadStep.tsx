import { useState, useRef } from 'react'
import { ChevronLeft, Camera, User, X, RefreshCw, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { InlineError } from '../components'
import { uploadFile } from '../api/hooks'
import '../Dashboard.css'
import './onboarding.css'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB (images are compressed before upload)

export default function AvatarUploadStep() {
    const { avatarUrl, setAvatarUrl, nextStep, prevStep } = useOnboardingStore()
    const [avatarPreview, setAvatarPreview] = useState<string | null>(avatarUrl)
    const [error, setError] = useState<string | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setError(null)

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            setError('Image must be under 10MB')
            return
        }

        // Validate file type (including HEIC from iPhone cameras)
        const isImage = file.type.startsWith('image/') ||
                       file.type === 'image/heic' ||
                       file.type === 'image/heif' ||
                       file.name.toLowerCase().endsWith('.heic') ||
                       file.name.toLowerCase().endsWith('.heif')

        if (!isImage) {
            setError('Please select an image file')
            return
        }

        // Show local preview immediately for better UX
        const localPreview = URL.createObjectURL(file)
        setAvatarPreview(localPreview)
        setIsUploading(true)

        try {
            // Upload to S3 and get the public URL
            const publicUrl = await uploadFile(file, 'avatar')
            setAvatarUrl(publicUrl)
            // Clean up local preview URL
            URL.revokeObjectURL(localPreview)
        } catch (err: any) {
            console.error('Avatar upload failed:', err)
            const errorMsg = err?.message || err?.error || 'Failed to upload image. Please try again.'
            setError(errorMsg)
            setAvatarPreview(null)
            setAvatarUrl(null)
            URL.revokeObjectURL(localPreview)
        } finally {
            setIsUploading(false)
        }
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
                        accept="image/*,.heic,.heif"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />

                    {avatarPreview ? (
                        /* Photo uploaded - show preview with actions */
                        <div className="avatar-uploaded">
                            <div className="avatar-preview-large">
                                <img src={avatarPreview} alt="Avatar" style={{ opacity: isUploading ? 0.5 : 1 }} />
                                {isUploading && (
                                    <div className="avatar-upload-overlay">
                                        <Loader2 size={24} className="spinning" />
                                    </div>
                                )}
                            </div>
                            <div className="avatar-actions">
                                <Pressable className="avatar-action-btn" onClick={handleChangePhoto} disabled={isUploading}>
                                    <RefreshCw size={18} />
                                    <span>Change</span>
                                </Pressable>
                                <Pressable className="avatar-action-btn danger" onClick={handleRemove} disabled={isUploading}>
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
                            <span className="avatar-upload-hint">JPG, PNG up to 10MB</span>
                        </Pressable>
                    )}

                    {error && <InlineError message={error} style={{ marginTop: 16 }} />}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={isUploading}
                    >
                        {isUploading ? (
                            <>
                                <Loader2 size={18} className="spinning" style={{ marginRight: 8 }} />
                                Uploading...
                            </>
                        ) : avatarPreview ? 'Continue' : 'Skip for now'}
                    </Button>
                </div>
            </div>
        </div>
    )
}
