import { describe, expect, it } from 'vitest'
import { getAudienceLabel, hasDraftChanges, useUpdatesStore } from './store'

describe('updates/store', () => {
  it('detects whether a draft has changes', () => {
    expect(hasDraftChanges(null)).toBe(false)
    expect(hasDraftChanges({
      caption: '   ',
      mediaType: 'text',
      audience: 'all',
      savedAt: Date.now(),
    })).toBe(false)
    expect(hasDraftChanges({
      caption: 'Hello',
      mediaType: 'text',
      audience: 'all',
      savedAt: Date.now(),
    })).toBe(true)
    expect(hasDraftChanges({
      caption: '',
      mediaType: 'image',
      mediaUrl: 'https://example.com/x.jpg',
      audience: 'all',
      savedAt: Date.now(),
    })).toBe(true)
  })

  it('maps audience to labels', () => {
    expect(getAudienceLabel('all')).toBe('All Subscribers')
    expect(getAudienceLabel('supporters')).toBe('Supporters+')
    expect(getAudienceLabel('vips')).toBe('VIPs Only')
  })

  it('updates draft state and clears draft', () => {
    const store = useUpdatesStore.getState()
    store.setDraft({ caption: 'Hello', audience: 'all', mediaType: 'text' })
    expect(useUpdatesStore.getState().draft?.caption).toBe('Hello')

    store.updateDraft({ caption: 'Updated' })
    expect(useUpdatesStore.getState().draft?.caption).toBe('Updated')

    store.clearDraft()
    expect(useUpdatesStore.getState().draft).toBe(null)
  })
})

