import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Pressable } from '../components'
import './Legal.css'

export default function Terms() {
    const navigate = useNavigate()

    const handleBack = () => {
        // If there's history, go back; otherwise go to onboarding
        if (window.history.length > 1) {
            navigate(-1)
        } else {
            navigate('/onboarding')
        }
    }

    return (
        <div className="legal-page">
            <header className="legal-header">
                <Pressable className="legal-back-btn" onClick={handleBack}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="legal-header-title">Terms of Service</span>
                <div className="legal-header-spacer" />
            </header>

            <div className="legal-content">
                <p className="legal-last-updated">Last updated: December 12, 2025</p>

                <section className="legal-section">
                    <h2>1. Acceptance of Terms</h2>
                    <p>
                        By accessing or using NatePay ("Service"), you agree to be bound by these
                        Terms of Service. If you do not agree to these terms, please do not use
                        the Service.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>2. Description of Service</h2>
                    <p>
                        NatePay is a platform that enables creators, service providers, and
                        individuals to receive recurring payments from their supporters, clients,
                        or subscribers. We facilitate payment processing but are not a party to
                        the agreements between creators and their subscribers.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>3. Account Registration</h2>
                    <p>To use NatePay, you must:</p>
                    <ul>
                        <li>Be at least 18 years old or the age of majority in your jurisdiction</li>
                        <li>Provide accurate and complete registration information</li>
                        <li>Maintain the security of your account credentials</li>
                        <li>Notify us immediately of any unauthorized access</li>
                    </ul>
                </section>

                <section className="legal-section">
                    <h2>4. Fees and Payments</h2>
                    <p>
                        NatePay charges a service fee on transactions processed through our platform.
                        Fee rates vary based on your account type and are disclosed before you
                        complete your profile setup.
                    </p>
                    <h3>Service Providers</h3>
                    <p>
                        8% service fee (capped), plus a $5/month platform subscription after the
                        first month free trial.
                    </p>
                    <h3>Personal Users</h3>
                    <p>
                        10% service fee (capped), no monthly subscription required.
                    </p>
                    <p>
                        All fees are deducted from payments before transfer to your connected
                        bank account. Payment processing fees charged by our payment partners
                        (Stripe, Paystack) are separate and handled by those providers.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>5. Acceptable Use</h2>
                    <p>You agree not to use NatePay for:</p>
                    <ul>
                        <li>Illegal activities or promoting illegal content</li>
                        <li>Fraudulent transactions or money laundering</li>
                        <li>Harassment, abuse, or harm to others</li>
                        <li>Adult content, gambling, or regulated substances</li>
                        <li>Violation of intellectual property rights</li>
                    </ul>
                    <p>
                        We reserve the right to suspend or terminate accounts that violate these
                        guidelines.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>6. Payouts and Refunds</h2>
                    <p>
                        Funds are transferred to your connected bank account according to your
                        payout schedule. Subscribers may request refunds within 14 days of a
                        payment for unused service periods. Chargebacks and disputes are handled
                        according to the policies of the relevant payment processor.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>7. Intellectual Property</h2>
                    <p>
                        You retain ownership of content you create and share through NatePay.
                        By using our Service, you grant us a limited license to display and
                        transmit your content as necessary to operate the platform.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>8. Limitation of Liability</h2>
                    <p>
                        NatePay is provided "as is" without warranties of any kind. We are not
                        liable for any indirect, incidental, or consequential damages arising
                        from your use of the Service. Our total liability is limited to the
                        fees you have paid us in the past 12 months.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>9. Termination</h2>
                    <p>
                        You may close your account at any time. We may suspend or terminate
                        your account for violation of these terms or for any reason with
                        reasonable notice. Upon termination, pending payouts will be processed
                        according to our standard schedule.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>10. Changes to Terms</h2>
                    <p>
                        We may update these terms from time to time. Material changes will be
                        communicated via email or in-app notification. Continued use of the
                        Service after changes constitutes acceptance of the updated terms.
                    </p>
                </section>

                <section className="legal-section">
                    <h2>11. Governing Law</h2>
                    <p>
                        These terms are governed by the laws of the State of Delaware, USA,
                        without regard to conflict of law provisions.
                    </p>
                </section>

                <div className="legal-contact">
                    <p>
                        Questions about these terms? Contact us at{' '}
                        <a href="mailto:legal@natepay.com">legal@natepay.com</a>
                    </p>
                </div>
            </div>
        </div>
    )
}
