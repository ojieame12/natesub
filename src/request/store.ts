import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type RelationshipType =
    | 'family_mom' | 'family_dad' | 'family_sibling' | 'family_spouse' | 'family_child' | 'family_grandparent' | 'family_other'
    | 'friend_close' | 'friend_acquaintance'
    | 'client'
    | 'fan'
    | 'colleague'
    | 'partner'
    | 'other'

export interface Recipient {
    id: string
    name: string
    phone?: string
    email?: string
    photo?: string
}

export interface CustomPerk {
    id: string
    title: string
    enabled: boolean
}

interface RequestState {
    // Step 1: Recipient
    recipient: Recipient | null

    // Step 2: Relationship
    relationship: RelationshipType | null
    customRelationship: string

    // Step 3: Details
    amount: number
    isRecurring: boolean
    purpose: string

    // Step 4: Personalize
    message: string
    voiceNoteUrl: string | null
    voiceNoteDuration: number

    // Step 5: Rewards
    selectedPerks: string[]
    customPerks: CustomPerk[]

    // Actions
    setRecipient: (recipient: Recipient | null) => void
    setRelationship: (relationship: RelationshipType | null) => void
    setCustomRelationship: (value: string) => void
    setAmount: (amount: number) => void
    setIsRecurring: (isRecurring: boolean) => void
    setPurpose: (purpose: string) => void
    setMessage: (message: string) => void
    setVoiceNote: (url: string | null, duration: number) => void
    setSelectedPerks: (perks: string[]) => void
    addCustomPerk: (perk: CustomPerk) => void
    togglePerk: (perkId: string) => void
    reset: () => void
}

const initialState = {
    recipient: null,
    relationship: null,
    customRelationship: '',
    amount: 10,
    isRecurring: true,
    purpose: '',
    message: '',
    voiceNoteUrl: null,
    voiceNoteDuration: 0,
    selectedPerks: [],
    customPerks: [],
}

export const useRequestStore = create<RequestState>()(
    persist(
        (set) => ({
            ...initialState,

            setRecipient: (recipient) => set({ recipient }),
            setRelationship: (relationship) => set({ relationship }),
            setCustomRelationship: (customRelationship) => set({ customRelationship }),
            setAmount: (amount) => set({ amount }),
            setIsRecurring: (isRecurring) => set({ isRecurring }),
            setPurpose: (purpose) => set({ purpose }),
            setMessage: (message) => set({ message }),
            setVoiceNote: (voiceNoteUrl, voiceNoteDuration) => set({ voiceNoteUrl, voiceNoteDuration }),
            setSelectedPerks: (selectedPerks) => set({ selectedPerks }),
            addCustomPerk: (perk) => set((state) => ({
                customPerks: [...state.customPerks, perk]
            })),
            togglePerk: (perkId) => set((state) => ({
                selectedPerks: state.selectedPerks.includes(perkId)
                    ? state.selectedPerks.filter(id => id !== perkId)
                    : [...state.selectedPerks, perkId]
            })),
            reset: () => set(initialState),
        }),
        {
            name: 'natepay-request',
            // Don't persist voice note URLs (blob URLs don't survive refresh)
            partialize: (state) => ({
                recipient: state.recipient,
                relationship: state.relationship,
                customRelationship: state.customRelationship,
                amount: state.amount,
                isRecurring: state.isRecurring,
                purpose: state.purpose,
                message: state.message,
                selectedPerks: state.selectedPerks,
                customPerks: state.customPerks,
                // Intentionally omit voiceNoteUrl and voiceNoteDuration
            }),
        }
    )
)

// Helper to get relationship display name
export const getRelationshipLabel = (type: RelationshipType | null): string => {
    const labels: Record<RelationshipType, string> = {
        family_mom: 'Mom',
        family_dad: 'Dad',
        family_sibling: 'Sibling',
        family_spouse: 'Spouse',
        family_child: 'Child',
        family_grandparent: 'Grandparent',
        family_other: 'Family',
        friend_close: 'Close Friend',
        friend_acquaintance: 'Friend',
        client: 'Client',
        fan: 'Fan/Supporter',
        colleague: 'Colleague',
        partner: 'Partner',
        other: 'Other',
    }
    return type ? labels[type] : ''
}

// Helper to get suggested amounts based on relationship
export const getSuggestedAmounts = (type: RelationshipType | null): number[] => {
    if (!type) return [5, 10, 25, 50]

    if (type.startsWith('family_')) return [20, 50, 100, 200]
    if (type.startsWith('friend_')) return [5, 10, 15, 25]
    if (type === 'client') return [25, 50, 100, 250]
    if (type === 'fan') return [5, 10, 15, 25]
    if (type === 'partner') return [25, 50, 100, 150]

    return [5, 10, 25, 50]
}

// Helper to generate default message based on relationship
export const getDefaultMessage = (name: string, type: RelationshipType | null, amount: number, isRecurring: boolean): string => {
    const firstName = name.split(' ')[0]
    const frequency = isRecurring ? 'monthly' : ''

    if (!type) return `Hey! I'd love your support with a ${frequency} $${amount} contribution.`

    if (type === 'family_mom' || type === 'family_dad') {
        return `Hey ${type === 'family_mom' ? 'Mom' : 'Dad'}! Would really appreciate your support with a ${frequency} $${amount} contribution. It would mean the world to me!`
    }
    if (type.startsWith('family_')) {
        return `Hey ${firstName}! Would love your support with a ${frequency} $${amount} contribution. Family support means everything!`
    }
    if (type.startsWith('friend_')) {
        return `Hey ${firstName}! I'm asking close friends for support - a ${frequency} $${amount} would really help me out!`
    }
    if (type === 'client') {
        return `Hi ${firstName}, I wanted to offer you a ${frequency} subscription at $${amount}. You'll get exclusive access and priority support.`
    }
    if (type === 'fan') {
        return `Hey ${firstName}! Thank you for being a supporter. A ${frequency} $${amount} subscription gets you exclusive perks!`
    }

    return `Hey ${firstName}! I'd appreciate your support with a ${frequency} $${amount} contribution.`
}
