import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { isCrossBorderCountry } from '../utils/regionConfig'

// Re-export useShallow for components that need multiple values without causing re-renders
export { useShallow }

// === Safe Storage ===
// Wrap localStorage to prevent crashes in Safari Private Mode, in-app browsers, etc.
function createSafeStorage(): StateStorage {
    // Test if localStorage is available
    const isAvailable = (() => {
        try {
            const testKey = '__storage_test__'
            localStorage.setItem(testKey, testKey)
            localStorage.removeItem(testKey)
            return true
        } catch {
            return false
        }
    })()

    if (isAvailable) {
        return {
            getItem: (name) => {
                try {
                    return localStorage.getItem(name)
                } catch {
                    return null
                }
            },
            setItem: (name, value) => {
                try {
                    localStorage.setItem(name, value)
                } catch {
                    // Silently fail
                }
            },
            removeItem: (name) => {
                try {
                    localStorage.removeItem(name)
                } catch {
                    // Silently fail
                }
            },
        }
    }

    // Fallback to in-memory storage
    const memoryStore = new Map<string, string>()
    return {
        getItem: (name) => memoryStore.get(name) ?? null,
        setItem: (name, value) => memoryStore.set(name, value),
        removeItem: (name) => memoryStore.delete(name),
    }
}

const safeStorage = createSafeStorage()

// === Types ===

// Step keys - canonical identifiers for each onboarding step
// These remain stable even when step indices change due to conditional steps
export type OnboardingStepKey =
    | 'start'
    | 'email'
    | 'otp'
    | 'identity'
    | 'address'      // Conditional: only for non-cross-border countries
    | 'purpose'
    | 'avatar'
    | 'username'
    | 'payments'
    | 'service-desc' // Conditional: only for service mode
    | 'ai-gen'       // Conditional: only for service mode
    | 'review'

// All possible step keys in canonical order (some may be skipped)
export const ALL_STEP_KEYS: OnboardingStepKey[] = [
    'start',
    'email',
    'otp',
    'identity',
    'address',
    'purpose',
    'avatar',
    'username',
    'payments',
    'service-desc',
    'ai-gen',
    'review',
]

// Get visible step keys based on current configuration
export function getVisibleStepKeys(options: {
    showAddressStep: boolean
    isServiceMode: boolean
}): OnboardingStepKey[] {
    const { showAddressStep, isServiceMode } = options
    return ALL_STEP_KEYS.filter(key => {
        if (key === 'address') return showAddressStep
        if (key === 'service-desc' || key === 'ai-gen') return isServiceMode
        return true
    })
}

// Convert step key to index for current configuration
// If the key isn't visible, find a safe fallback step instead of returning 0
export function stepKeyToIndex(
    key: OnboardingStepKey,
    options: { showAddressStep: boolean; isServiceMode: boolean }
): number {
    const visibleKeys = getVisibleStepKeys(options)
    const index = visibleKeys.indexOf(key)
    if (index >= 0) return index

    // Key isn't visible - find a safe fallback based on key type
    // If it's a removed conditional step, go to the step that would come after it
    if (key === 'address') {
        // Address was removed (switched to cross-border country) → go to purpose
        return visibleKeys.indexOf('purpose')
    }
    if (key === 'service-desc' || key === 'ai-gen') {
        // Service steps removed (switched to non-service) → go to review
        return visibleKeys.indexOf('review')
    }

    // Unknown case - go to payments as a safe mid-flow fallback
    const paymentIdx = visibleKeys.indexOf('payments')
    return paymentIdx >= 0 ? paymentIdx : 0
}

// Convert step index to key for current configuration
export function stepIndexToKey(
    index: number,
    options: { showAddressStep: boolean; isServiceMode: boolean }
): OnboardingStepKey {
    const visibleKeys = getVisibleStepKeys(options)
    return visibleKeys[index] || 'start'
}

// Subscription purpose - why someone would subscribe to you
export type SubscriptionPurpose =
    | 'tips'              // Tips & Appreciation - fans showing gratitude
    | 'support'           // Support Me - help fund my work or passion
    | 'allowance'         // Allowance - regular support from loved ones
    | 'fan_club'          // Fan Club - exclusive community membership
    | 'exclusive_content' // Exclusive Content - behind-the-scenes, early access
    | 'service'           // Service Provider - coaching, consulting, retainers
    | 'other'             // Something Else - unique use case

// Pricing model - single amount or tiered
export type PricingModel = 'single' | 'tiers'

// Fee mode - who pays the platform fee (legacy: absorb/pass_to_subscriber, new: split)
export type FeeMode = 'absorb' | 'pass_to_subscriber' | 'split'

// Payment provider selection
export type PaymentProvider = 'stripe' | 'paystack' | 'flutterwave' | null

// Tier with perks
export interface SubscriptionTier {
    id: string
    name: string
    amount: number
    perks: string[]
    isPopular?: boolean
}

// Service mode perk (simplified, always 3)
export interface ServicePerk {
    id: string
    title: string
    enabled: boolean  // All generated perks are enabled by default
}

// Banner option with variant label
export interface BannerOption {
    url: string
    variant: 'standard' | 'artistic' | 'fallback'  // fallback = avatar used when AI unavailable
}



// === Store Interface ===
interface OnboardingStore {
    // Current step (numeric index - computed from stepKey)
    currentStep: number
    // Current step key (canonical identifier - primary source of truth)
    currentStepKey: OnboardingStepKey

    // Auth
    email: string
    otp: string

    // Identity (split names for Stripe KYC prefill)
    firstName: string
    lastName: string
    country: string
    countryCode: string
    currency: string

    // Address (for Stripe KYC prefill - reduces onboarding screens)
    address: string
    city: string
    state: string
    zip: string

    // Purpose - what's this subscription for?
    purpose: SubscriptionPurpose | null

    // Pricing
    pricingModel: PricingModel
    singleAmount: number | null
    tiers: SubscriptionTier[]



    // Profile Content
    username: string
    bio: string
    avatarUrl: string | null
    avatarFile: Blob | null

    // Service Mode (purpose: 'service')
    serviceDescription: string  // Description for perk generation
    servicePerks: ServicePerk[] // AI-generated perks (always 3)
    bannerUrl: string | null    // Selected/final banner
    bannerOptions: BannerOption[] // AI-generated banner options (max 5, with variant info)

    // Payment provider
    paymentProvider: PaymentProvider

    // Fee mode - who pays the platform fee
    feeMode: FeeMode

    // Actions
    setEmail: (email: string) => void
    setOtp: (otp: string) => void
    setFirstName: (firstName: string) => void
    setLastName: (lastName: string) => void
    setCountry: (country: string, countryCode: string) => void
    setCurrency: (currency: string) => void
    setAddress: (address: string) => void
    setCity: (city: string) => void
    setState: (state: string) => void
    setZip: (zip: string) => void
    setPurpose: (purpose: SubscriptionPurpose) => void
    setPricing: (model: PricingModel, tiers: SubscriptionTier[], singleAmount: number | null) => void
    setBio: (bio: string) => void
    setUsername: (username: string) => void
    setAvatarUrl: (url: string | null) => void
    setAvatarFile: (file: Blob | null) => void
    setServiceDescription: (description: string) => void
    setServicePerks: (perks: ServicePerk[]) => void
    setBannerUrl: (url: string | null) => void
    addBannerOption: (option: BannerOption) => void  // Add to bannerOptions (max 5)
    clearBannerOptions: () => void          // Reset banner options
    setPaymentProvider: (provider: PaymentProvider) => void
    setFeeMode: (mode: FeeMode) => void
    nextStep: () => void
    prevStep: () => void
    goToStep: (step: number) => void
    goToStepKey: (key: OnboardingStepKey) => void
    // Navigate to a specific step by key - updates both key and index atomically
    // No debouncing - for use after async operations (e.g., API calls)
    navigateToStep: (key: OnboardingStepKey) => void
    reset: () => void
    // Hydrate from server data (for resume flows)
    // Supports both legacy numeric step and new stepKey
    hydrateFromServer: (data: {
        step?: number
        stepKey?: OnboardingStepKey
        data?: Record<string, any> | null
    }) => void
}

// === Default Values ===

const defaultTiers: SubscriptionTier[] = [
    { id: 'tier-1', name: 'Fan', amount: 5, perks: ['Show your support'] },
    { id: 'tier-2', name: 'Supporter', amount: 10, perks: ['Early access', 'Behind the scenes'], isPopular: true },
    { id: 'tier-3', name: 'VIP', amount: 25, perks: ['All perks', 'Monthly shoutout', 'Direct messages'] },
]

const initialState = {
    currentStep: 0,
    currentStepKey: 'start' as OnboardingStepKey,
    email: '',
    otp: '',
    firstName: '',
    lastName: '',
    country: '',
    countryCode: '',
    currency: 'USD',
    address: '',
    city: '',
    state: '',
    zip: '',
    purpose: 'support' as SubscriptionPurpose,
    pricingModel: 'single' as PricingModel,
    singleAmount: 10,
    tiers: defaultTiers,
    bio: '',
    username: '',
    avatarUrl: null as string | null,
    avatarFile: null as Blob | null,
    serviceDescription: '',
    servicePerks: [] as ServicePerk[],
    bannerUrl: null as string | null,
    bannerOptions: [] as BannerOption[],
    paymentProvider: null as PaymentProvider,
    feeMode: 'split' as FeeMode, // Default: 4.5%/4.5% split between subscriber and creator
}

// === Store ===

export const useOnboardingStore = create<OnboardingStore>()(
    persist(
        (set) => ({
            ...initialState,

            // Auth
            setEmail: (email) => set({ email }),
            setOtp: (otp) => set({ otp }),

            // Identity
            setFirstName: (firstName) => set({ firstName }),
            setLastName: (lastName) => set({ lastName }),
            setCountry: (country, countryCode) => set({ country, countryCode }),
            setCurrency: (currency) => set({ currency }),

            // Address
            setAddress: (address) => set({ address }),
            setCity: (city) => set({ city }),
            setState: (state) => set({ state }),
            setZip: (zip) => set({ zip }),

            // Purpose
            setPurpose: (purpose) => set({ purpose }),

            // Pricing
            setPricing: (model, tiers, singleAmount) => set({ pricingModel: model, tiers, singleAmount }),

            // Profile Content
            setBio: (bio) => set({ bio }),
            setUsername: (username) => set({ username }),
            setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
            setAvatarFile: (avatarFile) => set({ avatarFile }),

            // Service Mode
            setServiceDescription: (serviceDescription) => set({ serviceDescription }),
            setServicePerks: (servicePerks) => set({ servicePerks }),
            setBannerUrl: (bannerUrl) => set({ bannerUrl }),
            addBannerOption: (option) => set((state) => ({
                bannerOptions: state.bannerOptions.length < 5
                    ? [...state.bannerOptions, option]
                    : state.bannerOptions, // Don't add more than 5
            })),
            clearBannerOptions: () => set({ bannerOptions: [], bannerUrl: null }),

            // Payment provider
            setPaymentProvider: (provider) => set({ paymentProvider: provider }),

            // Fee mode
            setFeeMode: (mode) => set({ feeMode: mode }),

            // Navigation - with debounce protection against rapid tapping
            // Note: nextStep/prevStep update index but not key (key is updated by index.tsx)
            nextStep: () => set((state) => {
                // Prevent rapid navigation (300ms cooldown)
                const now = Date.now()
                const lastNav = (state as any)._lastNavTime || 0
                if (now - lastNav < 300) {
                    return state // Ignore rapid taps
                }
                return {
                    currentStep: state.currentStep + 1,
                    _lastNavTime: now,
                }
            }),
            prevStep: () => set((state) => {
                const now = Date.now()
                const lastNav = (state as any)._lastNavTime || 0
                if (now - lastNav < 300) {
                    return state
                }
                return {
                    currentStep: Math.max(0, state.currentStep - 1),
                    _lastNavTime: now,
                }
            }),
            goToStep: (step) => set((state) => {
                const now = Date.now()
                const lastNav = (state as any)._lastNavTime || 0
                if (now - lastNav < 300) {
                    return state
                }
                return {
                    currentStep: step,
                    _lastNavTime: now,
                }
            }),
            // goToStepKey is NOT debounced - it's used by sync effects and must update immediately
            goToStepKey: (key) => set({ currentStepKey: key }),
            // navigateToStep - atomic navigation by step key (no debouncing)
            // Computes step index from current store config and updates both atomically
            navigateToStep: (key) => set((state) => {
                const { countryCode, purpose } = state
                // Compute step config from current state
                // Cross-border countries skip address step (use utility for single source of truth)
                const showAddressStep = Boolean(countryCode) && !isCrossBorderCountry(countryCode)
                const isServiceMode = purpose === 'service'
                const stepConfig = { showAddressStep, isServiceMode }
                const stepIndex = stepKeyToIndex(key, stepConfig)
                return {
                    currentStepKey: key,
                    currentStep: stepIndex,
                }
            }),
            reset: () => set({
                ...initialState,
                // Reset specific fields to their initial values,
                // but keep some user-entered data if it makes sense for a soft reset
                username: '',
                bio: '',
                avatarUrl: null,
                avatarFile: null,
                paymentProvider: null, // Reset to null so we re-evaluate safest option
                feeMode: 'split',
                // Reset address fields
                address: '',
                city: '',
                state: '',
                zip: '',
                // Reset service mode fields
                serviceDescription: '',
                servicePerks: [],
                bannerUrl: null,
                bannerOptions: [],
            }),

            // Hydrate from server data (for resume flows)
            hydrateFromServer: (serverData) => set(() => {
                const updates: Partial<typeof initialState> = {}

                // Prefer stepKey over numeric step (stepKey is the canonical identifier)
                if (serverData.stepKey) {
                    updates.currentStepKey = serverData.stepKey
                }
                // Also support legacy numeric step
                if (serverData.step !== undefined) {
                    updates.currentStep = serverData.step
                }

                // Merge server data with local state (server wins for key fields)
                if (serverData.data) {
                    const d = serverData.data
                    // Identity (support both old 'name' and new firstName/lastName)
                    if (d.firstName) updates.firstName = d.firstName
                    if (d.lastName) updates.lastName = d.lastName
                    // Migrate old 'name' field to firstName/lastName
                    if (d.name && !d.firstName) {
                        const parts = d.name.trim().split(' ')
                        updates.firstName = parts[0] || ''
                        updates.lastName = parts.slice(1).join(' ') || ''
                    }
                    if (d.country) updates.country = d.country
                    if (d.countryCode) updates.countryCode = d.countryCode
                    if (d.currency) updates.currency = d.currency
                    if (d.username) updates.username = d.username
                    // Address
                    if (d.address) updates.address = d.address
                    if (d.city) updates.city = d.city
                    if (d.state) updates.state = d.state
                    if (d.zip) updates.zip = d.zip
                    // Pricing
                    if (d.singleAmount !== undefined) updates.singleAmount = d.singleAmount
                    if (d.pricingModel) updates.pricingModel = d.pricingModel
                    if (d.purpose) updates.purpose = d.purpose
                    if (d.tiers) updates.tiers = d.tiers
                    // Content
                    if (d.bio) updates.bio = d.bio
                    if (d.avatarUrl) updates.avatarUrl = d.avatarUrl
                    // Service Mode
                    if (d.serviceDescription) updates.serviceDescription = d.serviceDescription
                    if (d.servicePerks) updates.servicePerks = d.servicePerks
                    if (d.bannerUrl) updates.bannerUrl = d.bannerUrl
                    // Handle backward compatibility: convert string[] to BannerOption[]
                    if (d.bannerOptions && Array.isArray(d.bannerOptions)) {
                        updates.bannerOptions = d.bannerOptions.map((opt: string | BannerOption, i: number) =>
                            typeof opt === 'string'
                                ? { url: opt, variant: i === 0 ? 'standard' : 'artistic' as const }
                                : opt
                        )
                    }
                    // Payment
                    if (d.paymentProvider) updates.paymentProvider = d.paymentProvider
                    if (d.feeMode) updates.feeMode = d.feeMode
                }

                return updates
            }),
        }),
        {
            name: 'natepay-onboarding',
            version: 4, // Bumped to add BannerOption type with variant
            // Use localStorage with TTL to persist onboarding progress across tab closes
            // while still preventing stale state via the 24-hour TTL check below
            storage: createJSONStorage(() => safeStorage),
            partialize: (state) => ({
                // Persist key state for resume
                // Note: avatarFile excluded as it is transient/in-memory
                currentStep: state.currentStep,
                currentStepKey: state.currentStepKey, // Canonical step identifier
                email: state.email,
                firstName: state.firstName,
                lastName: state.lastName,
                country: state.country,
                countryCode: state.countryCode,
                currency: state.currency,
                address: state.address,
                city: state.city,
                state: state.state,
                zip: state.zip,
                purpose: state.purpose,
                pricingModel: state.pricingModel,
                singleAmount: state.singleAmount,
                tiers: state.tiers,
                bio: state.bio,
                username: state.username,
                avatarUrl: state.avatarUrl,
                // Service mode fields
                serviceDescription: state.serviceDescription,
                servicePerks: state.servicePerks,
                bannerUrl: state.bannerUrl,
                bannerOptions: state.bannerOptions,
                paymentProvider: state.paymentProvider,
                feeMode: state.feeMode,
                // Track when state was last updated for TTL
                _lastUpdated: Date.now(),
            }),
            // Handle storage errors and stale state gracefully
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[onboarding] Failed to rehydrate state:', error)
                    // Clear corrupted storage
                    try {
                        localStorage.removeItem('natepay-onboarding')
                    } catch (e) {
                        // Ignore
                    }
                    return
                }

                // Check for stale state (older than 24 hours)
                // Reset if: (1) state is stale AND (2) user hasn't authenticated yet
                // This prevents the "teleporting" bug while allowing recovery after tab close
                if (state) {
                    const lastUpdated = (state as any)._lastUpdated
                    const twentyFourHours = 24 * 60 * 60 * 1000
                    const isStale = lastUpdated && (Date.now() - lastUpdated > twentyFourHours)
                    const hasNotAuthenticated = state.currentStep < 3 // Before OTP verification

                    if (isStale && hasNotAuthenticated) {
                        if (import.meta.env.DEV) console.log('[onboarding] Resetting stale state (>24h, not authenticated)')
                        try {
                            localStorage.removeItem('natepay-onboarding')
                        } catch (e) {
                            // Ignore
                        }
                        // Reset to initial state
                        useOnboardingStore.setState({
                            ...initialState
                        })
                    }

                    // For authenticated users, trust server state over local state
                    // The hydrateFromServer function should be called after login
                    // to reconcile any differences
                }
            },
        }
    )
)
