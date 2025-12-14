import { describe, expect, it } from 'vitest'
import {
  centsToDollars,
  dollarsToCents,
  formatAmount,
  mapApiToOnboarding,
  mapApiToUpdate,
  mapOnboardingToApi,
  mapRelationshipToApi,
  mapRequestToApi,
  mapUpdateToApi,
} from './mappers'

describe('api/mappers', () => {
  it('converts dollars <-> cents', () => {
    expect(dollarsToCents(10)).toBe(1000)
    expect(dollarsToCents(10.555)).toBe(1056)
    expect(centsToDollars(1056)).toBeCloseTo(10.56, 5)
  })

  it('formats amounts for display', () => {
    expect(formatAmount(1000, true, 'USD')).toBe('$10.00')
    expect(formatAmount(10, false, 'USD')).toBe('$10.00')
  })

  it('maps relationship types to backend enums', () => {
    expect(mapRelationshipToApi(null)).toBe('other')
    expect(mapRelationshipToApi('family_mom')).toBe('family')
    expect(mapRelationshipToApi('friend_close')).toBe('friend')
    expect(mapRelationshipToApi('client_referral')).toBe('client')
    expect(mapRelationshipToApi('fan')).toBe('fan')
    expect(mapRelationshipToApi('partner')).toBe('partner')
  })

  it('maps onboarding store data to API profile payload', () => {
    const payload = mapOnboardingToApi({
      name: 'Alice',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'service',
      pricingModel: 'tiers',
      singleAmount: null,
      tiers: [
        { id: 't1', name: 'Basic', amount: 10, perks: ['A'] },
        { id: 't2', name: 'Pro', amount: 25, perks: ['A', 'B'], isPopular: true },
      ],
      impactItems: [{ id: 'i1', title: 'Impact', subtitle: 'Sub' }],
      perks: [
        { id: 'p1', title: 'Perk 1', enabled: true },
        { id: 'p2', title: 'Perk 2', enabled: false },
      ],
      voiceIntroUrl: 'https://example.com/voice.mp3',
      bio: 'Hello',
      username: 'alice',
      avatarUrl: 'https://example.com/a.jpg',
    })

    expect(payload.displayName).toBe('Alice')
    expect(payload.purpose).toBe('service')
    expect(payload.singleAmount).toBe(null)
    expect(payload.tiers?.[0]?.amount).toBe(1000)
    expect(payload.tiers?.[1]?.amount).toBe(2500)
    // Perks only null if none enabled
    expect(payload.perks).not.toBe(null)
    expect(payload.impactItems).not.toBe(null)
  })

  it('maps API profile payload to onboarding store shape', () => {
    const storeData = mapApiToOnboarding({
      username: 'alice',
      displayName: 'Alice',
      bio: null,
      avatarUrl: null,
      voiceIntroUrl: null,
      country: 'US',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'service',
      pricingModel: 'single',
      singleAmount: 2500,
      tiers: null,
      perks: null,
      impactItems: null,
    })

    expect(storeData.name).toBe('Alice')
    expect(storeData.singleAmount).toBe(25)
    expect(storeData.tiers).toEqual([])
    expect(storeData.perks).toEqual([])
    expect(storeData.impactItems).toEqual([])
    expect(storeData.bio).toBe('')
  })

  it('maps request store data to API payload, including dueDate end-of-day', () => {
    const payload = mapRequestToApi({
      recipient: { id: 'r1', name: 'Bob', email: 'bob@example.com' },
      relationship: 'client_new',
      amount: 12.34,
      isRecurring: true,
      message: 'Hi',
      voiceNoteUrl: 'https://example.com/voice.webm',
      customPerks: [
        { id: 'cp1', title: 'One', enabled: true },
        { id: 'cp2', title: 'Two', enabled: false },
      ],
      dueDate: '2025-01-01',
    }, 'USD')

    expect(payload?.recipientName).toBe('Bob')
    expect(payload?.relationship).toBe('client')
    expect(payload?.amountCents).toBe(1234)
    expect(payload?.voiceUrl).toBe('https://example.com/voice.webm')
    expect(payload?.customPerks).toEqual(['One'])
    expect(payload?.dueDate).toBe('2025-01-01T23:59:59.000Z')
  })

  it('returns null request payload when no recipient is set', () => {
    expect(mapRequestToApi({
      recipient: null,
      relationship: null,
      amount: 10,
      isRecurring: true,
      message: '',
      voiceNoteUrl: null,
      customPerks: [],
      dueDate: null,
    })).toBe(null)
  })

  it('maps update store data to API payload and back', () => {
    const apiPayload = mapUpdateToApi({
      caption: 'Hello',
      mediaUrl: 'https://example.com/photo.jpg',
      audience: 'supporters',
    }, 'My title')

    expect(apiPayload).toEqual({
      title: 'My title',
      body: 'Hello',
      photoUrl: 'https://example.com/photo.jpg',
      audience: 'supporters',
    })

    const storePayload = mapApiToUpdate({
      body: 'Body',
      photoUrl: 'https://example.com/x.png',
      audience: 'all',
    })

    expect(storePayload).toEqual({
      caption: 'Body',
      mediaUrl: 'https://example.com/x.png',
      audience: 'all',
    })
  })
})

