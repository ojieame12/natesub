import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Plus, ChevronRight, Check } from 'lucide-react'
import { Pressable } from './components'
import './PaymentSettings.css'

const payoutSchedules = [
  { id: 'instant', label: 'Instant', desc: 'Get paid immediately (1.5% fee)' },
  { id: 'daily', label: 'Daily', desc: 'Next business day' },
  { id: 'weekly', label: 'Weekly', desc: 'Every Monday' },
  { id: 'monthly', label: 'Monthly', desc: 'First of the month' },
]

export default function PaymentSettings() {
  const navigate = useNavigate()
  const [payoutSchedule, setPayoutSchedule] = useState('daily')

  // Mock data
  const balance = {
    available: 285.00,
    pending: 45.00,
  }

  const payoutHistory = [
    { id: 1, amount: 150.00, date: 'Dec 1, 2024', status: 'completed' },
    { id: 2, amount: 200.00, date: 'Nov 1, 2024', status: 'completed' },
    { id: 3, amount: 125.00, date: 'Oct 1, 2024', status: 'completed' },
  ]

  return (
    <div className="payment-settings-page">
      {/* Header */}
      <header className="payment-settings-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <span className="payment-settings-title">Payment Settings</span>
        <div className="header-spacer" />
      </header>

      <div className="payment-settings-content">
        {/* Balance Card */}
        <section className="balance-card">
          <div className="balance-row">
            <div className="balance-item">
              <span className="balance-label">Available</span>
              <span className="balance-value">${balance.available.toFixed(2)}</span>
            </div>
            <div className="balance-item">
              <span className="balance-label">Pending</span>
              <span className="balance-value pending">${balance.pending.toFixed(2)}</span>
            </div>
          </div>
          <Pressable className="cashout-btn">
            Cash Out
          </Pressable>
        </section>

        {/* Payout Method */}
        <section className="settings-section">
          <h3 className="section-title">Payout Method</h3>
          <div className="method-card">
            <Pressable className="method-row">
              <div className="method-icon">
                <Building2 size={20} />
              </div>
              <div className="method-info">
                <span className="method-name">Chase Bank</span>
                <span className="method-detail">••••4521 · Checking</span>
              </div>
              <div className="method-default">
                <Check size={16} />
              </div>
            </Pressable>
          </div>
          <Pressable className="add-method-btn">
            <Plus size={18} />
            <span>Add Payment Method</span>
          </Pressable>
        </section>

        {/* Payout Schedule */}
        <section className="settings-section">
          <h3 className="section-title">Payout Schedule</h3>
          <div className="schedule-card">
            {payoutSchedules.map((schedule) => (
              <Pressable
                key={schedule.id}
                className={`schedule-row ${payoutSchedule === schedule.id ? 'selected' : ''}`}
                onClick={() => setPayoutSchedule(schedule.id)}
              >
                <div className="schedule-info">
                  <span className="schedule-label">{schedule.label}</span>
                  <span className="schedule-desc">{schedule.desc}</span>
                </div>
                {payoutSchedule === schedule.id && (
                  <div className="schedule-check">
                    <Check size={16} />
                  </div>
                )}
              </Pressable>
            ))}
          </div>
        </section>

        {/* Payout History */}
        <section className="settings-section">
          <h3 className="section-title">Payout History</h3>
          <div className="history-card">
            {payoutHistory.map((payout) => (
              <Pressable key={payout.id} className="history-row">
                <div className="history-info">
                  <span className="history-amount">${payout.amount.toFixed(2)}</span>
                  <span className="history-date">{payout.date}</span>
                </div>
                <ChevronRight size={18} className="history-chevron" />
              </Pressable>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
