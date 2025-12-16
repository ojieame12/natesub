import { Settings } from 'lucide-react'
import { Pressable } from '../components'

interface FeeModeToggleProps {
    mode: 'absorb' | 'pass_to_subscriber'
    onToggle: (newMode: 'absorb' | 'pass_to_subscriber') => void
    disabled?: boolean
}

export default function FeeModeToggle({ mode, onToggle, disabled }: FeeModeToggleProps) {
    // Current state derived from prop
    const isAbsorbing = mode === 'absorb'

    return (
        <div className="sub-fee-toggle-card">
            <div className="sub-fee-toggle-header">
                <Settings size={14} className="sub-fee-icon" />
                <span className="sub-fee-title">Fee Preferences</span>
            </div>

            <div className="sub-fee-options">
                <Pressable
                    className={`sub-fee-option ${isAbsorbing ? 'selected' : ''}`}
                    onClick={() => !disabled && onToggle('absorb')}
                >
                    <div className="sub-fee-radio">
                        {isAbsorbing && <div className="sub-fee-dot" />}
                    </div>
                    <span>I pay fees</span>
                </Pressable>

                <Pressable
                    className={`sub-fee-option ${!isAbsorbing ? 'selected' : ''}`}
                    onClick={() => !disabled && onToggle('pass_to_subscriber')}
                >
                    <div className="sub-fee-radio">
                        {!isAbsorbing && <div className="sub-fee-dot" />}
                    </div>
                    <span>Subscriber pays</span>
                </Pressable>
            </div>
        </div>
    )
}
