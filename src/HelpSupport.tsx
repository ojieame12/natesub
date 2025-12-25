import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, ChevronDown, ChevronUp, Mail, FileText, Shield, Send, X, CheckCircle } from 'lucide-react'
import { Pressable, useToast } from './components'
import { useAuthState } from './hooks/useAuthState'
import { TERMS_URL, PRIVACY_URL } from './utils/constants'
import './HelpSupport.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const SUPPORT_TIMEOUT_MS = 15_000 // 15s for support ticket submission

const faqs = [
  {
    id: 1,
    question: 'How do I get paid?',
    answer: 'Payments are automatically deposited to your connected bank account based on your payout schedule. You can choose instant, daily, weekly, or monthly payouts in Payment Settings.',
  },
  {
    id: 2,
    question: 'How do I share my page?',
    answer: 'From your dashboard, tap the share button on your link card. You can copy the link directly or share it to social media and messaging apps.',
  },
  {
    id: 3,
    question: 'How do I cancel a subscription?',
    answer: 'Subscribers can cancel their own subscriptions at any time. As a creator, you can also remove subscribers from your Subscribers page.',
  },
  {
    id: 4,
    question: 'Can I offer different tiers?',
    answer: 'Yes! Go to Edit My Page to create multiple subscription tiers with different prices and perks.',
  },
]

const categories = [
  { value: 'general', label: 'General Question' },
  { value: 'billing', label: 'Billing & Payments' },
  { value: 'technical', label: 'Technical Issue' },
  { value: 'account', label: 'Account Help' },
  { value: 'payout', label: 'Payout Issue' },
  { value: 'dispute', label: 'Dispute / Chargeback' },
]

export default function HelpSupport() {
  const navigate = useNavigate()
  const { user } = useAuthState()
  const toast = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    email: user?.email || '',
    name: '',
    category: 'general',
    subject: '',
    message: '',
  })

  const filteredFaqs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const toggleFaq = (id: number) => {
    setExpandedFaq(expandedFaq === id ? null : id)
  }

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.email || !formData.subject || !formData.message) {
      toast.error('Please fill in all required fields')
      return
    }

    if (formData.message.length < 10) {
      toast.error('Please provide more detail in your message')
      return
    }

    setSubmitting(true)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SUPPORT_TIMEOUT_MS)

    try {
      const response = await fetch(`${API_URL}/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit ticket')
      }

      setShowForm(false)
      setShowSuccess(true)
      setFormData({
        email: user?.email || '',
        name: '',
        category: 'general',
        subject: '',
        message: '',
      })
    } catch (err: any) {
      clearTimeout(timeoutId)
      const message = err.name === 'AbortError'
        ? 'Request timed out. Please check your connection and try again.'
        : (err.message || 'Failed to submit request')
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleTerms = () => {
    window.open(TERMS_URL, '_blank')
  }

  const handlePrivacy = () => {
    window.open(PRIVACY_URL, '_blank')
  }

  return (
    <div className="help-page">
      {/* Header */}
      <header className="help-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <div className="header-spacer" />
      </header>

      <div className="help-content">
        {/* Search */}
        <div className="help-search">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search help articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Contact Options */}
        <section className="help-section">
          <h3 className="section-label">Contact Us</h3>
          <div className="contact-card">
            <Pressable className="contact-row" onClick={() => setShowForm(true)}>
              <div className="contact-icon">
                <Send size={20} />
              </div>
              <div className="contact-info">
                <span className="contact-title">Submit a Request</span>
                <span className="contact-desc">We typically respond within 1-2 business days</span>
              </div>
            </Pressable>
            <Pressable className="contact-row" onClick={() => window.location.href = 'mailto:support@natepay.co'}>
              <div className="contact-icon">
                <Mail size={20} />
              </div>
              <div className="contact-info">
                <span className="contact-title">Email Support</span>
                <span className="contact-desc">support@natepay.co</span>
              </div>
            </Pressable>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="help-section">
          <h3 className="section-label">Frequently Asked Questions</h3>
          <div className="faq-list">
            {filteredFaqs.map((faq) => (
              <div key={faq.id} className="faq-item">
                <Pressable
                  className="faq-question"
                  onClick={() => toggleFaq(faq.id)}
                >
                  <span className="faq-question-text">{faq.question}</span>
                  {expandedFaq === faq.id ? (
                    <ChevronUp size={18} className="faq-chevron" />
                  ) : (
                    <ChevronDown size={18} className="faq-chevron" />
                  )}
                </Pressable>
                {expandedFaq === faq.id && (
                  <div className="faq-answer">
                    <p>{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Legal Links */}
        <section className="help-section">
          <h3 className="section-label">Legal</h3>
          <div className="legal-card">
            <Pressable className="legal-row" onClick={handleTerms}>
              <FileText size={18} className="legal-icon" />
              <span className="legal-title">Terms of Service</span>
            </Pressable>
            <Pressable className="legal-row" onClick={handlePrivacy}>
              <Shield size={18} className="legal-icon" />
              <span className="legal-title">Privacy Policy</span>
            </Pressable>
          </div>
        </section>
      </div>

      {/* Support Request Form Modal */}
      {showForm && (
        <div className="help-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="help-modal-header">
              <h2>Submit a Request</h2>
              <Pressable className="help-modal-close" onClick={() => setShowForm(false)}>
                <X size={20} />
              </Pressable>
            </div>

            <form onSubmit={handleSubmitTicket} className="help-form">
              {!user && (
                <div className="help-form-group">
                  <label htmlFor="email">Email *</label>
                  <input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="your@email.com"
                    required
                  />
                </div>
              )}

              <div className="help-form-group">
                <label htmlFor="name">Name (optional)</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Your name"
                />
              </div>

              <div className="help-form-group">
                <label htmlFor="category">Category *</label>
                <select
                  id="category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  required
                >
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div className="help-form-group">
                <label htmlFor="subject">Subject *</label>
                <input
                  id="subject"
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="Brief description of your issue"
                  required
                  maxLength={200}
                />
              </div>

              <div className="help-form-group">
                <label htmlFor="message">Message *</label>
                <textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Please describe your issue in detail..."
                  required
                  minLength={10}
                  maxLength={5000}
                  rows={5}
                />
              </div>

              <button
                type="submit"
                className="help-submit-btn"
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccess && (
        <div className="help-modal-overlay" onClick={() => setShowSuccess(false)}>
          <div className="help-modal help-modal-success" onClick={(e) => e.stopPropagation()}>
            <CheckCircle size={48} className="success-icon" />
            <h2>Request Submitted</h2>
            <p>We've received your support request and will respond within 1-2 business days.</p>
            <Pressable className="help-success-btn" onClick={() => setShowSuccess(false)}>
              Close
            </Pressable>
          </div>
        </div>
      )}
    </div>
  )
}
