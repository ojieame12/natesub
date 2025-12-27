// React Query Hooks for Nate API

import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  keepPreviousData,
} from '@tanstack/react-query'
import { api, type ApiError } from './client'
import { useAuthState } from '../hooks/useAuthState'
import { queryKeys } from './queryKeys'

// ============================================
// ERROR HANDLING UTILITIES
// ============================================

/**
 * Extract user-friendly error message from API error
 */
export function getErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred'

  // Handle our API errors
  if (typeof error === 'object' && error !== null && 'error' in error) {
    return (error as ApiError).error
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return error.message
  }

  // Handle string errors
  if (typeof error === 'string') {
    return error
  }

  return 'An unexpected error occurred'
}

/**
 * Common error messages for specific status codes
 */
export function getStatusMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input.'
    case 401:
      return 'Please sign in to continue.'
    case 403:
      return 'You don\'t have permission to do this.'
    case 404:
      return 'The requested resource was not found.'
    case 429:
      return 'Too many requests. Please try again later.'
    case 500:
      return 'Server error. Please try again later.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

// ============================================
// AUTH HOOKS
// ============================================

/**
 * useCurrentUser - Delegates to useAuthState for single source of truth
 *
 * This ensures consistent behavior regardless of which hook mounts first.
 * The query options are defined in useAuthState, not here.
 */
export function useCurrentUser() {
  const { user, status, error, refetch } = useAuthState()

  return {
    data: status === 'authenticated' && user ? {
      id: user.id,
      email: user.email,
      profile: user.profile,
      createdAt: user.createdAt,
    } : undefined,
    isLoading: status === 'unknown' || status === 'checking',
    isError: !!error,
    error,
    refetch,
    status,
  }
}

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: api.auth.requestMagicLink,
    retry: false, // Don't retry auth - causes rate limit issues
  })
}

export function useVerifyMagicLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ otp, email }: { otp: string; email: string }) => api.auth.verify(otp, email),
    retry: false, // Don't retry auth - causes rate limit issues
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser })
    },
  })
}

export function useSaveOnboardingProgress() {
  return useMutation({
    mutationFn: api.auth.saveOnboardingProgress,
  })
}

export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      // Clear in-memory cache
      queryClient.clear()
      // Clear persisted cache to prevent cross-user data leakage
      import('./provider').then(({ clearPersistedCache }) => clearPersistedCache())
    },
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.auth.deleteAccount,
    onSuccess: () => {
      // Clear in-memory cache
      queryClient.clear()
      // Clear persisted cache to prevent cross-user data leakage
      import('./provider').then(({ clearPersistedCache }) => clearPersistedCache())
    },
  })
}

// ============================================
// PROFILE HOOKS
// ============================================

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: api.profile.get,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.profile.patch,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile, data)
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser })
      // Keep public profile view in sync (template, pricing, paymentsReady, etc.)
      if (data?.profile?.username) {
        queryClient.invalidateQueries({ queryKey: queryKeys.publicProfile(data.profile.username) })
      }
    },
  })
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.profile.getSettings,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.profile.updateSettings,
    onSuccess: (data, variables) => {
      queryClient.setQueryData(queryKeys.settings, data.settings)
      // Keep the profile cache in sync for fields that also live on the Profile model (e.g., isPublic).
      queryClient.setQueryData(queryKeys.profile, (oldData: any) => {
        if (!oldData?.profile) return oldData
        return {
          ...oldData,
          profile: {
            ...oldData.profile,
            ...(variables?.isPublic !== undefined ? { isPublic: data.settings.isPublic } : null),
            ...(variables?.notificationPrefs !== undefined ? { notificationPrefs: data.settings.notificationPrefs } : null),
            ...(variables?.feeMode !== undefined ? { feeMode: data.settings.feeMode } : null),
          },
        }
      })
    },
  })
}

// Salary Mode hooks
export function useSalaryMode() {
  return useQuery({
    queryKey: ['salaryMode'],
    queryFn: api.profile.getSalaryMode,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useUpdateSalaryMode() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.profile.updateSalaryMode,
    onSuccess: (data) => {
      queryClient.setQueryData(['salaryMode'], (oldData: any) => ({
        ...oldData,
        enabled: data.enabled,
        preferredPayday: data.preferredPayday,
        billingDay: data.billingDay,
      }))
    },
  })
}

export function useCheckUsername(username: string) {
  return useQuery({
    queryKey: queryKeys.checkUsername(username),
    queryFn: () => api.profile.checkUsername(username),
    enabled: username.length >= 3,
    staleTime: 10 * 1000, // 10 seconds
  })
}

// ============================================
// PUBLIC USER HOOKS
// ============================================

export function usePublicProfile(username: string) {
  return useQuery({
    queryKey: queryKeys.publicProfile(username),
    queryFn: () => api.users.getByUsername(username),
    enabled: !!username,
    staleTime: 60 * 1000, // 1 minute
  })
}

// ============================================
// STRIPE HOOKS
// ============================================

export function useStripeConnect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.stripe.connect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stripe.status })
      queryClient.invalidateQueries({ queryKey: queryKeys.profile })
    },
  })
}

export function useStripeStatus() {
  return useQuery({
    queryKey: queryKeys.stripe.status,
    queryFn: () => api.stripe.getStatus(),
    staleTime: 2 * 60 * 1000, // 2 minutes - status rarely changes once connected
  })
}

export function useStripeBalance() {
  return useQuery({
    queryKey: queryKeys.stripe.balance,
    queryFn: api.stripe.getBalance,
    staleTime: 60 * 1000,
  })
}

export function useStripePayouts() {
  return useQuery({
    queryKey: queryKeys.stripe.payouts,
    queryFn: api.stripe.getPayouts,
    staleTime: 60 * 1000,
  })
}

export function useStripeDashboardLink() {
  return useMutation({
    mutationFn: api.stripe.getDashboardLink,
  })
}

// ============================================
// PAYSTACK HOOKS
// ============================================

export function usePaystackBanks(country: string) {
  return useQuery({
    queryKey: queryKeys.paystack.banks(country),
    queryFn: () => api.paystack.getBanks(country),
    enabled: !!country,
    staleTime: 5 * 60 * 1000, // 5 minutes - banks don't change often
  })
}

export function usePaystackResolveAccount() {
  return useMutation({
    mutationFn: (data: { accountNumber: string; bankCode: string; idNumber?: string; accountType?: 'personal' | 'business' }) =>
      api.paystack.resolveAccount(data),
  })
}

export function usePaystackConnect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.paystack.connect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.paystack.status })
      queryClient.invalidateQueries({ queryKey: queryKeys.profile })
    },
  })
}

export function usePaystackStatus() {
  return useQuery({
    queryKey: queryKeys.paystack.status,
    queryFn: api.paystack.getStatus,
    staleTime: 2 * 60 * 1000, // 2 minutes - status rarely changes once connected
  })
}

// ============================================
// CHECKOUT HOOKS
// ============================================

export function useCreateCheckout() {
  return useMutation({
    mutationFn: api.checkout.createSession,
  })
}

export function useVerifyPaystackPayment() {
  return useMutation({
    mutationFn: ({ reference, username }: { reference: string; username?: string }) =>
      api.checkout.verifyPaystack(reference, username),
  })
}

// ============================================
// SUBSCRIPTION HOOKS
// ============================================

export function useSubscriptions(status: 'all' | 'active' | 'canceled' | 'past_due' = 'active') {
  return useInfiniteQuery({
    queryKey: queryKeys.subscriptions.list(status),
    queryFn: ({ pageParam }) => api.subscriptions.list({ cursor: pageParam, status }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 2 * 60 * 1000, // 2 minutes - reduces refetches on tab switches
    placeholderData: keepPreviousData, // Keep old list visible during refetch
  })
}

// Simple non-paginated version for dashboards/summaries
export function useSubscriptionsSummary() {
  return useQuery({
    queryKey: queryKeys.subscriptions.summary,
    queryFn: () => api.subscriptions.list({ limit: 10, status: 'active' }),
    staleTime: 2 * 60 * 1000, // 2 minutes
  })
}

export function useSubscription(id: string) {
  return useQuery({
    queryKey: queryKeys.subscriptions.detail(id),
    queryFn: () => api.subscriptions.get(id),
    enabled: !!id,
  })
}

export function useCancelSubscription() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, immediate }: { id: string; immediate?: boolean }) =>
      api.subscriptions.cancel(id, { immediate }),
    onSuccess: (data) => {
      // Invalidate specific subscription and list
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions.detail(data.subscription.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.metrics })
    },
  })
}

export function useManageSubscription() {
  return useMutation({
    mutationFn: (id: string) => api.mySubscriptions.getPortalUrl(id),
    onSuccess: (data) => {
      if (data && data.url) {
        window.location.href = data.url
      }
    },
  })
}

// ============================================
// MY SUBSCRIPTIONS HOOKS (Client viewing their subscriptions)
// ============================================

export function useMySubscriptions(status: 'all' | 'active' | 'canceled' = 'active') {
  return useInfiniteQuery({
    queryKey: queryKeys.subscriptions.my(status),
    queryFn: ({ pageParam }) => api.mySubscriptions.list({ cursor: pageParam, status }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 2 * 60 * 1000, // 2 minutes
    placeholderData: keepPreviousData, // Keep old list visible during refetch
  })
}

// ============================================
// ACTIVITY HOOKS
// ============================================

type ActivityPage = Awaited<ReturnType<typeof api.activity.list>>
type ActivityInfiniteData = { pages: ActivityPage[]; pageParams: (string | undefined)[] }

export function useActivity(limit = 20, options?: { seedFromLimit?: number; polling?: boolean }) {
  const queryClient = useQueryClient()

  return useInfiniteQuery({
    // Include limit in key to prevent cache collisions between different page sizes
    queryKey: queryKeys.activity.list(limit),
    queryFn: ({ pageParam }) => api.activity.list(pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 2 * 60 * 1000, // 2 minutes - reduces refetches on tab switches
    // Poll every 30 seconds for real-time updates (only first page)
    refetchInterval: options?.polling ? 30 * 1000 : undefined,
    refetchIntervalInBackground: false, // Don't poll when tab is hidden
    // Seed from smaller cached query to prevent skeleton flash
    // e.g., Activity page (limit=20) can show Dashboard's cached data (limit=5) immediately
    placeholderData: options?.seedFromLimit
      ? () => queryClient.getQueryData<ActivityInfiniteData>(['activity', { limit: options.seedFromLimit }])
      : undefined,
  })
}

export function useMetrics() {
  return useQuery({
    queryKey: queryKeys.metrics,
    queryFn: api.activity.getMetrics,
    staleTime: 60 * 1000,
  })
}

export function useActivityDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.activity.detail(id),
    queryFn: () => api.activity.get(id),
    enabled: !!id,
  })
}

export function usePayoutHistory() {
  return useQuery({
    queryKey: queryKeys.payouts,
    queryFn: api.activity.getPayouts,
    staleTime: 60 * 1000, // 1 minute
  })
}

// ============================================
// NOTIFICATIONS (Derived from Activity)
// ============================================

// Activity types that should appear as notifications
const NOTIFICATION_ACTIVITY_TYPES = [
  'subscription_created',
  'new_subscriber',
  'payment_received',
  'payment',
  'subscription_canceled',
  'cancelled',
  'payout_initiated',
  'payout_completed',
  'payout_failed',
  'request_accepted',
]

const NOTIFICATIONS_READ_KEY = 'natepay_notifications_read'

// Get read notification IDs from localStorage
function getReadNotificationIds(): Set<string> {
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_READ_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return new Set(Array.isArray(parsed) ? parsed : [])
    }
  } catch {
    // Ignore parse errors
  }
  return new Set()
}

// Save read notification IDs to localStorage
function saveReadNotificationIds(ids: Set<string>) {
  try {
    localStorage.setItem(NOTIFICATIONS_READ_KEY, JSON.stringify([...ids]))
  } catch {
    // Ignore storage errors
  }
}

export interface Notification {
  id: string
  type: string
  title: string
  description: string
  time: Date
  read: boolean
  payload?: Record<string, unknown>
}

// Map activity type to notification title
function getNotificationTitle(type: string): string {
  switch (type) {
    case 'subscription_created':
    case 'new_subscriber': return 'New Subscriber'
    case 'payment_received':
    case 'payment': return 'Payment Received'
    case 'subscription_canceled':
    case 'cancelled': return 'Subscription Cancelled'
    case 'payout_initiated': return 'Payout Started'
    case 'payout_completed': return 'Payout Received'
    case 'payout_failed': return 'Payout Failed'
    case 'request_accepted': return 'Request Accepted'
    default: return 'Activity'
  }
}

// Map activity to notification description
function getNotificationDescription(type: string, payload: Record<string, unknown>): string {
  const name = (payload?.subscriberName || payload?.recipientName || '') as string
  const amount = payload?.amount as number | undefined
  const currency = (payload?.currency || 'USD') as string

  switch (type) {
    case 'subscription_created':
    case 'new_subscriber':
      return name ? `${name} subscribed to your page` : 'Someone subscribed to your page'
    case 'payment_received':
    case 'payment':
      return name ? `${name} paid ${currency} ${amount ? (amount / 100).toFixed(2) : ''}` : 'Payment received'
    case 'subscription_canceled':
    case 'cancelled':
      return name ? `${name} cancelled their subscription` : 'A subscription was cancelled'
    case 'payout_initiated':
      return 'Your payout is being processed'
    case 'payout_completed':
      return 'Your payout has arrived'
    case 'payout_failed':
      return 'Your payout failed - check payment settings'
    case 'request_accepted':
      return name ? `${name} accepted your request` : 'Your request was accepted'
    default:
      return ''
  }
}

/**
 * Hook for notifications panel - derives from Activity data
 * Uses localStorage for read state
 */
export function useNotifications(limit = 10) {
  const queryClient = useQueryClient()

  // Fetch recent activities
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.notifications(limit),
    queryFn: () => api.activity.list(undefined, limit),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000, // Poll every minute
    refetchIntervalInBackground: false,
  })

  // Get read state from localStorage
  const readIds = getReadNotificationIds()

  // Transform activities to notifications
  const notifications: Notification[] = (data?.activities || [])
    .filter((a: { type: string }) => NOTIFICATION_ACTIVITY_TYPES.includes(a.type))
    .map((a: { id: string; type: string; payload: Record<string, unknown>; createdAt: string }) => ({
      id: a.id,
      type: a.type,
      title: getNotificationTitle(a.type),
      description: getNotificationDescription(a.type, a.payload || {}),
      time: new Date(a.createdAt),
      read: readIds.has(a.id),
      payload: a.payload,
    }))

  // Mark single notification as read
  const markAsRead = (id: string) => {
    const newReadIds = new Set(readIds)
    newReadIds.add(id)
    saveReadNotificationIds(newReadIds)
    // Invalidate to trigger re-render with new read state
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications() })
  }

  // Mark all notifications as read
  const markAllAsRead = () => {
    const newReadIds = new Set(readIds)
    notifications.forEach(n => newReadIds.add(n.id))
    saveReadNotificationIds(newReadIds)
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications() })
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return {
    notifications,
    isLoading,
    isError,
    unreadCount,
    markAsRead,
    markAllAsRead,
    refetch,
  }
}

// ============================================
// REQUEST HOOKS
// ============================================

export function useRequests(status: 'all' | 'draft' | 'sent' | 'pending_payment' | 'accepted' | 'declined' | 'expired' = 'all') {
  return useInfiniteQuery({
    queryKey: queryKeys.requests.list(status),
    queryFn: ({ pageParam }) => api.requests.list({ cursor: pageParam, status }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData, // Keep old list visible during refetch
  })
}

// Simple non-paginated version for dashboards
export function useRequestsSummary() {
  return useQuery({
    queryKey: queryKeys.requests.summary,
    queryFn: () => api.requests.list({ limit: 10 }),
    staleTime: 30 * 1000,
  })
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: queryKeys.requests.detail(id),
    queryFn: () => api.requests.get(id),
    enabled: !!id,
  })
}

export function useCreateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.requests.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.requests.all })
    },
  })
}

export function useSendRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, method }: { id: string; method: 'email' | 'link' }) =>
      api.requests.send(id, method),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.requests.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all })
    },
  })
}

// Public request hooks (for recipients)
export function usePublicRequest(token: string) {
  return useQuery({
    queryKey: queryKeys.requests.public(token),
    queryFn: () => api.requests.view(token),
    enabled: !!token,
    retry: false,
  })
}

export function useAcceptRequest() {
  return useMutation({
    mutationFn: ({ token, email }: { token: string; email?: string }) =>
      api.requests.accept(token, email),
  })
}

export function useDeclineRequest() {
  return useMutation({
    mutationFn: api.requests.decline,
  })
}

// ============================================
// UPDATE HOOKS
// ============================================

export function useUpdates() {
  return useQuery({
    queryKey: queryKeys.updates.list,
    queryFn: api.updates.list,
    staleTime: 30 * 1000,
  })
}

export function useUpdate(id: string) {
  return useQuery({
    queryKey: queryKeys.updates.detail(id),
    queryFn: () => api.updates.get(id),
    enabled: !!id,
  })
}

export function useCreateUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.updates.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.updates.list })
    },
  })
}

export function useEditUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<any> }) =>
      api.updates.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.updates.detail(id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.updates.list })
    },
  })
}

export function useDeleteUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.updates.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.updates.list })
    },
  })
}

export function useSendUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.updates.send,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.updates.list })
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all })
    },
  })
}

// ============================================
// MEDIA HOOKS
// ============================================

export function useUploadUrl() {
  return useMutation({
    mutationFn: ({ type, mimeType, fileSize }: { type: 'avatar' | 'photo' | 'voice'; mimeType: string; fileSize: number }) =>
      api.media.getUploadUrl(type, mimeType, fileSize),
  })
}

// Compress and convert image to JPEG
async function compressImage(file: File, maxWidth = 1200, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)

      // Calculate new dimensions
      let width = img.width
      let height = img.height

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width)
        width = maxWidth
      }

      // Draw to canvas
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to compress image'))
          }
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

// Upload timeout in ms (2 minutes - generous for large files on slow networks)
const UPLOAD_TIMEOUT_MS = 120_000

// Helper to upload file to S3
export async function uploadFile(
  file: File,
  type: 'avatar' | 'photo' | 'voice'
): Promise<string> {
  let uploadBlob: Blob = file
  let mimeType = file.type

  // For images, compress and convert to JPEG (handles HEIC, large files, etc.)
  if (type === 'avatar' || type === 'photo') {
    // Check if it's an image type that needs conversion/compression
    const isImage = file.type.startsWith('image/') ||
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic') ||
      file.name.toLowerCase().endsWith('.heif')

    if (isImage) {
      try {
        // Compress to max 1200px width for avatars/photos, JPEG quality 85%
        const maxWidth = type === 'avatar' ? 800 : 1600
        uploadBlob = await compressImage(file, maxWidth, 0.85)
        mimeType = 'image/jpeg'
      } catch (compressError) {
        console.warn('Image compression failed:', compressError)
        // If original is already a supported format, use it
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          uploadBlob = file
          mimeType = file.type
        } else {
          // HEIC or other unsupported format that couldn't be converted
          throw new Error('Could not process this image. Please try a JPG or PNG file.')
        }
      }
    }
  }

  // Get signed URL with the correct mime type and file size
  // Server validates size and includes it in signed URL for security
  let uploadUrl: string
  let publicUrl: string
  try {
    const result = await api.media.getUploadUrl(type, mimeType, uploadBlob.size)
    uploadUrl = result.uploadUrl
    publicUrl = result.publicUrl
  } catch (err: any) {
    console.error('Failed to get upload URL:', err)
    throw new Error(err?.error || 'Failed to prepare upload. Please try again.')
  }

  // Create abort controller for timeout (2 min - generous for large files on slow networks)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  try {
    // Upload to R2/S3
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: uploadBlob,
      headers: {
        'Content-Type': mimeType,
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // Check if upload succeeded
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      console.error('R2 upload failed:', response.status, errorText)
      throw new Error(`Upload failed: ${response.status === 403 ? 'Access denied' : 'Server error'}`)
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('Upload timed out. Please check your connection.')
    }
    throw err
  }

  return publicUrl
}

// Max file sizes in bytes (must match backend/src/services/storage.ts)
const MAX_UPLOAD_SIZES = {
  avatar: 10 * 1024 * 1024,  // 10MB
  photo: 15 * 1024 * 1024,   // 15MB
  voice: 10 * 1024 * 1024,   // 10MB
}

// Helper to upload blob (e.g., audio recording) to S3
export async function uploadBlob(
  blob: Blob,
  type: 'avatar' | 'photo' | 'voice',
  mimeType?: string
): Promise<string> {
  // Client-side size validation (fail fast before requesting signed URL)
  const maxSize = MAX_UPLOAD_SIZES[type]
  if (blob.size > maxSize) {
    throw new Error(`File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`)
  }

  const contentType = mimeType || blob.type || 'application/octet-stream'

  // Get signed URL (server validates size and includes in signature)
  const { uploadUrl, publicUrl } = await api.media.getUploadUrl(type, contentType, blob.size)

  // Upload to S3 with timeout to prevent hanging on bad networks
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': contentType,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`)
    }

    return publicUrl
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Upload timed out. Please check your connection and try again.')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================
// MUTATION HELPER WITH TOAST
// ============================================

/**
 * Hook to create a mutation wrapper that shows toast on error/success
 * Use in components like:
 *
 * ```tsx
 * const { mutate, isPending } = useCreateRequest()
 * const toast = useToast()
 *
 * const handleSubmit = () => {
 *   mutate(data, {
 *     onSuccess: () => toast.success('Request created!'),
 *     onError: (error) => toast.error(getErrorMessage(error)),
 *   })
 * }
 * ```
 */

// ============================================
// AI HOOKS
// ============================================

export function useAIStatus() {
  return useQuery({
    queryKey: queryKeys.aiStatus,
    queryFn: api.ai.status,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useAIGenerate() {
  return useMutation({
    mutationFn: api.ai.generate,
  })
}

export function useAIQuickGenerate() {
  return useMutation({
    mutationFn: api.ai.quick,
  })
}

export function useAIResearch() {
  return useMutation({
    mutationFn: ({ serviceDescription, industry }: { serviceDescription: string; industry?: string }) =>
      api.ai.research(serviceDescription, industry),
  })
}

export function useAISuggestPrice() {
  return useMutation({
    mutationFn: api.ai.suggestPrice,
  })
}

// ============================================
// PAYROLL
// ============================================

// Payroll data changes infrequently - use 5 minute staleTime to avoid
// repeated fetches that could be slow (period generation, aggregation)
const PAYROLL_STALE_TIME = 5 * 60 * 1000 // 5 minutes

export function usePayrollPeriods() {
  return useQuery({
    queryKey: queryKeys.payroll.periods,
    queryFn: () => api.payroll.getPeriods(),
    staleTime: PAYROLL_STALE_TIME,
  })
}

export function usePayrollPeriod(id: string) {
  return useQuery({
    queryKey: queryKeys.payroll.period(id),
    queryFn: () => api.payroll.getPeriod(id),
    enabled: !!id,
    staleTime: PAYROLL_STALE_TIME,
  })
}

export function usePayrollVerify(code: string) {
  return useQuery({
    queryKey: queryKeys.payroll.verify(code),
    queryFn: () => api.payroll.verify(code),
    enabled: !!code,
    staleTime: PAYROLL_STALE_TIME,
  })
}

export function usePayrollSubscribers() {
  return useQuery({
    queryKey: queryKeys.payroll.subscribers,
    queryFn: () => api.payroll.getSubscribers(),
    staleTime: PAYROLL_STALE_TIME,
  })
}

export function useCustomStatement() {
  return useMutation({
    mutationFn: api.payroll.generateCustomStatement,
  })
}

// ============================================
// ANALYTICS HOOKS
// ============================================

export function useAnalyticsStats() {
  return useQuery({
    queryKey: queryKeys.analytics.stats,
    queryFn: api.analytics.getStats,
    staleTime: 60 * 1000, // 1 minute
  })
}

export function useRecordPageView() {
  return useMutation({
    mutationFn: api.analytics.recordView,
  })
}

export function useUpdatePageView() {
  return useMutation({
    mutationFn: ({ viewId, data }: { viewId: string; data: { reachedPayment?: boolean; startedCheckout?: boolean; completedCheckout?: boolean } }) =>
      api.analytics.updateView(viewId, data),
  })
}

// ============================================
// BILLING (Platform Subscription)
// ============================================

export function useBillingStatus() {
  return useQuery({
    queryKey: queryKeys.billing.status,
    queryFn: () => api.billing.getStatus(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

export function useCreateBillingCheckout() {
  return useMutation({
    mutationFn: () => api.billing.createCheckout(),
    onSuccess: (data) => {
      // Redirect to Stripe checkout
      if (data.url) {
        window.location.href = data.url
      }
    },
  })
}

export function useCreateBillingPortal() {
  return useMutation({
    mutationFn: () => api.billing.createPortalSession(),
    onSuccess: (data) => {
      // Redirect to Stripe customer portal
      if (data.url) {
        window.location.href = data.url
      }
    },
  })
}

// Helper to convert Blob to base64
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = reader.result as string
      // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
      const base64Data = base64.split(',')[1]
      resolve(base64Data)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ============================================
// CONFIG HOOKS
// ============================================

/**
 * Fetch fee configuration from backend (source of truth)
 * Falls back to frontend defaults if API unavailable
 */
export function useFeeConfig() {
  return useQuery({
    queryKey: queryKeys.config.fees,
    queryFn: api.config.getFees,
    staleTime: 60 * 60 * 1000, // 1 hour - fees rarely change
    gcTime: 24 * 60 * 60 * 1000, // 24 hours cache
    retry: 1, // Only retry once
  })
}

// Re-export for convenience
export { api } from './client'
