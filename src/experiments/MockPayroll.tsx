import { ArrowLeft, Calendar, ChevronRight, FileText } from 'lucide-react'
import { Pressable } from '../components'
import { formatCurrencyFromCents } from '../utils/currency'
import '../payroll/payroll.css'

const noop = () => {}

const formatPeriodRange = (start: string, end: string) => {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const sameMonth = startDate.getMonth() === endDate.getMonth()

  if (sameMonth) {
    return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.getDate()}, ${endDate.getFullYear()}`
  }
  return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default function MockPayroll() {
  const currencyCode = 'USD'

  const periods = [
    {
      id: 'p1',
      startDate: '2025-12-01T00:00:00.000Z',
      endDate: '2025-12-14T23:59:59.000Z',
      netAmount: 325_500,
      status: 'paid' as const,
    },
    {
      id: 'p2',
      startDate: '2025-11-15T00:00:00.000Z',
      endDate: '2025-11-30T23:59:59.000Z',
      netAmount: 210_000,
      status: 'paid' as const,
    },
    {
      id: 'p3',
      startDate: '2025-12-15T00:00:00.000Z',
      endDate: '2025-12-28T23:59:59.000Z',
      netAmount: 98_250,
      status: 'pending' as const,
    },
  ]

  const ytdTotalCents = periods.reduce((sum, p) => sum + p.netAmount, 0)

  const groupedPeriods = periods.reduce((groups, period) => {
    const date = new Date(period.startDate)
    const key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    groups[key] = groups[key] || []
    groups[key].push(period)
    return groups
  }, {} as Record<string, typeof periods>)

  return (
    <div className="payroll-page">
      <header className="payroll-header">
        <Pressable className="payroll-back-btn" onClick={noop}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="payroll-logo" />
        <div className="payroll-header-spacer" />
      </header>

      <div className="payroll-page-title">
        <h1>Payroll</h1>
      </div>

      <div className="payroll-content">
        <div className="payroll-ytd-card">
          <span className="payroll-ytd-label">Year to Date</span>
          <span className="payroll-ytd-amount">{formatCurrencyFromCents(ytdTotalCents, currencyCode)}</span>
        </div>

        {Object.entries(groupedPeriods).map(([month, monthPeriods]) => (
          <div key={month} className="payroll-section">
            <div className="payroll-section-header">
              <Calendar size={14} />
              <span>{month}</span>
            </div>

            <div className="payroll-period-list">
              {monthPeriods.map((period) => (
                <Pressable key={period.id} className="payroll-period-card" onClick={noop}>
                  <div className="payroll-period-info">
                    <span className="payroll-period-range">
                      {formatPeriodRange(period.startDate, period.endDate)}
                    </span>
                    <span className="payroll-period-status">
                      {period.status === 'paid' ? (
                        <span className="payroll-status-badge paid">Paid</span>
                      ) : period.status === 'pending' ? (
                        <span className="payroll-status-badge pending">Pending</span>
                      ) : (
                        <span className="payroll-status-badge current">Current</span>
                      )}
                    </span>
                  </div>
                  <div className="payroll-period-right">
                    <span className="payroll-period-amount">
                      {formatCurrencyFromCents(period.netAmount, currencyCode)}
                    </span>
                    <ChevronRight size={18} className="payroll-period-chevron" />
                  </div>
                </Pressable>
              ))}
            </div>
          </div>
        ))}

        <div className="payroll-empty" style={{ minHeight: 0, padding: '24px 0 0' }}>
          <div className="payroll-empty-icon">
            <FileText size={24} />
          </div>
          <h3 className="payroll-empty-title">Mock page for screenshots</h3>
          <p className="payroll-empty-desc">No API calls. Safe to capture.</p>
        </div>
      </div>
    </div>
  )
}

