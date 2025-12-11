import { useRef, useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Pressable } from './components'
import '../Dashboard.css'
import './onboarding.css'

export default function OtpStep() {
    const { otp, setOtp, nextStep, prevStep, email } = useOnboardingStore()
    const inputRefs = useRef<(HTMLInputElement | null)[]>([])

    const digits = otp.split('').concat(Array(6 - otp.length).fill(''))

    useEffect(() => {
        if (otp.length === 6) {
            const timer = setTimeout(() => nextStep(), 300)
            return () => clearTimeout(timer)
        }
    }, [otp, nextStep])

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return
        const newOtp = otp.split('')
        newOtp[index] = value.slice(-1)
        setOtp(newOtp.join('').slice(0, 6))
        if (value && index < 5) inputRefs.current[index + 1]?.focus()
    }

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus()
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
                    <h1>Enter the code</h1>
                    <p>We sent a 6-digit code to {email}</p>
                </div>

                <div className="step-body">
                    <div className="otp-container">
                        {digits.map((digit, i) => (
                            <input
                                key={i}
                                ref={(el) => { inputRefs.current[i] = el }}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleChange(i, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(i, e)}
                                className="otp-digit"
                                autoFocus={i === 0}
                            />
                        ))}
                    </div>

                    <div style={{ textAlign: 'center', marginTop: 24 }}>
                        <Pressable onClick={() => console.log('Resend')}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
                                Didn't get a code? <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Resend</span>
                            </span>
                        </Pressable>
                    </div>
                </div>
            </div>
        </div>
    )
}
