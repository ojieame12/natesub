/**
 * Support - Admin ticket management
 *
 * View and manage support tickets submitted by users.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAuthToken } from '../../api/client'
import { adminQueryKeys } from '../../api/queryKeys'
import StatCard from '../components/StatCard'
import ActionModal from '../components/ActionModal'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const ADMIN_FETCH_TIMEOUT_MS = 20_000

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  // Only set Content-Type when there's a body (avoids CORS preflight on GETs)
  const hasBody = options.body !== undefined && options.body !== null
  if (hasBody) {
    headers['Content-Type'] = 'application/json'
  }

  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), ADMIN_FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers,
      signal: options.signal ?? controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out')
    }
    throw err
  } finally {
    window.clearTimeout(timeoutId)
  }

  const data = await response.json().catch(() => ({ error: 'Invalid response' }))
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelativeTime(date: string): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(date)
}

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
type TicketCategory = 'general' | 'billing' | 'technical' | 'account' | 'payout' | 'dispute'

interface Ticket {
  id: string
  email: string
  name: string | null
  userId: string | null
  category: TicketCategory
  subject: string
  status: TicketStatus
  priority: TicketPriority
  assignedTo: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

interface TicketDetail {
  id: string
  email: string
  name: string | null
  userId: string | null
  category: TicketCategory
  subject: string
  message: string
  status: TicketStatus
  priority: TicketPriority
  assignedTo: string | null
  adminNotes: string | null
  resolution: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  messages: Array<{
    id: string
    isAdmin: boolean
    senderName: string | null
    message: string
    createdAt: string
  }>
}

interface TicketStats {
  current: { open: number; inProgress: number; total: number }
  newLast24h: number
  resolvedLast7d: number
  byCategory: Array<{ category: string; count: number }>
  byPriority: Array<{ priority: string; count: number }>
}

const statusOptions = ['all', 'open', 'in_progress', 'resolved', 'closed'] as const
const priorityOptions = ['all', 'low', 'normal', 'high', 'urgent'] as const
const categoryOptions = ['all', 'general', 'billing', 'technical', 'account', 'payout', 'dispute'] as const

const statusLabels: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

const priorityLabels: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

const categoryLabels: Record<TicketCategory, string> = {
  general: 'General',
  billing: 'Billing',
  technical: 'Technical',
  account: 'Account',
  payout: 'Payout',
  dispute: 'Dispute',
}

export default function Support() {
  const [statusFilter, setStatusFilter] = useState<typeof statusOptions[number]>('all')
  const [priorityFilter, setPriorityFilter] = useState<typeof priorityOptions[number]>('all')
  const [categoryFilter, setCategoryFilter] = useState<typeof categoryOptions[number]>('all')
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [resolveModal, setResolveModal] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: adminQueryKeys.support.stats,
    queryFn: () => adminFetch<TicketStats>('/admin/support/tickets/stats'),
    staleTime: 30 * 1000,
  })

  // Tickets list
  const { data: ticketsData, isLoading: ticketsLoading } = useQuery({
    queryKey: adminQueryKeys.support.tickets({ status: statusFilter, priority: priorityFilter, category: categoryFilter }),
    queryFn: () => adminFetch<{ tickets: Ticket[]; pagination: any }>(`/admin/support/tickets?status=${statusFilter}&priority=${priorityFilter}&category=${categoryFilter}`),
    staleTime: 30 * 1000,
  })

  // Selected ticket detail
  const { data: ticketDetail } = useQuery({
    queryKey: adminQueryKeys.support.ticket(selectedTicket || ''),
    queryFn: () => adminFetch<{ ticket: TicketDetail }>(`/admin/support/tickets/${selectedTicket}`),
    enabled: !!selectedTicket,
    staleTime: 10 * 1000,
  })

  // Reply mutation
  const replyMutation = useMutation({
    mutationFn: ({ ticketId, message }: { ticketId: string; message: string }) =>
      adminFetch(`/admin/support/tickets/${ticketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.support.all })
      setReplyText('')
    },
  })

  // Update ticket mutation
  const updateMutation = useMutation({
    mutationFn: ({ ticketId, updates }: { ticketId: string; updates: Partial<TicketDetail> }) =>
      adminFetch(`/admin/support/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.support.all })
    },
  })

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: ({ ticketId, resolution }: { ticketId: string; resolution: string }) =>
      adminFetch(`/admin/support/tickets/${ticketId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution, sendReply: false }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.support.all })
      setResolveModal(null)
    },
  })

  const handleSendReply = () => {
    if (!selectedTicket || !replyText.trim()) return
    replyMutation.mutate({ ticketId: selectedTicket, message: replyText.trim() })
  }

  const handleStatusChange = (ticketId: string, status: TicketStatus) => {
    updateMutation.mutate({ ticketId, updates: { status } })
  }

  const handlePriorityChange = (ticketId: string, priority: TicketPriority) => {
    updateMutation.mutate({ ticketId, updates: { priority } })
  }

  return (
    <div>
      <h1 className="admin-page-title">Support Tickets</h1>

      {/* Stats */}
      <div className="admin-stats-grid">
        <StatCard
          label="Open Tickets"
          value={stats?.current.open?.toString() || '0'}
          variant={stats?.current.open ? 'warning' : 'success'}
          loading={statsLoading}
        />
        <StatCard
          label="In Progress"
          value={stats?.current.inProgress?.toString() || '0'}
          loading={statsLoading}
        />
        <StatCard
          label="New (24h)"
          value={stats?.newLast24h?.toString() || '0'}
          loading={statsLoading}
        />
        <StatCard
          label="Resolved (7d)"
          value={stats?.resolvedLast7d?.toString() || '0'}
          variant="success"
          loading={statsLoading}
        />
      </div>

      {/* Filters */}
      <div className="admin-filters" style={{ marginTop: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusOptions[number])}
          className="admin-select"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as typeof priorityOptions[number])}
          className="admin-select"
        >
          <option value="all">All Priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as typeof categoryOptions[number])}
          className="admin-select"
        >
          <option value="all">All Categories</option>
          {categoryOptions.slice(1).map((cat) => (
            <option key={cat} value={cat}>{categoryLabels[cat as TicketCategory]}</option>
          ))}
        </select>
      </div>

      {/* Tickets List & Detail */}
      <div style={{ display: 'flex', gap: '24px', marginTop: '24px' }}>
        {/* List */}
        <div style={{ flex: selectedTicket ? '0 0 400px' : '1' }}>
          {ticketsLoading ? (
            <div className="admin-skeleton-table"></div>
          ) : ticketsData?.tickets.length === 0 ? (
            <div className="admin-empty">
              <p>No tickets found</p>
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Category</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketsData?.tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      onClick={() => setSelectedTicket(ticket.id)}
                      style={{
                        cursor: 'pointer',
                        background: selectedTicket === ticket.id ? 'var(--neutral-100)' : undefined,
                      }}
                    >
                      <td>
                        <div style={{ fontWeight: 500 }}>{ticket.subject}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {ticket.email}
                        </div>
                      </td>
                      <td>
                        <span className={`admin-badge ${ticket.status === 'open' ? 'warning' : ticket.status === 'resolved' ? 'success' : ''}`}>
                          {statusLabels[ticket.status]}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-badge ${ticket.priority === 'urgent' ? 'error' : ticket.priority === 'high' ? 'warning' : ''}`}>
                          {priorityLabels[ticket.priority]}
                        </span>
                      </td>
                      <td>{categoryLabels[ticket.category]}</td>
                      <td>{formatRelativeTime(ticket.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedTicket && ticketDetail && (
          <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: '12px', padding: '20px', border: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>{ticketDetail.ticket.subject}</h2>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                  {ticketDetail.ticket.email} {ticketDetail.ticket.name && `(${ticketDetail.ticket.name})`}
                </p>
              </div>
              <button
                className="admin-btn admin-btn-secondary admin-btn-small"
                onClick={() => setSelectedTicket(null)}
              >
                Close
              </button>
            </div>

            {/* Status/Priority Controls */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <select
                value={ticketDetail.ticket.status}
                onChange={(e) => handleStatusChange(ticketDetail.ticket.id, e.target.value as TicketStatus)}
                className="admin-select"
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>

              <select
                value={ticketDetail.ticket.priority}
                onChange={(e) => handlePriorityChange(ticketDetail.ticket.id, e.target.value as TicketPriority)}
                className="admin-select"
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>

              {ticketDetail.ticket.status !== 'resolved' && ticketDetail.ticket.status !== 'closed' && (
                <button
                  className="admin-btn admin-btn-primary admin-btn-small"
                  onClick={() => setResolveModal(ticketDetail.ticket.id)}
                >
                  Resolve
                </button>
              )}
            </div>

            {/* Messages Thread */}
            <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '16px', padding: '12px', background: 'var(--bg-base)', borderRadius: '8px' }}>
              {ticketDetail.ticket.messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    marginBottom: '12px',
                    padding: '12px',
                    borderRadius: '8px',
                    background: msg.isAdmin ? 'var(--primary-50)' : 'var(--bg-card)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 500, fontSize: '14px' }}>
                      {msg.isAdmin ? 'Support' : msg.senderName || ticketDetail.ticket.email}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                      {formatDate(msg.createdAt)}
                    </span>
                  </div>
                  <p style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{msg.message}</p>
                </div>
              ))}
            </div>

            {/* Reply Box */}
            {ticketDetail.ticket.status !== 'closed' && (
              <div>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid var(--border-default)',
                    borderRadius: '8px',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || replyMutation.isPending}
                  >
                    {replyMutation.isPending ? 'Sending...' : 'Send Reply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resolve Modal */}
      {resolveModal && (
        <ActionModal
          title="Resolve Ticket"
          message="Add an internal resolution note (not visible to user)."
          inputLabel="Resolution"
          inputPlaceholder="How was this resolved?"
          inputRequired
          confirmLabel="Resolve"
          confirmVariant="primary"
          loading={resolveMutation.isPending}
          onConfirm={(resolution) => {
            if (resolution) {
              resolveMutation.mutate({ ticketId: resolveModal, resolution })
            }
          }}
          onCancel={() => setResolveModal(null)}
        />
      )}
    </div>
  )
}
