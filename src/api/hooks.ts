// React Query Hooks for Nate API

import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query'
import { api, type ApiError } from './client'

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

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: api.auth.me,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: api.auth.requestMagicLink,
  })
}

export function useVerifyMagicLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.auth.verify,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      queryClient.clear()
    },
  })
}

// ============================================
// PROFILE HOOKS
// ============================================

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: api.profile.get,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.profile.update,
    onSuccess: (data) => {
      queryClient.setQueryData(['profile'], data)
      queryClient.invalidateQueries({ queryKey: ['currentUser'] })
    },
  })
}

export function useCheckUsername(username: string) {
  return useQuery({
    queryKey: ['checkUsername', username],
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
    queryKey: ['publicProfile', username],
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
      queryClient.invalidateQueries({ queryKey: ['stripeStatus'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export function useStripeStatus() {
  return useQuery({
    queryKey: ['stripeStatus'],
    queryFn: api.stripe.getStatus,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useStripeBalance() {
  return useQuery({
    queryKey: ['stripeBalance'],
    queryFn: api.stripe.getBalance,
    staleTime: 60 * 1000,
  })
}

export function useStripePayouts() {
  return useQuery({
    queryKey: ['stripePayouts'],
    queryFn: api.stripe.getPayouts,
    staleTime: 60 * 1000,
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

// ============================================
// SUBSCRIPTION HOOKS
// ============================================

export function useSubscriptions(status: 'all' | 'active' | 'canceled' | 'past_due' = 'active') {
  return useInfiniteQuery({
    queryKey: ['subscriptions', status],
    queryFn: ({ pageParam }) => api.subscriptions.list({ cursor: pageParam, status }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 30 * 1000,
  })
}

// Simple non-paginated version for dashboards/summaries
export function useSubscriptionsSummary() {
  return useQuery({
    queryKey: ['subscriptions', 'summary'],
    queryFn: () => api.subscriptions.list({ limit: 10, status: 'active' }),
    staleTime: 30 * 1000,
  })
}

export function useSubscription(id: string) {
  return useQuery({
    queryKey: ['subscription', id],
    queryFn: () => api.subscriptions.get(id),
    enabled: !!id,
  })
}

// ============================================
// ACTIVITY HOOKS
// ============================================

export function useActivity(limit = 20) {
  return useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) => api.activity.list(pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 30 * 1000,
  })
}

export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: api.activity.getMetrics,
    staleTime: 60 * 1000,
  })
}

export function useActivityDetail(id: string) {
  return useQuery({
    queryKey: ['activity', id],
    queryFn: () => api.activity.get(id),
    enabled: !!id,
  })
}

// ============================================
// REQUEST HOOKS
// ============================================

export function useRequests(status: 'all' | 'draft' | 'sent' | 'pending_payment' | 'accepted' | 'declined' | 'expired' = 'all') {
  return useInfiniteQuery({
    queryKey: ['requests', status],
    queryFn: ({ pageParam }) => api.requests.list({ cursor: pageParam, status }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 30 * 1000,
  })
}

// Simple non-paginated version for dashboards
export function useRequestsSummary() {
  return useQuery({
    queryKey: ['requests', 'summary'],
    queryFn: () => api.requests.list({ limit: 10 }),
    staleTime: 30 * 1000,
  })
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: ['request', id],
    queryFn: () => api.requests.get(id),
    enabled: !!id,
  })
}

export function useCreateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.requests.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

export function useSendRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, method }: { id: string; method: 'email' | 'link' }) =>
      api.requests.send(id, method),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests'] })
      queryClient.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

// Public request hooks (for recipients)
export function usePublicRequest(token: string) {
  return useQuery({
    queryKey: ['publicRequest', token],
    queryFn: () => api.requests.view(token),
    enabled: !!token,
    retry: false,
  })
}

export function useAcceptRequest() {
  return useMutation({
    mutationFn: ({ token, email }: { token: string; email: string }) =>
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
    queryKey: ['updates'],
    queryFn: api.updates.list,
    staleTime: 30 * 1000,
  })
}

export function useUpdate(id: string) {
  return useQuery({
    queryKey: ['update', id],
    queryFn: () => api.updates.get(id),
    enabled: !!id,
  })
}

export function useCreateUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.updates.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['updates'] })
    },
  })
}

export function useEditUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<any> }) =>
      api.updates.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['update', id] })
      queryClient.invalidateQueries({ queryKey: ['updates'] })
    },
  })
}

export function useDeleteUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.updates.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['updates'] })
    },
  })
}

export function useSendUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.updates.send,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['updates'] })
      queryClient.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

// ============================================
// MEDIA HOOKS
// ============================================

export function useUploadUrl() {
  return useMutation({
    mutationFn: ({ type, mimeType }: { type: 'avatar' | 'photo' | 'voice'; mimeType: string }) =>
      api.media.getUploadUrl(type, mimeType),
  })
}

// Helper to upload file to S3
export async function uploadFile(
  file: File,
  type: 'avatar' | 'photo' | 'voice'
): Promise<string> {
  // Get signed URL
  const { uploadUrl, publicUrl } = await api.media.getUploadUrl(type, file.type)

  // Upload to S3
  await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  })

  return publicUrl
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
    queryKey: ['aiStatus'],
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

// Re-export for convenience
export { api } from './client'
