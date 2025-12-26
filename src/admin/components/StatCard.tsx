/**
 * StatCard - KPI stat display component
 */

import { Skeleton } from '../../components/Skeleton'

interface StatCardProps {
  label: string
  value: string | number
  subtext?: string
  variant?: 'default' | 'success' | 'warning' | 'error'
  loading?: boolean
}

export default function StatCard({
  label,
  value,
  subtext,
  variant = 'default',
  loading = false,
}: StatCardProps) {
  if (loading) {
    return (
      <div className="admin-stat-card">
        <div className="admin-stat-label">{label}</div>
        <Skeleton width="60%" height={32} style={{ marginTop: 4 }} />
        {subtext !== undefined && <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />}
      </div>
    )
  }

  return (
    <div className={`admin-stat-card ${variant !== 'default' ? variant : ''}`}>
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {subtext && <div className="admin-stat-subtext">{subtext}</div>}
    </div>
  )
}
