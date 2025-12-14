import { describe, expect, it } from 'vitest'
import {
  PUBLIC_DOMAIN,
  PUBLIC_PAGE_URL,
  getPublicPageUrl,
  getShareableLink,
  getShareableLinkFull,
  isReservedUsername,
} from './constants'

describe('utils/constants', () => {
  it('treats reserved usernames as unavailable (case-insensitive)', () => {
    expect(isReservedUsername('dashboard')).toBe(true)
    expect(isReservedUsername('Dashboard')).toBe(true)
    expect(isReservedUsername('onboarding')).toBe(true)
    expect(isReservedUsername('some_creator')).toBe(false)
  })

  it('builds public page URLs and share links', () => {
    expect(getPublicPageUrl('alice')).toBe(`${PUBLIC_PAGE_URL}/alice`)
    expect(getShareableLink('alice')).toBe(`${PUBLIC_DOMAIN}/alice`)
    expect(getShareableLinkFull('alice')).toBe(`https://${PUBLIC_DOMAIN}/alice`)
  })
})
