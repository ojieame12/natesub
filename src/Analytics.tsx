/**
 * Analytics - Creator page analytics dashboard
 *
 * Shows page views, conversion funnel, traffic sources, and device breakdown.
 * Data is already being collected via PageView model.
 */

import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Eye,
  Users,
  TrendingUp,
  Smartphone,
  Monitor,
  Tablet,
  Link2,
  ChevronRight,
  BarChart3,
} from 'lucide-react'
import { Pressable, Skeleton } from './components'
import { useAnalyticsStats } from './api/hooks'
import './Analytics.css'

// Format numbers with K/M suffixes
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

// Get device icon
function DeviceIcon({ type }: { type: string }) {
  switch (type) {
    case 'mobile': return <Smartphone size={16} />
    case 'tablet': return <Tablet size={16} />
    case 'desktop': return <Monitor size={16} />
    default: return <Monitor size={16} />
  }
}

// Simple bar chart component
function MiniBarChart({ data }: { data: { date: string; count: number }[] }) {
  if (!data.length) return null

  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <div className="analytics-chart">
      <div className="analytics-chart-bars">
        {data.map((d, i) => (
          <div key={i} className="analytics-chart-bar-container">
            <div
              className="analytics-chart-bar"
              style={{ height: `${(d.count / maxCount) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="analytics-chart-labels">
        <span>{data[0]?.date ? new Date(data[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        <span>{data[data.length - 1]?.date ? new Date(data[data.length - 1].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
      </div>
    </div>
  )
}

// Conversion funnel component
function ConversionFunnel({ funnel, rates }: {
  funnel: { views: number; reachedPayment: number; startedCheckout: number; conversions: number }
  rates: { viewToPayment: number; paymentToCheckout: number; checkoutToSubscribe: number; overall: number }
}) {
  const steps = [
    { label: 'Page Views', value: funnel.views, rate: null },
    { label: 'Saw Pricing', value: funnel.reachedPayment, rate: rates.viewToPayment },
    { label: 'Started Checkout', value: funnel.startedCheckout, rate: rates.paymentToCheckout },
    { label: 'Subscribed', value: funnel.conversions, rate: rates.checkoutToSubscribe },
  ]

  const maxValue = Math.max(funnel.views, 1)

  return (
    <div className="analytics-funnel">
      {steps.map((step, i) => (
        <div key={step.label} className="analytics-funnel-step">
          <div className="analytics-funnel-bar-container">
            <div
              className="analytics-funnel-bar"
              style={{ width: `${(step.value / maxValue) * 100}%` }}
            />
          </div>
          <div className="analytics-funnel-info">
            <span className="analytics-funnel-label">{step.label}</span>
            <span className="analytics-funnel-value">{formatNumber(step.value)}</span>
            {step.rate !== null && (
              <span className="analytics-funnel-rate">{step.rate}%</span>
            )}
          </div>
          {i < steps.length - 1 && (
            <ChevronRight size={14} className="analytics-funnel-arrow" />
          )}
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useAnalyticsStats()

  return (
    <div className="analytics-page">
      {/* Header */}
      <header className="analytics-header glass-header">
        <Pressable className="analytics-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <h1 className="analytics-title">Analytics</h1>
        <div style={{ width: 40 }} />
      </header>

      <main className="analytics-content">
        {isError ? (
          <div className="analytics-error">
            <p>Failed to load analytics</p>
            <Pressable className="analytics-retry-btn" onClick={() => window.location.reload()}>
              Try Again
            </Pressable>
          </div>
        ) : isLoading ? (
          <>
            <div className="analytics-stats-grid">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="analytics-stat-card">
                  <Skeleton width={60} height={12} />
                  <Skeleton width={80} height={32} style={{ marginTop: 8 }} />
                </div>
              ))}
            </div>
            <div className="analytics-section">
              <Skeleton width={120} height={20} />
              <Skeleton width="100%" height={200} style={{ marginTop: 16 }} />
            </div>
          </>
        ) : data ? (
          <>
            {/* Overview Stats */}
            <div className="analytics-stats-grid">
              <div className="analytics-stat-card">
                <div className="analytics-stat-icon">
                  <Eye size={18} />
                </div>
                <div className="analytics-stat-info">
                  <span className="analytics-stat-label">Today</span>
                  <span className="analytics-stat-value">{formatNumber(data.views.today)}</span>
                  <span className="analytics-stat-sub">{data.uniqueVisitors.today} unique</span>
                </div>
              </div>

              <div className="analytics-stat-card">
                <div className="analytics-stat-icon">
                  <Eye size={18} />
                </div>
                <div className="analytics-stat-info">
                  <span className="analytics-stat-label">This Week</span>
                  <span className="analytics-stat-value">{formatNumber(data.views.week)}</span>
                  <span className="analytics-stat-sub">{data.uniqueVisitors.week} unique</span>
                </div>
              </div>

              <div className="analytics-stat-card">
                <div className="analytics-stat-icon">
                  <Eye size={18} />
                </div>
                <div className="analytics-stat-info">
                  <span className="analytics-stat-label">This Month</span>
                  <span className="analytics-stat-value">{formatNumber(data.views.month)}</span>
                  <span className="analytics-stat-sub">{data.uniqueVisitors.month} unique</span>
                </div>
              </div>

              <div className="analytics-stat-card highlight">
                <div className="analytics-stat-icon">
                  <TrendingUp size={18} />
                </div>
                <div className="analytics-stat-info">
                  <span className="analytics-stat-label">Conversion</span>
                  <span className="analytics-stat-value">{data.rates.overall}%</span>
                  <span className="analytics-stat-sub">view → subscriber</span>
                </div>
              </div>
            </div>

            {/* Daily Views Chart */}
            <div className="analytics-section">
              <div className="analytics-section-header">
                <BarChart3 size={18} />
                <h2>Daily Views (Last 14 Days)</h2>
              </div>
              <div className="analytics-card">
                {data.dailyViews.length > 0 ? (
                  <MiniBarChart data={data.dailyViews} />
                ) : (
                  <div className="analytics-empty">
                    <p>No view data yet</p>
                    <span>Share your page to start tracking</span>
                  </div>
                )}
              </div>
            </div>

            {/* Conversion Funnel */}
            <div className="analytics-section">
              <div className="analytics-section-header">
                <TrendingUp size={18} />
                <h2>Conversion Funnel (30 Days)</h2>
              </div>
              <div className="analytics-card">
                <ConversionFunnel funnel={data.funnel} rates={data.rates} />
              </div>
            </div>

            {/* Device Breakdown */}
            <div className="analytics-section">
              <div className="analytics-section-header">
                <Smartphone size={18} />
                <h2>Devices</h2>
              </div>
              <div className="analytics-card">
                {data.devices.length > 0 ? (
                  <div className="analytics-devices">
                    {data.devices.map((device) => {
                      const total = data.devices.reduce((sum, d) => sum + d.count, 0)
                      const percent = total > 0 ? Math.round((device.count / total) * 100) : 0
                      return (
                        <div key={device.type} className="analytics-device-row">
                          <div className="analytics-device-info">
                            <DeviceIcon type={device.type} />
                            <span className="analytics-device-name">
                              {device.type.charAt(0).toUpperCase() + device.type.slice(1)}
                            </span>
                          </div>
                          <div className="analytics-device-bar-container">
                            <div
                              className="analytics-device-bar"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="analytics-device-percent">{percent}%</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="analytics-empty">
                    <p>No device data yet</p>
                  </div>
                )}
              </div>
            </div>

            {/* Top Referrers */}
            <div className="analytics-section">
              <div className="analytics-section-header">
                <Link2 size={18} />
                <h2>Top Traffic Sources</h2>
              </div>
              <div className="analytics-card">
                {data.referrers.length > 0 ? (
                  <div className="analytics-referrers">
                    {data.referrers.map((ref, i) => {
                      const total = data.referrers.reduce((sum, r) => sum + r.count, 0)
                      const percent = total > 0 ? Math.round((ref.count / total) * 100) : 0
                      // Extract domain from URL
                      let source = ref.source
                      try {
                        const url = new URL(ref.source)
                        source = url.hostname.replace('www.', '')
                      } catch {
                        // Keep original if not a valid URL
                      }
                      return (
                        <div key={i} className="analytics-referrer-row">
                          <span className="analytics-referrer-rank">{i + 1}</span>
                          <span className="analytics-referrer-source">{source}</span>
                          <span className="analytics-referrer-count">{ref.count}</span>
                          <span className="analytics-referrer-percent">{percent}%</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="analytics-empty">
                    <p>No referrer data yet</p>
                    <span>Traffic from direct links or social media will appear here</span>
                  </div>
                )}
              </div>
            </div>

            {/* Total Stats Footer */}
            <div className="analytics-footer">
              <div className="analytics-footer-stat">
                <Users size={16} />
                <span>{formatNumber(data.views.total)} total views</span>
              </div>
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}
