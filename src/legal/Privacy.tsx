import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Pressable } from '../components'
import './Legal.css'

export default function Privacy() {
    const navigate = useNavigate()

    const handleBack = () => {
        // These pages are typically opened in new tabs (target="_blank")
        // Try to close the tab first, fall back to navigation
        if (window.opener || window.history.length <= 2) {
            // Opened in new tab - try to close it
            window.close()
            // If close didn't work (some browsers block it), navigate away
            setTimeout(() => {
                navigate('/onboarding')
            }, 100)
        } else {
            // Opened via normal navigation - go back
            navigate(-1)
        }
    }

    return (
        <div className="legal-page">
            <header className="legal-header">
                <Pressable className="legal-back-btn" onClick={handleBack}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="legal-header-title">Privacy Policy</span>
                <div className="legal-header-spacer" />
            </header>

            <div className="legal-content">
                <p className="legal-last-updated">Last updated: December 12, 2025</p>

                <section className="legal-section">
                    <h2>1. Introduction</h2>
                    <p>
                        NatePay ("we", "our", or "us") respects your privacy and is committed
                        to protecting your personal data. This Privacy Policy explains how we
                        collect, use, and safeguard your information when you use our service.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>2. Information We Collect</h2>

                    <h3>Account Information</h3>
                    <p>When you create an account, we collect:</p>
                    <ul>
                        <li>Email address</li>
                        <li>Name and display name</li>
                        <li>Profile photo (optional)</li>
                        <li>Country and currency preference</li>
                    </ul>

                    <h3>Payment Information</h3>
                    <p>To process payments, we collect:</p>
                    <ul>
                        <li>Bank account details (processed securely by Stripe or Paystack)</li>
                        <li>Transaction history</li>
                        <li>Payout preferences</li>
                    </ul>

                    <h3>Usage Information</h3>
                    <p>We automatically collect:</p>
                    <ul>
                        <li>Device information and browser type</li>
                        <li>IP address (anonymized for analytics)</li>
                        <li>Pages visited and features used</li>
                        <li>Referral sources</li>
                    </ul>
                </section>

                <section className="legal-section">
                    <h2>3. How We Use Your Information</h2>
                    <p>We use your information to:</p>
                    <ul>
                        <li>Provide and maintain our Service</li>
                        <li>Process payments and payouts</li>
                        <li>Send transaction notifications and updates</li>
                        <li>Respond to support requests</li>
                        <li>Prevent fraud and ensure security</li>
                        <li>Improve our Service based on usage patterns</li>
                        <li>Comply with legal obligations</li>
                    </ul>
                </section>

                <section className="legal-section">
                    <h2>4. Information Sharing</h2>
                    <p>We share your information with:</p>
                    <ul>
                        <li>
                            <strong>Payment Processors:</strong> Stripe and Paystack to process
                            transactions securely
                        </li>
                        <li>
                            <strong>Your Subscribers:</strong> Limited profile information you
                            choose to make public
                        </li>
                        <li>
                            <strong>Service Providers:</strong> Email delivery, cloud hosting,
                            and analytics services
                        </li>
                        <li>
                            <strong>Legal Authorities:</strong> When required by law or to
                            protect our rights
                        </li>
                    </ul>
                    <p>
                        We never sell your personal information to third parties for marketing
                        purposes.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>5. Data Security</h2>
                    <p>
                        We implement industry-standard security measures to protect your data:
                    </p>
                    <ul>
                        <li>Encryption in transit (TLS) and at rest</li>
                        <li>Secure payment processing via PCI-compliant providers</li>
                        <li>Regular security audits and monitoring</li>
                        <li>Access controls and authentication</li>
                    </ul>
                </section>

                <section className="legal-section">
                    <h2>6. Data Retention</h2>
                    <p>
                        We retain your account information for as long as your account is
                        active. Transaction records are kept for 7 years for tax and legal
                        compliance. You may request deletion of your data by contacting us,
                        subject to our legal retention requirements.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>7. Your Rights</h2>
                    <p>Depending on your location, you may have the right to:</p>
                    <ul>
                        <li>Access your personal data</li>
                        <li>Correct inaccurate information</li>
                        <li>Request deletion of your data</li>
                        <li>Export your data in a portable format</li>
                        <li>Opt out of marketing communications</li>
                        <li>Withdraw consent for data processing</li>
                    </ul>
                    <p>
                        To exercise these rights, contact us at{' '}
                        <a href="mailto:support@natepay.co">support@natepay.co</a>.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>8. Cookies and Tracking</h2>
                    <p>
                        We use essential cookies to maintain your session and preferences.
                        We may use analytics tools to understand how users interact with our
                        Service. You can control cookie preferences through your browser settings.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>9. International Transfers</h2>
                    <p>
                        Your data may be processed in countries other than your own. We ensure
                        appropriate safeguards are in place for international data transfers,
                        including standard contractual clauses where required.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>10. Children's Privacy</h2>
                    <p>
                        NatePay is not intended for users under 18 years of age. We do not
                        knowingly collect information from children. If we learn we have
                        collected data from a child, we will delete it promptly.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>11. Changes to This Policy</h2>
                    <p>
                        We may update this Privacy Policy from time to time. We will notify
                        you of material changes via email or in-app notification. The "Last
                        updated" date at the top indicates when the policy was last revised.
                    </p>
                </section>

                <div className="legal-contact">
                    <p>
                        Questions about your privacy? Contact us at{' '}
                        <a href="mailto:support@natepay.co">support@natepay.co</a>
                    </p>
                </div>
            </div>
        </div>
    )
}
