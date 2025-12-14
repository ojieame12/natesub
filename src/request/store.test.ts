import { describe, expect, it } from 'vitest'
import {
  getDefaultMessage,
  getRelationshipLabel,
  getSuggestedAmounts,
  useRequestStore,
} from './store'

describe('request/store', () => {
  it('maps relationship types to display labels', () => {
    expect(getRelationshipLabel('family_mom')).toBe('Mom')
    expect(getRelationshipLabel('client_referral')).toBe('Referral')
    expect(getRelationshipLabel(null)).toBe('')
  })

  it('returns suggested amounts based on relationship category', () => {
    expect(getSuggestedAmounts(null)).toEqual([5, 10, 25, 50])
    expect(getSuggestedAmounts('family_other')).toEqual([20, 50, 100, 200])
    expect(getSuggestedAmounts('friend_close')).toEqual([5, 10, 15, 25])
    expect(getSuggestedAmounts('client')).toEqual([25, 50, 100, 250])
    expect(getSuggestedAmounts('fan')).toEqual([5, 10, 15, 25])
    expect(getSuggestedAmounts('partner')).toEqual([25, 50, 100, 150])
    expect(getSuggestedAmounts('other')).toEqual([5, 10, 25, 50])
  })

  it('generates a default message using recipient name, relationship, and amount', () => {
    const msg = getDefaultMessage('Alice Johnson', 'friend_close', 25, true, '$')
    expect(msg).toContain('Alice')
    expect(msg).toContain('$25')
    expect(msg).toContain('monthly')

    const msg2 = getDefaultMessage('Bob', 'family_mom', 50, false, '£')
    expect(msg2).toContain('Mom')
    expect(msg2).toContain('£50')
  })

  it('handles store actions and reset', () => {
    const store = useRequestStore.getState()
    store.setRecipient({ id: 'r1', name: 'Alice' })
    store.setRelationship('fan')
    store.setAmount(42)
    store.togglePerk('perk-1')
    store.addCustomPerk({ id: 'cp-1', title: 'Custom perk', enabled: true })

    const after = useRequestStore.getState()
    expect(after.recipient?.name).toBe('Alice')
    expect(after.relationship).toBe('fan')
    expect(after.amount).toBe(42)
    expect(after.selectedPerks).toEqual(['perk-1'])
    expect(after.customPerks).toHaveLength(1)

    store.reset()
    const reset = useRequestStore.getState()
    expect(reset.recipient).toBe(null)
    expect(reset.relationship).toBe(null)
    expect(reset.amount).toBe(10)
    expect(reset.selectedPerks).toEqual([])
    expect(reset.customPerks).toEqual([])
  })
})

