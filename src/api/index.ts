// API exports
export { api, default as apiClient } from './client'
export type {
  ApiError,
  User,
  Profile,
  Tier,
  Perk,
  ImpactItem,
  Subscription,
  Activity,
  Metrics,
  Request,
  Update,
} from './client'

// React Query hooks
export * from './hooks'

// Error handling utilities
export { getErrorMessage, getStatusMessage } from './hooks'

// Provider
export { ApiProvider, queryClient } from './provider'

// Field mappers for frontend/backend alignment
export {
  dollarsToCents,
  centsToDollars,
  formatAmount,
  mapRelationshipToApi,
  mapOnboardingToApi,
  mapApiToOnboarding,
  mapRequestToApi,
  mapUpdateToApi,
  mapApiToUpdate,
} from './mappers'
