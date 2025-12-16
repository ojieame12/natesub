import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

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

// Fee mode - who pays the platform fee
export type FeeMode = 'absorb' | 'pass_to_subscriber'

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

// Impact item - "How it would help me"
export interface ImpactItem {
    id: string
    title: string
    subtitle: string
}

// Perk item - "What you'll get from me"
export interface PerkItem {
    id: string
    title: string
    enabled: boolean
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
    generatedPerks: string[]
    generatedImpact: string[]
    isGenerating: boolean

    // Auth
    email: string
    otp: string

    // Identity
    name: string
    country: string
    countryCode: string
    currency: string

    // Purpose - what's this subscription for?
    purpose: SubscriptionPurpose | null

    // Pricing
    pricingModel: PricingModel
    singleAmount: number | null
    tiers: SubscriptionTier[]

    // Impact - how it would help me
    impactItems: ImpactItem[]

    // Perks - what subscribers get
    perks: PerkItem[]

    // Voice intro
    hasVoiceIntro: boolean
    voiceIntroUrl: string | null

    // About
    bio: string

    // Username
    username: string

    // Avatar
    avatarUrl: string | null

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
    setGeneratedContent: (bio: string, perks: string[], impact: string[]) => void
    setIsGenerating: (isGenerating: boolean) => void
    setEmail: (email: string) => void
    setOtp: (otp: string) => void
    setName: (name: string) => void
    setCountry: (country: string, countryCode: string) => void
    setCurrency: (currency: string) => void
    setPurpose: (purpose: SubscriptionPurpose) => void
    setPricingModel: (model: PricingModel) => void
    setSingleAmount: (amount: number | null) => void
    setTiers: (tiers: SubscriptionTier[]) => void
    addTier: (tier: SubscriptionTier) => void
    updateTier: (id: string, updates: Partial<SubscriptionTier>) => void
    removeTier: (id: string) => void
    setImpactItems: (items: ImpactItem[]) => void
    updateImpactItem: (id: string, updates: Partial<ImpactItem>) => void
    setPerks: (perks: PerkItem[]) => void
    togglePerk: (id: string) => void
    addPerk: (perk: PerkItem) => void
    updatePerk: (id: string, title: string) => void
    removePerk: (id: string) => void
    setHasVoiceIntro: (has: boolean) => void
    setVoiceIntroUrl: (url: string | null) => void
    setBio: (bio: string) => void
    setUsername: (username: string) => void
    setAvatarUrl: (url: string | null) => void
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

const defaultImpactItems: ImpactItem[] = [
    { id: 'impact-1', title: 'Focus on My Craft', subtitle: 'More time creating, less time worrying' },
    { id: 'impact-2', title: 'Help with My Groceries', subtitle: 'Cover the basics while I build' },
    { id: 'impact-3', title: 'Help with Some Bills', subtitle: 'Keep the lights on and the dream alive' },
]

const defaultPerks: PerkItem[] = [
    { id: 'perk-1', title: 'Weekly Updates', enabled: true },
    { id: 'perk-2', title: 'Ask Me Anything', enabled: true },
    { id: 'perk-3', title: 'Subscription to my thoughts', enabled: true },
    { id: 'perk-4', title: 'Direct messages & priority replies', enabled: false },
    { id: 'perk-5', title: 'Monthly supporter shoutouts', enabled: false },
    { id: 'perk-6', title: 'Behind the scenes access', enabled: false },
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
    generatedPerks: [] as string[],
    generatedImpact: [] as string[],
    isGenerating: false,
    email: '',
    otp: '',
    name: '',
    country: '',
    countryCode: '',
    currency: 'USD',
    purpose: 'support' as SubscriptionPurpose,
    pricingModel: 'single' as PricingModel,
    singleAmount: 10,
    tiers: defaultTiers,
    impactItems: defaultImpactItems,
    perks: defaultPerks,
    hasVoiceIntro: false,
    voiceIntroUrl: null as string | null,
    bio: '',
    username: '',
    avatarUrl: null as string | null,
    paymentProvider: null as PaymentProvider,
    feeMode: 'pass_to_subscriber' as FeeMode, // Default: subscriber pays the fee
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
            setGeneratedContent: (generatedBio, generatedPerks, generatedImpact) => set({
                generatedBio,
                generatedPerks,
                generatedImpact
            }),
            setIsGenerating: (isGenerating) => set({ isGenerating }),

            // Auth
            setEmail: (email) => set({ email }),
            setOtp: (otp) => set({ otp }),

            // Identity
            setName: (name) => set({ name }),
            setCountry: (country, countryCode) => set({ country, countryCode }),
            setCurrency: (currency) => set({ currency }),

            // Purpose
            setPurpose: (purpose) => set({ purpose }),

            // Pricing
            setPricingModel: (pricingModel) => set({ pricingModel }),
            setSingleAmount: (singleAmount) => set({ singleAmount }),
            setTiers: (tiers) => set({ tiers }),
            addTier: (tier) => set((state) => ({ tiers: [...state.tiers, tier] })),
            updateTier: (id, updates) => set((state) => ({
                tiers: state.tiers.map((t) => t.id === id ? { ...t, ...updates } : t)
            })),
            removeTier: (id) => set((state) => ({
                tiers: state.tiers.filter((t) => t.id !== id)
            })),

            // Impact
            setImpactItems: (impactItems) => set({ impactItems }),
            updateImpactItem: (id, updates) => set((state) => ({
                impactItems: state.impactItems.map((item) =>
                    item.id === id ? { ...item, ...updates } : item
                )
            })),

            // Perks
            setPerks: (perks) => set({ perks }),
            togglePerk: (id) => set((state) => ({
                perks: state.perks.map((perk) =>
                    perk.id === id ? { ...perk, enabled: !perk.enabled } : perk
                )
            })),
            addPerk: (perk) => set((state) => ({ perks: [...state.perks, perk] })),
            updatePerk: (id, title) => set((state) => ({
                perks: state.perks.map((perk) =>
                    perk.id === id ? { ...perk, title } : perk
                )
            })),
            removePerk: (id) => set((state) => ({
                perks: state.perks.filter((perk) => perk.id !== id)
            })),

            // Voice
            setHasVoiceIntro: (hasVoiceIntro) => set({ hasVoiceIntro }),
            setVoiceIntroUrl: (voiceIntroUrl) => set({ voiceIntroUrl }),

            // About
            setBio: (bio) => set({ bio }),

            // Username
            setUsername: (username) => set({ username }),

            // Avatar
            setAvatarUrl: (avatarUrl) => set({ avatarUrl }),

            // Payment provider
            setPaymentProvider: (paymentProvider) => set({ paymentProvider }),

            // Fee mode
            setFeeMode: (feeMode) => set({ feeMode }),

            // Navigation
            nextStep: () => set((state) => ({ currentStep: state.currentStep + 1 })),
            prevStep: () => set((state) => ({ currentStep: Math.max(0, state.currentStep - 1) })),
            goToStep: (step) => set({ currentStep: step }),
            reset: () => set(initialState),

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
                    // Identity
                    if (d.name) updates.name = d.name
                    if (d.country) updates.country = d.country
                    if (d.countryCode) updates.countryCode = d.countryCode
                    if (d.currency) updates.currency = d.currency
                    if (d.username) updates.username = d.username
                    // Pricing
                    if (d.singleAmount !== undefined) updates.singleAmount = d.singleAmount
                    if (d.pricingModel) updates.pricingModel = d.pricingModel
                    if (d.purpose) updates.purpose = d.purpose
                    if (d.tiers) updates.tiers = d.tiers
                    // Content
                    if (d.bio) updates.bio = d.bio
                    if (d.avatarUrl) updates.avatarUrl = d.avatarUrl
                    if (d.voiceIntroUrl) updates.voiceIntroUrl = d.voiceIntroUrl
                    if (d.hasVoiceIntro !== undefined) updates.hasVoiceIntro = d.hasVoiceIntro
                    if (d.perks) updates.perks = d.perks
                    if (d.impactItems) updates.impactItems = d.impactItems
                    // Service-specific
                    if (d.serviceDescription) updates.serviceDescription = d.serviceDescription
                    if (d.serviceDeliverables) updates.serviceDeliverables = d.serviceDeliverables
                    if (d.serviceCredential) updates.serviceCredential = d.serviceCredential
                    if (d.generatedBio) updates.generatedBio = d.generatedBio
                    if (d.generatedPerks) updates.generatedPerks = d.generatedPerks
                    if (d.generatedImpact) updates.generatedImpact = d.generatedImpact
                    // Payment
                    if (d.paymentProvider) updates.paymentProvider = d.paymentProvider
                    if (d.feeMode) updates.feeMode = d.feeMode
                }

                return updates
            }),
        }),
        {
            name: 'natepay-onboarding',
            version: 1,
            // Use sessionStorage instead of localStorage to prevent stale state across sessions
            // This means onboarding progress is lost when the tab closes, but prevents
            // the "teleporting" bug where users are sent to random onboarding steps
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                // Persist key state for resume
                // Note: serviceDescriptionAudio (Blob) is NOT persisted - only the URL after upload
                // Note: isGenerating excluded as it's transient
                currentStep: state.currentStep,
                branch: state.branch,
                serviceDescription: state.serviceDescription,
                serviceDescriptionAudioUrl: state.serviceDescriptionAudioUrl,
                serviceDeliverables: state.serviceDeliverables,
                serviceCredential: state.serviceCredential,
                generatedBio: state.generatedBio,
                generatedPerks: state.generatedPerks,
                generatedImpact: state.generatedImpact,
                email: state.email,
                name: state.name,
                country: state.country,
                countryCode: state.countryCode,
                currency: state.currency,
                purpose: state.purpose,
                pricingModel: state.pricingModel,
                singleAmount: state.singleAmount,
                tiers: state.tiers,
                impactItems: state.impactItems,
                perks: state.perks,
                hasVoiceIntro: state.hasVoiceIntro,
                voiceIntroUrl: state.voiceIntroUrl,
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
                        sessionStorage.removeItem('natepay-onboarding')
                    } catch (e) {
                        // Ignore
                    }
                    return
                }

                // Check for stale state (older than 24 hours)
                // Only auto-reset if user hasn't completed authentication (step 3+)
                if (state) {
                    const lastUpdated = (state as any)._lastUpdated
                    const twentyFourHours = 24 * 60 * 60 * 1000
                    const isStale = lastUpdated && (Date.now() - lastUpdated > twentyFourHours)
                    const hasNotAuthenticated = state.currentStep < 3 // Before OTP verification

                    if (isStale && hasNotAuthenticated) {
                        console.log('[onboarding] Resetting stale state (>24h, not authenticated)')
                        try {
                            sessionStorage.removeItem('natepay-onboarding')
                        } catch (e) {
                            // Ignore
                        }
                        // Reset to initial state
                        useOnboardingStore.setState({
                            ...initialState
                        })
                    }
                }
            },
        }
    )
)
