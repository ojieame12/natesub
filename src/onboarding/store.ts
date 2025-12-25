import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

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

// Branch type - personal vs service
export type BranchType = 'personal' | 'service' | null

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



// Service deliverable - structured input for AI
export interface ServiceDeliverable {
    id: string
    type: 'calls' | 'async' | 'resources' | 'custom'
    label: string
    enabled: boolean
    quantity?: number
    unit?: string
    detail?: string
}

// === Store Interface ===
interface OnboardingStore {
    // Current step
    currentStep: number

    // Branch - personal vs service
    branch: BranchType

    // Service description (for service branch)
    serviceDescription: string
    serviceDescriptionAudio: Blob | null // In-memory blob (not persisted)
    serviceDescriptionAudioUrl: string | null // Persisted URL after upload

    // Structured service inputs (for better AI generation)
    serviceDeliverables: ServiceDeliverable[]
    serviceCredential: string

    // AI-generated content (for service branch)
    generatedBio: string

    isGenerating: boolean

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

    // Payment provider
    paymentProvider: PaymentProvider

    // Fee mode - who pays the platform fee
    feeMode: FeeMode

    // Actions
    setBranch: (branch: BranchType) => void
    setServiceDescription: (description: string) => void
    setServiceDescriptionAudio: (audio: Blob | null) => void
    setServiceDescriptionAudioUrl: (url: string | null) => void
    setServiceDeliverables: (deliverables: ServiceDeliverable[]) => void
    toggleServiceDeliverable: (id: string) => void
    updateServiceDeliverable: (id: string, updates: Partial<ServiceDeliverable>) => void
    setServiceCredential: (credential: string) => void
    setGeneratedContent: (bio: string) => void
    setIsGenerating: (isGenerating: boolean) => void
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
    setPaymentProvider: (provider: PaymentProvider) => void
    setFeeMode: (mode: FeeMode) => void
    nextStep: () => void
    prevStep: () => void
    goToStep: (step: number) => void
    reset: () => void
    // Hydrate from server data (for resume flows)
    hydrateFromServer: (data: {
        step?: number
        branch?: 'personal' | 'service' | null
        data?: Record<string, any> | null
    }) => void
}

// === Default Values ===

const defaultTiers: SubscriptionTier[] = [
    { id: 'tier-1', name: 'Fan', amount: 5, perks: ['Show your support'] },
    { id: 'tier-2', name: 'Supporter', amount: 10, perks: ['Early access', 'Behind the scenes'], isPopular: true },
    { id: 'tier-3', name: 'VIP', amount: 25, perks: ['All perks', 'Monthly shoutout', 'Direct messages'] },
]

const defaultServiceDeliverables: ServiceDeliverable[] = [
    { id: 'del-1', type: 'calls', label: 'Calls', enabled: false, quantity: 2, unit: 'per month' },
    { id: 'del-2', type: 'async', label: 'Async support', enabled: false, detail: 'Slack or Email' },
    { id: 'del-3', type: 'resources', label: 'Resources', enabled: false, detail: 'Templates, guides' },
]

const initialState = {
    currentStep: 0,
    branch: null as BranchType,
    serviceDescription: '',
    serviceDescriptionAudio: null as Blob | null,
    serviceDescriptionAudioUrl: null as string | null,
    serviceDeliverables: defaultServiceDeliverables,
    serviceCredential: '',
    generatedBio: '',
    isGenerating: false,
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
    paymentProvider: null as PaymentProvider,
    feeMode: 'split' as FeeMode, // Default: 4%/4% split between subscriber and creator
}

// === Store ===

export const useOnboardingStore = create<OnboardingStore>()(
    persist(
        (set) => ({
            ...initialState,

            // Branch
            setBranch: (branch) => set({ branch }),
            setServiceDescription: (serviceDescription) => set({ serviceDescription }),
            setServiceDescriptionAudio: (serviceDescriptionAudio) => set({ serviceDescriptionAudio }),
            setServiceDescriptionAudioUrl: (serviceDescriptionAudioUrl) => set({ serviceDescriptionAudioUrl }),
            setServiceDeliverables: (serviceDeliverables) => set({ serviceDeliverables }),
            toggleServiceDeliverable: (id) => set((state) => ({
                serviceDeliverables: state.serviceDeliverables.map((d) =>
                    d.id === id ? { ...d, enabled: !d.enabled } : d
                )
            })),
            updateServiceDeliverable: (id, updates) => set((state) => ({
                serviceDeliverables: state.serviceDeliverables.map((d) =>
                    d.id === id ? { ...d, ...updates } : d
                )
            })),
            setServiceCredential: (serviceCredential) => set({ serviceCredential }),
            setGeneratedContent: (generatedBio) => set({
                generatedBio
            }),
            setIsGenerating: (isGenerating) => set({ isGenerating }),

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

            // Payment provider
            setPaymentProvider: (provider) => set({ paymentProvider: provider }),

            // Fee mode
            setFeeMode: (mode) => set({ feeMode: mode }),

            // Navigation - with debounce protection against rapid tapping
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
            }),

            // Hydrate from server data (for resume flows)
            hydrateFromServer: (serverData) => set(() => {
                const updates: Partial<typeof initialState> = {}

                // Set step and branch from server
                if (serverData.step !== undefined) {
                    updates.currentStep = serverData.step
                }
                if (serverData.branch) {
                    updates.branch = serverData.branch
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
                    // Removed: voiceIntroUrl, hasVoiceIntro, perks, impactItems
                    // Service-specific
                    if (d.serviceDescription) updates.serviceDescription = d.serviceDescription
                    if (d.serviceDeliverables) updates.serviceDeliverables = d.serviceDeliverables
                    if (d.serviceCredential) updates.serviceCredential = d.serviceCredential
                    if (d.generatedBio) updates.generatedBio = d.generatedBio
                    // Payment
                    if (d.paymentProvider) updates.paymentProvider = d.paymentProvider
                    if (d.feeMode) updates.feeMode = d.feeMode
                }

                return updates
            }),
        }),
        {
            name: 'natepay-onboarding',
            version: 2, // Bumped to force migration from sessionStorage
            // Use localStorage with TTL to persist onboarding progress across tab closes
            // while still preventing stale state via the 24-hour TTL check below
            storage: createJSONStorage(() => safeStorage),
            partialize: (state) => ({
                // Persist key state for resume
                // Note: serviceDescriptionAudio (Blob) is NOT persisted - only the URL after upload
                // Note: isGenerating, avatarFile excluded as they are transient or in-memory
                currentStep: state.currentStep,
                branch: state.branch,
                serviceDescription: state.serviceDescription,
                serviceDescriptionAudioUrl: state.serviceDescriptionAudioUrl,
                serviceDeliverables: state.serviceDeliverables,
                serviceCredential: state.serviceCredential,
                generatedBio: state.generatedBio,
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
                        console.log('[onboarding] Resetting stale state (>24h, not authenticated)')
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
