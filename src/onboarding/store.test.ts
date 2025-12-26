import { describe, expect, it } from 'vitest'
import { useOnboardingStore } from './store'

describe('onboarding/store', () => {
  it('hydrates from server data for resume flows', () => {
    const store = useOnboardingStore.getState()
    store.reset()

    // Local state before hydration
    store.setFirstName('Local')
    store.setLastName('Name')
    store.setCountry('Local Country', 'LC')
    store.setUsername('local_user')
    expect(useOnboardingStore.getState().currentStep).toBe(0)

    store.hydrateFromServer({
      step: 5,
      data: {
        firstName: 'Server',
        lastName: 'Name',
        country: 'Server Country',
        countryCode: 'SC',
        currency: 'USD',
        username: 'server_user',
        bio: 'Server bio',
        feeMode: 'pass_to_subscriber',
      },
    })

    const hydrated = useOnboardingStore.getState()
    expect(hydrated.currentStep).toBe(5)
    // Server wins for key fields
    expect(hydrated.firstName).toBe('Server')
    expect(hydrated.lastName).toBe('Name')
    expect(hydrated.country).toBe('Server Country')
    expect(hydrated.countryCode).toBe('SC')
    expect(hydrated.username).toBe('server_user')
    expect(hydrated.bio).toBe('Server bio')
    expect(hydrated.feeMode).toBe('pass_to_subscriber')
  })

  it('hydrates old name field for backwards compatibility', () => {
    const store = useOnboardingStore.getState()
    store.reset()

    // Old server data with single 'name' field
    store.hydrateFromServer({
      step: 3,
      data: {
        name: 'Alice Smith',
      },
    })

    const hydrated = useOnboardingStore.getState()
    // Should split into firstName/lastName
    expect(hydrated.firstName).toBe('Alice')
    expect(hydrated.lastName).toBe('Smith')
  })

  it('reset returns to initial state', () => {
    const store = useOnboardingStore.getState()
    store.setEmail('test@example.com')
    store.setOtp('123456')
    store.setFirstName('Alice')
    store.setLastName('Smith')
    store.nextStep()

    store.reset()
    const reset = useOnboardingStore.getState()
    expect(reset.email).toBe('')
    expect(reset.otp).toBe('')
    expect(reset.firstName).toBe('')
    expect(reset.lastName).toBe('')
    expect(reset.currentStep).toBe(0)
  })
})
