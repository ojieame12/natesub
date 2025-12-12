import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, FileText, Sparkles, Zap } from 'lucide-react'
import { Pressable } from './components'
import { useProfile } from './api/hooks'
import './Billing.css'

export default function Billing() {
    const navigate = useNavigate()
    const { data: profileData } = useProfile()
    const profile = profileData?.profile
    const isService = profile?.purpose === 'service'

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
                {isService ? (
                    // SERVICE BRANCH - $5/mo subscription
                    <>
                        <div className="billing-plan-card service">
                            <div className="billing-plan-badge">
                                <Sparkles size={14} />
                                <span>Service Plan</span>
                            </div>
                            <div className="billing-plan-price">
                                <span className="billing-price-amount">$5</span>
                                <span className="billing-price-period">/month</span>
                            </div>
                            <p className="billing-plan-desc">
                                Professional tools for service providers
                            </p>
                            <div className="billing-plan-fee">
                                <span>Transaction fee</span>
                                <span>8%</span>
                            </div>
                        </div>

                        {/* What's Included - Service */}
                        <section className="billing-section">
                            <h3 className="section-title">What's Included</h3>
                            <div className="plan-features">
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>AI-generated page content</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Payroll documents with PDF</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Income verification for loans</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Professional client management</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Lower 8% transaction fees</span>
                                </div>
                            </div>
                        </section>

                        {/* Manage Subscription */}
                        <Pressable className="billing-manage-btn">
                            <span>Manage Subscription</span>
                        </Pressable>

                        <p className="billing-footer-note">
                            Cancel anytime. Your subscription helps us build better tools for service providers.
                        </p>
                    </>
                ) : (
                    // PERSONAL BRANCH - Free
                    <>
                        <div className="billing-plan-card personal">
                            <div className="billing-plan-badge free">
                                <Zap size={14} />
                                <span>Free Plan</span>
                            </div>
                            <div className="billing-plan-price">
                                <span className="billing-price-amount">$0</span>
                                <span className="billing-price-period">/month</span>
                            </div>
                            <p className="billing-plan-desc">
                                No monthly fee. Pay only when you earn.
                            </p>
                            <div className="billing-plan-fee">
                                <span>Transaction fee</span>
                                <span>10%</span>
                            </div>
                        </div>

                        {/* What's Included - Personal */}
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
                                    <span>Payment processing</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Activity tracking</span>
                                </div>
                            </div>
                        </section>

                        {/* Upgrade CTA */}
                        <div className="billing-upgrade-section">
                            <h4 className="billing-upgrade-title">Want more features?</h4>
                            <div className="billing-upgrade-card">
                                <div className="billing-upgrade-header">
                                    <FileText size={20} />
                                    <div>
                                        <span className="billing-upgrade-name">Service Plan</span>
                                        <span className="billing-upgrade-price">$5/mo</span>
                                    </div>
                                </div>
                                <ul className="billing-upgrade-perks">
                                    <li>AI-generated page content</li>
                                    <li>Payroll documents for loans</li>
                                    <li>Lower 8% transaction fees</li>
                                </ul>
                                <Pressable className="billing-upgrade-btn">
                                    <span>Upgrade to Service</span>
                                </Pressable>
                            </div>
                        </div>

                        <p className="billing-footer-note">
                            You keep 90% of every payment. No monthly commitment.
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
