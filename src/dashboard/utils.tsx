/**
 * Dashboard utility functions
 */

import { type ReactElement } from 'react'
import {
  UserPlus,
  DollarSign,
  RefreshCw,
  UserX,
  Send,
  Check,
  Clock,
} from 'lucide-react'

// Activity icon helper
export function getActivityIcon(type: string): ReactElement {
  const size = 18
  switch (type) {
    case 'subscription_created':
    case 'new_subscriber': return <UserPlus size={size} />
    case 'payment_received':
    case 'payment': return <DollarSign size={size} />
    case 'renewal': return <RefreshCw size={size} />
    case 'subscription_canceled':
    case 'subscription_canceled_via_manage_page':
    case 'subscription_canceled_via_email':
    case 'cancelled': return <UserX size={size} />
    case 'request_sent': return <Send size={size} />
    case 'request_accepted': return <Check size={size} />
    case 'payout_initiated': return <Clock size={size} />
    case 'payout_completed': return <Check size={size} />
    case 'payout_failed': return <UserX size={size} />
    default: return <DollarSign size={size} />
  }
}

export function getActivityTitle(type: string): string {
  switch (type) {
    case 'subscription_created':
    case 'new_subscriber': return 'New Subscriber'
    case 'payment_received':
    case 'payment': return 'Payment Received'
    case 'renewal': return 'Renewed'
    case 'subscription_canceled':
    case 'subscription_canceled_via_manage_page':
    case 'subscription_canceled_via_email':
    case 'cancelled': return 'Cancelled'
    case 'request_sent': return 'Request Sent'
    case 'request_accepted': return 'Request Accepted'
    case 'payout_initiated': return 'Payout Initiated'
    case 'payout_completed': return 'Payout Received'
    case 'payout_failed': return 'Payout Failed'
    default: return 'Activity'
  }
}

// Format relative time
export function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString()
}
