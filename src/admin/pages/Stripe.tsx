/**
 * Stripe - Full Stripe Connect visibility and management
 */

import { useState } from 'react'
import {
  useAdminStripeAccounts,
  useAdminStripeBalance,
  useAdminStripeTransfers,
  useAdminStripeEvents,
  useAdminStripeAccountDetail,
  useAdminStripeDisablePayouts,
  useAdminStripeEnablePayouts,
  useAdminStripePayout,
} from '../api'
import type { StripeAccount } from '../api'
import { formatCurrency, formatDate } from '../utils/format'
import StatCard from '../components/StatCard'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ActionModal from '../components/ActionModal'

function formatBalanceSummary(balances: Array<{ amount: number; currency: string }> | undefined): string {
  if (!balances?.length) return '—'
  if (balances.length === 1) return formatCurrency(balances[0].amount, balances[0].currency)
  return balances
    .slice()
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((b) => `${b.currency.toUpperCase()} ${formatCurrency(b.amount, b.currency)}`)
    .join(' · ')
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'active': return 'success'
    case 'pending': return 'warning'
    case 'restricted': return 'error'
    case 'disabled': return 'error'
    default: return 'neutral'
  }
}

function getPayoutStatusBadge(enabled: boolean): string {
  return enabled ? 'success' : 'error'
}

// Map Stripe requirement codes to human-readable explanations
function explainRequirement(req: string): { title: string; description: string; action: string } {
  const reqMap: Record<string, { title: string; description: string; action: string }> = {
    'individual.id_number': {
      title: 'ID Number Required',
      description: 'National ID or SSN is needed for tax reporting',
      action: 'Creator must enter their ID in Stripe onboarding',
    },
    'individual.verification.document': {
      title: 'ID Document Upload',
      description: 'A photo of government ID is needed to verify identity',
      action: 'Creator must upload passport, driver license, or national ID',
    },
    'individual.verification.additional_document': {
      title: 'Additional Document',
      description: 'Secondary document required (e.g., utility bill for address)',
      action: 'Creator must upload proof of address',
    },
    'individual.address.city': {
      title: 'City Missing',
      description: 'City is required in the address',
      action: 'Creator must update their address',
    },
    'individual.address.line1': {
      title: 'Street Address Missing',
      description: 'Street address line 1 is required',
      action: 'Creator must update their address',
    },
    'individual.address.postal_code': {
      title: 'Postal Code Missing',
      description: 'Postal/ZIP code is required',
      action: 'Creator must update their address',
    },
    'individual.dob.day': {
      title: 'Birth Date Missing',
      description: 'Complete date of birth is required',
      action: 'Creator must provide full date of birth',
    },
    'individual.dob.month': {
      title: 'Birth Month Missing',
      description: 'Complete date of birth is required',
      action: 'Creator must provide full date of birth',
    },
    'individual.dob.year': {
      title: 'Birth Year Missing',
      description: 'Complete date of birth is required',
      action: 'Creator must provide full date of birth',
    },
    'individual.phone': {
      title: 'Phone Number Missing',
      description: 'Phone number is required for verification',
      action: 'Creator must add a phone number',
    },
    'individual.email': {
      title: 'Email Missing',
      description: 'Email address is required',
      action: 'Creator must add an email address',
    },
    'external_account': {
      title: 'Bank Account Missing',
      description: 'No bank account is linked for payouts',
      action: 'Creator must add a bank account in Stripe',
    },
    'tos_acceptance': {
      title: 'Terms of Service',
      description: 'Stripe Terms of Service must be accepted',
      action: 'Creator must complete Stripe onboarding',
    },
    'business_profile.url': {
      title: 'Website/Profile URL',
      description: 'A business profile URL is required',
      action: 'Usually auto-filled - contact support if stuck',
    },
    'business_profile.mcc': {
      title: 'Business Category',
      description: 'Business category code is missing',
      action: 'Usually auto-filled - contact support if stuck',
    },
  }

  const info = reqMap[req]
  if (info) return info

  // Handle patterns like 'individual.verification.document.front'
  if (req.includes('verification.document')) {
    return {
      title: 'Document Upload Required',
      description: 'ID document verification needed',
      action: 'Creator must upload ID in Stripe dashboard',
    }
  }

  // Default for unknown requirements
  return {
    title: req.replace(/_/g, ' ').replace(/\./g, ' → '),
    description: 'Additional information required by Stripe',
    action: 'Creator should check their Stripe dashboard',
  }
}

type TabType = 'accounts' | 'transfers' | 'events' | 'balance'

export default function Stripe() {
  const [activeTab, setActiveTab] = useState<TabType>('accounts')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 25

  // Selected account for detail view
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  // Modals
  const [disablePayoutsModal, setDisablePayoutsModal] = useState<StripeAccount | null>(null)
  const [enablePayoutsModal, setEnablePayoutsModal] = useState<StripeAccount | null>(null)
  const [triggerPayoutModal, setTriggerPayoutModal] = useState<StripeAccount | null>(null)

  // Queries
  const { data: accountsData, isLoading: accountsLoading, refetch: refetchAccounts } = useAdminStripeAccounts({
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  }, { enabled: activeTab === 'accounts' })

  const { data: balanceData, isLoading: balanceLoading } = useAdminStripeBalance({ enabled: activeTab === 'balance' })
  const { data: transfersData, isLoading: transfersLoading } = useAdminStripeTransfers({ limit: 50 }, { enabled: activeTab === 'transfers' })
  const { data: eventsData, isLoading: eventsLoading } = useAdminStripeEvents({ limit: 50 }, { enabled: activeTab === 'events' })
  const { data: accountDetail, isLoading: detailLoading } = useAdminStripeAccountDetail(selectedAccountId || '')

  // Mutations
  const disablePayoutsMutation = useAdminStripeDisablePayouts()
  const enablePayoutsMutation = useAdminStripeEnablePayouts()
  const triggerPayoutMutation = useAdminStripePayout()

  const handleDisablePayouts = async (reason?: string) => {
    if (!disablePayoutsModal?.stripeAccountId || !reason) return
    try {
      await disablePayoutsMutation.mutateAsync({
        accountId: disablePayoutsModal.stripeAccountId,
        reason,
      })
      setDisablePayoutsModal(null)
      refetchAccounts()
    } catch (err) {
      console.error('Failed to disable payouts:', err)
    }
  }

  const handleEnablePayouts = async () => {
    if (!enablePayoutsModal?.stripeAccountId) return
    try {
      await enablePayoutsMutation.mutateAsync(enablePayoutsModal.stripeAccountId)
      setEnablePayoutsModal(null)
      refetchAccounts()
    } catch (err) {
      console.error('Failed to enable payouts:', err)
    }
  }

  const handleTriggerPayout = async () => {
    if (!triggerPayoutModal?.stripeAccountId) return
    try {
      await triggerPayoutMutation.mutateAsync({
        accountId: triggerPayoutModal.stripeAccountId,
      })
      setTriggerPayoutModal(null)
      refetchAccounts()
    } catch (err) {
      console.error('Failed to trigger payout:', err)
    }
  }

  const clearFilters = () => {
    setStatus('all')
    setPage(1)
  }

  const balanceRows = (() => {
    if (!balanceData) return []
    const rows = new Map<string, { currency: string; available: number; pending: number }>()

    for (const b of balanceData.available || []) {
      rows.set(b.currency, { currency: b.currency, available: b.amount, pending: 0 })
    }
    for (const b of balanceData.pending || []) {
      const existing = rows.get(b.currency) || { currency: b.currency, available: 0, pending: 0 }
      existing.pending = b.amount
      rows.set(b.currency, existing)
    }

    return Array.from(rows.values()).sort((a, b) => a.currency.localeCompare(b.currency))
  })()

  return (
    <div>
      <h1 className="admin-page-title">Stripe</h1>

      {/* Tab Navigation */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          Connected Accounts
        </button>
        <button
          className={`admin-tab ${activeTab === 'balance' ? 'active' : ''}`}
          onClick={() => setActiveTab('balance')}
        >
          Platform Balance
        </button>
        <button
          className={`admin-tab ${activeTab === 'transfers' ? 'active' : ''}`}
          onClick={() => setActiveTab('transfers')}
        >
          Transfers
        </button>
        <button
          className={`admin-tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          Webhook Events
        </button>
      </div>

      {/* Balance Tab */}
      {activeTab === 'balance' && (
        <div>
          <div className="admin-stats-grid">
            <StatCard
              label="Available Balance"
              value={formatBalanceSummary(balanceData?.available)}
              loading={balanceLoading}
            />
            <StatCard
              label="Pending Balance"
              value={formatBalanceSummary(balanceData?.pending)}
              loading={balanceLoading}
            />
            <StatCard
              label="Connect Reserved"
              value={formatBalanceSummary(balanceData?.connectReserved)}
              loading={balanceLoading}
            />
          </div>

          {balanceData && (
            <div className="admin-table-container" style={{ marginTop: '24px' }}>
              <h3 style={{ marginBottom: '16px' }}>Balance by Currency</h3>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Available</th>
                    <th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map((row) => (
                    <tr key={row.currency}>
                      <td style={{ textTransform: 'uppercase' }}>{row.currency}</td>
                      <td>{formatCurrency(row.available, row.currency)}</td>
                      <td>{formatCurrency(row.pending, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Accounts Tab */}
      {activeTab === 'accounts' && (
        <div>
          <FilterBar
            searchValue=""
            onSearchChange={() => {}}
            searchPlaceholder=""
            filters={[
              {
                name: 'status',
                value: status,
                options: [
                  { value: 'all', label: 'All Status' },
                  { value: 'active', label: 'Active' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'restricted', label: 'Restricted' },
                  { value: 'disabled', label: 'Disabled' },
                ],
                onChange: (v) => { setStatus(v); setPage(1) },
              },
            ]}
            onClear={clearFilters}
          />

          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th>Email</th>
                  <th>Country</th>
                  <th>Local Status</th>
                  <th>Stripe Status</th>
                  <th>Payouts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accountsLoading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
                ) : accountsData?.accounts?.length ? (
                  accountsData.accounts.map((account) => (
                    <tr key={account.userId}>
                      <td>
                        <button
                          className="admin-link"
                          onClick={() => setSelectedAccountId(account.stripeAccountId)}
                        >
                          {account.displayName || account.username}
                        </button>
                      </td>
                      <td>{account.email}</td>
                      <td>{account.country || '-'}</td>
                      <td>
                        <span className={`admin-badge ${getStatusBadge(account.localPayoutStatus)}`}>
                          {account.localPayoutStatus}
                        </span>
                      </td>
                      <td>
                        {account.stripeStatus ? (
                          <span className={`admin-badge ${account.stripeStatus.detailsSubmitted ? 'success' : 'warning'}`}>
                            {account.stripeStatus.detailsSubmitted ? 'Complete' : 'Incomplete'}
                          </span>
                        ) : (
                          <span className="admin-badge error">Error</span>
                        )}
                      </td>
                      <td>
                        {account.stripeStatus && (
                          <span className={`admin-badge ${getPayoutStatusBadge(account.stripeStatus.payoutsEnabled)}`}>
                            {account.stripeStatus.payoutsEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {account.localPayoutStatus === 'active' && (
                            <button
                              className="admin-btn admin-btn-danger admin-btn-small"
                              onClick={() => setDisablePayoutsModal(account)}
                            >
                              Disable
                            </button>
                          )}
                          {account.localPayoutStatus === 'disabled' && (
                            <button
                              className="admin-btn admin-btn-primary admin-btn-small"
                              onClick={() => setEnablePayoutsModal(account)}
                            >
                              Enable
                            </button>
                          )}
                          {account.stripeStatus?.payoutsEnabled && (
                            <button
                              className="admin-btn admin-btn-secondary admin-btn-small"
                              onClick={() => setTriggerPayoutModal(account)}
                            >
                              Payout
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>No accounts found</td></tr>
                )}
              </tbody>
            </table>

            {accountsData && accountsData.totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={accountsData.totalPages}
                total={accountsData.total}
                limit={limit}
                onPageChange={setPage}
              />
            )}
          </div>
        </div>
      )}

      {/* Transfers Tab */}
      {activeTab === 'transfers' && (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Creator</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Reversed</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {transfersLoading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
              ) : transfersData?.transfers?.length ? (
                transfersData.transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {transfer.id.slice(0, 20)}...
                    </td>
                    <td>
                      {transfer.creator ? (
                        `${transfer.creator.displayName || transfer.creator.username}`
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>Unknown</span>
                      )}
                    </td>
                    <td>{formatCurrency(transfer.amount, transfer.currency)}</td>
                    <td style={{ textTransform: 'uppercase' }}>{transfer.currency}</td>
                    <td>
                      <span className={`admin-badge ${transfer.reversed ? 'error' : 'success'}`}>
                        {transfer.reversed ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>{formatDate(transfer.created)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>No transfers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Object</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Live</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {eventsLoading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
              ) : eventsData?.events?.length ? (
                eventsData.events.map((event) => (
                  <tr key={event.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {event.type}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {event.data.objectType}: {event.data.objectId?.slice(0, 12)}...
                    </td>
                    <td>
                      {event.data.amount !== undefined
                        ? formatCurrency(event.data.amount, event.data.currency || 'usd')
                        : '-'}
                    </td>
                    <td>
                      {event.data.status ? (
                        <span className={`admin-badge ${event.data.status === 'succeeded' ? 'success' : event.data.status === 'failed' ? 'error' : 'neutral'}`}>
                          {event.data.status}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      <span className={`admin-badge ${event.livemode ? 'success' : 'warning'}`}>
                        {event.livemode ? 'Live' : 'Test'}
                      </span>
                    </td>
                    <td>{formatDate(event.created)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>No events found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Account Detail Sidebar */}
      {selectedAccountId && (
        <div className="admin-sidebar-overlay" onClick={() => setSelectedAccountId(null)}>
          <div className="admin-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="admin-sidebar-header">
              <h2>Account Details</h2>
              <button className="admin-sidebar-close" onClick={() => setSelectedAccountId(null)}>
                &times;
              </button>
            </div>
            <div className="admin-sidebar-content">
              {detailLoading ? (
                <p>Loading...</p>
              ) : accountDetail ? (
                <div>
                  {/* Stripe Error Banner */}
                  {accountDetail.stripeError && (
                    <div className="admin-detail-section" style={{
                      background: 'var(--color-error-bg, #fef2f2)',
                      border: '1px solid var(--color-error, #ef4444)',
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '20px'
                    }}>
                      <strong style={{ color: 'var(--color-error, #ef4444)' }}>Stripe API Error:</strong>
                      <p style={{ margin: '4px 0 0 0', fontSize: '14px' }}>{accountDetail.stripeError}</p>
                      <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        This Stripe account may have been deleted or there's an API issue.
                      </p>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="admin-detail-section" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
                    <h3>Quick Actions</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                      {accountDetail.local?.payoutStatus === 'active' ? (
                        <button
                          className="admin-btn admin-btn-danger"
                          onClick={() => {
                            const account = accountsData?.accounts?.find(a => a.stripeAccountId === selectedAccountId)
                            if (account) setDisablePayoutsModal(account)
                          }}
                        >
                          Disable Payouts
                        </button>
                      ) : (
                        <button
                          className="admin-btn admin-btn-primary"
                          onClick={() => {
                            const account = accountsData?.accounts?.find(a => a.stripeAccountId === selectedAccountId)
                            if (account) setEnablePayoutsModal(account)
                          }}
                        >
                          Enable Payouts
                        </button>
                      )}

                      {accountDetail.stripe?.payoutsEnabled && (
                        <button
                          className="admin-btn admin-btn-secondary"
                          onClick={() => {
                            const account = accountsData?.accounts?.find(a => a.stripeAccountId === selectedAccountId)
                            if (account) setTriggerPayoutModal(account)
                          }}
                        >
                          Trigger Immediate Payout
                        </button>
                      )}

                      {accountDetail.stripe && (
                        <a
                          href={`https://dashboard.stripe.com/connect/accounts/${accountDetail.stripe.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="admin-btn admin-btn-secondary"
                          style={{ textAlign: 'center', textDecoration: 'none' }}
                        >
                          View on Stripe Dashboard
                        </a>
                      )}

                      {accountDetail.local && (
                        <a
                          href={`/admin/users?search=${encodeURIComponent(accountDetail.local.email)}`}
                          className="admin-btn admin-btn-secondary"
                          style={{ textAlign: 'center', textDecoration: 'none' }}
                        >
                          View Full User Profile
                        </a>
                      )}
                    </div>
                  </div>

                  {accountDetail.local && (
                    <div className="admin-detail-section">
                      <h3>Creator Info</h3>
                      <dl className="admin-detail-list">
                        <dt>Email</dt>
                        <dd>{accountDetail.local.email}</dd>
                        <dt>Username</dt>
                        <dd>@{accountDetail.local.username}</dd>
                        <dt>Display Name</dt>
                        <dd>{accountDetail.local.displayName}</dd>
                        <dt>Country</dt>
                        <dd>{accountDetail.local.country || '-'}</dd>
                        <dt>Currency</dt>
                        <dd style={{ textTransform: 'uppercase' }}>{accountDetail.local.currency || '-'}</dd>
                        <dt>Payout Status</dt>
                        <dd>
                          <span className={`admin-badge ${getStatusBadge(accountDetail.local.payoutStatus)}`}>
                            {accountDetail.local.payoutStatus}
                          </span>
                        </dd>
                      </dl>
                    </div>
                  )}

                  {accountDetail.stripe && (
                    <div className="admin-detail-section">
                      <h3>Stripe Account</h3>
                      <dl className="admin-detail-list">
                        <dt>Account ID</dt>
                        <dd style={{ fontFamily: 'monospace', fontSize: '12px' }}>{accountDetail.stripe.id}</dd>
                        <dt>Type</dt>
                        <dd>{accountDetail.stripe.type}</dd>
                        <dt>Country</dt>
                        <dd>{accountDetail.stripe.country}</dd>
                        <dt>Currency</dt>
                        <dd style={{ textTransform: 'uppercase' }}>{accountDetail.stripe.defaultCurrency}</dd>
                        <dt>Charges Enabled</dt>
                        <dd>
                          <span className={`admin-badge ${accountDetail.stripe.chargesEnabled ? 'success' : 'error'}`}>
                            {accountDetail.stripe.chargesEnabled ? 'Yes' : 'No'}
                          </span>
                        </dd>
                        <dt>Payouts Enabled</dt>
                        <dd>
                          <span className={`admin-badge ${accountDetail.stripe.payoutsEnabled ? 'success' : 'error'}`}>
                            {accountDetail.stripe.payoutsEnabled ? 'Yes' : 'No'}
                          </span>
                        </dd>
                        <dt>Details Submitted</dt>
                        <dd>
                          <span className={`admin-badge ${accountDetail.stripe.detailsSubmitted ? 'success' : 'warning'}`}>
                            {accountDetail.stripe.detailsSubmitted ? 'Yes' : 'No'}
                          </span>
                        </dd>
                        <dt>Created</dt>
                        <dd>{accountDetail.stripe.created ? formatDate(accountDetail.stripe.created) : '-'}</dd>
                      </dl>
                    </div>
                  )}

                  <div className="admin-detail-section">
                    <h3>Balance</h3>
                    <dl className="admin-detail-list">
                      <dt>Available</dt>
                      <dd>
                        {accountDetail.balance.available.map(b => (
                          <div key={b.currency}>{formatCurrency(b.amount, b.currency)}</div>
                        ))}
                        {accountDetail.balance.available.length === 0 && '-'}
                      </dd>
                      <dt>Pending</dt>
                      <dd>
                        {accountDetail.balance.pending.map(b => (
                          <div key={b.currency}>{formatCurrency(b.amount, b.currency)}</div>
                        ))}
                        {accountDetail.balance.pending.length === 0 && '-'}
                      </dd>
                    </dl>
                  </div>

                  {accountDetail.recentPayouts.length > 0 && (
                    <div className="admin-detail-section">
                      <h3>Recent Payouts</h3>
                      <table className="admin-table admin-table-compact">
                        <thead>
                          <tr>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Arrival</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accountDetail.recentPayouts.map(p => (
                            <tr key={p.id}>
                              <td>{formatCurrency(p.amount, p.currency)}</td>
                              <td>
                                <span className={`admin-badge ${p.status === 'paid' ? 'success' : p.status === 'failed' ? 'error' : 'warning'}`}>
                                  {p.status}
                                </span>
                              </td>
                              <td>{formatDate(p.arrivalDate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {accountDetail.stripe?.requirements?.currently_due?.length > 0 && (
                    <div className="admin-detail-section">
                      <h3 style={{ color: 'var(--error)' }}>Requirements (Action Needed)</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                        {accountDetail.stripe!.requirements.currently_due.map((req: string) => {
                          const { title, description, action } = explainRequirement(req)
                          return (
                            <div key={req} style={{
                              background: 'rgba(239, 68, 68, 0.05)',
                              border: '1px solid rgba(239, 68, 68, 0.2)',
                              borderRadius: '8px',
                              padding: '12px',
                            }}>
                              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>{title}</div>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{description}</div>
                              <div style={{ fontSize: '12px', color: 'var(--accent-primary)' }}>→ {action}</div>
                            </div>
                          )
                        })}
                      </div>
                      <button
                        className="admin-btn admin-btn-secondary"
                        style={{ marginTop: '12px', width: '100%' }}
                        onClick={() => window.open(`https://dashboard.stripe.com/connect/accounts/${accountDetail.stripe!.id}`, '_blank')}
                      >
                        Open in Stripe Dashboard →
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p>Account not found</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Disable Payouts Modal */}
      {disablePayoutsModal && (
        <ActionModal
          title="Disable Payouts"
          message={`Disable payouts for ${disablePayoutsModal.displayName || disablePayoutsModal.email}? This will prevent any funds from being transferred to their bank account.`}
          confirmLabel="Disable Payouts"
          confirmVariant="danger"
          inputLabel="Reason"
          inputPlaceholder="Enter reason for disabling payouts..."
          inputRequired
          loading={disablePayoutsMutation.isPending}
          onConfirm={handleDisablePayouts}
          onCancel={() => setDisablePayoutsModal(null)}
        />
      )}

      {/* Enable Payouts Modal */}
      {enablePayoutsModal && (
        <ActionModal
          title="Enable Payouts"
          message={`Re-enable payouts for ${enablePayoutsModal.displayName || enablePayoutsModal.email}? This will allow funds to be transferred to their bank account again.`}
          confirmLabel="Enable Payouts"
          confirmVariant="primary"
          loading={enablePayoutsMutation.isPending}
          onConfirm={handleEnablePayouts}
          onCancel={() => setEnablePayoutsModal(null)}
        />
      )}

      {/* Trigger Payout Modal */}
      {triggerPayoutModal && (
        <ActionModal
          title="Trigger Immediate Payout"
          message={`Trigger an immediate payout of all available funds to ${triggerPayoutModal.displayName || triggerPayoutModal.email}?`}
          confirmLabel="Trigger Payout"
          confirmVariant="primary"
          loading={triggerPayoutMutation.isPending}
          onConfirm={handleTriggerPayout}
          onCancel={() => setTriggerPayoutModal(null)}
        />
      )}
    </div>
  )
}
