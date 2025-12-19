import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, ChevronDown, ChevronUp, Mail, MessageCircle, FileText, Shield } from 'lucide-react'
import { Pressable, useToast } from './components'
import { TERMS_URL, PRIVACY_URL } from './utils/constants'
import './HelpSupport.css'

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
    question: 'What are the fees?',
    answer: 'NatePay charges 8% on all transactions. This covers payment processing and platform costs. No hidden fees.',
  },
  {
    id: 4,
    question: 'How do I cancel a subscription?',
    answer: 'Subscribers can cancel their own subscriptions at any time. As a creator, you can also remove subscribers from your Subscribers page.',
  },
  {
    id: 5,
    question: 'Can I offer different tiers?',
    answer: 'Yes! Go to Edit My Page to create multiple subscription tiers with different prices and perks.',
  },
]

export default function HelpSupport() {
  const navigate = useNavigate()
  const toast = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  const filteredFaqs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const toggleFaq = (id: number) => {
    setExpandedFaq(expandedFaq === id ? null : id)
  }

  const handleEmailSupport = () => {
    window.location.href = 'mailto:support@natepay.com'
  }

  const handleLiveChat = () => {
    toast.info('Live chat coming soon')
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
            <Pressable className="contact-row" onClick={handleEmailSupport}>
              <div className="contact-icon">
                <Mail size={20} />
              </div>
              <div className="contact-info">
                <span className="contact-title">Email Support</span>
                <span className="contact-desc">Get a response within 24 hours</span>
              </div>
            </Pressable>
            <Pressable className="contact-row" onClick={handleLiveChat}>
              <div className="contact-icon">
                <MessageCircle size={20} />
              </div>
              <div className="contact-info">
                <span className="contact-title">Live Chat</span>
                <span className="contact-desc">Available 9am - 5pm EST</span>
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
    </div>
  )
}
