import { useState } from 'react'
import { ChevronLeft, Camera, User } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import '../Dashboard.css'
import './onboarding.css'

export default function AvatarUploadStep() {
    const { avatarUrl, setAvatarUrl, nextStep, prevStep } = useOnboardingStore()
    const [avatarPreview, setAvatarPreview] = useState<string | null>(avatarUrl)

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            const reader = new FileReader()
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string
                setAvatarPreview(dataUrl)
                setAvatarUrl(dataUrl) // Save to store
            }
            reader.readAsDataURL(file)
        }
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
                    <label className="avatar-upload">
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleFileSelect}
                            style={{ display: 'none' }}
                        />
                        <div className="avatar-preview">
                            {avatarPreview ? (
                                <img src={avatarPreview} alt="Avatar" />
                            ) : (
                                <User size={48} />
                            )}
                            <div className="avatar-camera">
                                <Camera size={20} />
                            </div>
                        </div>
                    </label>
                    <p style={{ fontSize: 14, color: 'var(--text-tertiary)', marginTop: 16 }}>
                        Tap to upload a photo
                    </p>
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
