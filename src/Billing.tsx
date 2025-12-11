import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sparkles, Check } from 'lucide-react'
import { Pressable } from './components'
import './Billing.css'

export default function Billing() {
    const navigate = useNavigate()

    return (
        <div className="billing-page">
            {/* Header */}
            <header className="billing-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="billing-title">Billing</span>
                <div className="header-spacer" />
            </header>

            <div className="billing-content">
                {/* Coming Soon State */}
                <div className="billing-coming-soon">
                    <div className="billing-coming-soon-icon">
                        <Sparkles size={32} />
                    </div>
                    <h2 className="billing-coming-soon-title">Billing Coming Soon</h2>
                    <p className="billing-coming-soon-text">
                        Platform subscriptions and billing management will be available in a future update.
                    </p>
                </div>

                {/* Current Pricing Info */}
                <section className="fee-info">
                    <h4 className="fee-title">How NatePay works</h4>
                    <div className="fee-row">
                        <span>Platform fee</span>
                        <span>$5/month</span>
                    </div>
                    <div className="fee-row">
                        <span>Transaction fee</span>
                        <span>6% + Stripe 2%</span>
                    </div>
                    <p className="fee-note">
                        You keep 92% of every payment from your subscribers.
                    </p>
                </section>

                {/* What's Included */}
                <section className="billing-section">
                    <h3 className="section-title">What's Included</h3>
                    <div className="plan-features">
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Unlimited subscribers</span>
                        </div>
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Custom subscription page</span>
                        </div>
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Voice note requests</span>
                        </div>
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Analytics dashboard</span>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    )
}
