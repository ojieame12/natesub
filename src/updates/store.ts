import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UpdateAudience = 'all' | 'supporters' | 'vips'
export type MediaType = 'text' | 'image' | 'video'

export interface UpdateDraft {
  caption: string
  mediaType: MediaType
  mediaUrl?: string
  audience: UpdateAudience
  savedAt: number
}

export interface SentUpdate {
  id: string
  caption: string
  mediaType: MediaType
  mediaUrl?: string
  audience: UpdateAudience
  sentAt: number
  views: number
  recipients: number
}

interface UpdatesState {
  // Draft (work in progress)
  draft: UpdateDraft | null

  // Sent updates history (mock for now)
  sentUpdates: SentUpdate[]

  // Draft actions
  setDraft: (draft: Partial<UpdateDraft> | null) => void
  updateDraft: (updates: Partial<UpdateDraft>) => void
  clearDraft: () => void

  // Sent updates actions
  addSentUpdate: (update: Omit<SentUpdate, 'id' | 'sentAt' | 'views' | 'recipients'>) => void
  clearHistory: () => void
}

const initialDraft: UpdateDraft = {
  caption: '',
  mediaType: 'text',
  audience: 'all',
  savedAt: Date.now(),
}

export const useUpdatesStore = create<UpdatesState>()(
  persist(
    (set, get) => ({
      draft: null,
      sentUpdates: [],

      setDraft: (draft) => set({
        draft: draft ? {
          ...initialDraft,
          ...draft,
          savedAt: Date.now(),
        } : null,
      }),

      updateDraft: (updates) => set({
        draft: get().draft ? {
          ...get().draft!,
          ...updates,
          savedAt: Date.now(),
        } : {
          ...initialDraft,
          ...updates,
          savedAt: Date.now(),
        },
      }),

      clearDraft: () => set({ draft: null }),

      addSentUpdate: (update) => set((state) => ({
        sentUpdates: [
          {
            ...update,
            id: `update_${Date.now()}`,
            sentAt: Date.now(),
            views: 0,
            recipients: Math.floor(Math.random() * 50) + 10, // Mock
          },
          ...state.sentUpdates,
        ],
        draft: null, // Clear draft after sending
      })),

      clearHistory: () => set({ sentUpdates: [] }),
    }),
    {
      name: 'natepay-updates',
      version: 1,
      // Only persist draft - sentUpdates would come from API in production
      partialize: (state) => ({
        draft: state.draft,
      }),
    }
  )
)

// Helper to check if draft has unsaved changes
export const hasDraftChanges = (draft: UpdateDraft | null): boolean => {
  if (!draft) return false
  return draft.caption.trim().length > 0 || draft.mediaUrl !== undefined
}

// Helper to get audience label
export const getAudienceLabel = (audience: UpdateAudience): string => {
  switch (audience) {
    case 'all':
      return 'All Subscribers'
    case 'supporters':
      return 'Supporters+'
    case 'vips':
      return 'VIPs Only'
  }
}

export default useUpdatesStore
