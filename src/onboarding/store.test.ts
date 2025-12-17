import { describe, expect, it } from 'vitest'
import { useOnboardingStore } from './store'

describe('onboarding/store', () => {
  it('hydrates from server data for resume flows', () => {
    const store = useOnboardingStore.getState()
    store.reset()

    // Local state before hydration
    store.setName('Local Name')
    store.setCountry('Local Country', 'LC')
    store.setUsername('local_user')
    expect(useOnboardingStore.getState().currentStep).toBe(0)

    store.hydrateFromServer({
      step: 5,
      branch: 'service',
      data: {
        name: 'Server Name',
        country: 'Server Country',
        countryCode: 'SC',
        currency: 'USD',
        username: 'server_user',
        bio: 'Server bio',
        serviceDescription: 'I do consulting',
        serviceCredential: '10 years',
        feeMode: 'pass_to_subscriber',
      },
    })

    const hydrated = useOnboardingStore.getState()
    expect(hydrated.currentStep).toBe(5)
    expect(hydrated.branch).toBe('service')
    // Server wins for key fields
    expect(hydrated.name).toBe('Server Name')
    expect(hydrated.country).toBe('Server Country')
    expect(hydrated.countryCode).toBe('SC')
    expect(hydrated.username).toBe('server_user')
    expect(hydrated.bio).toBe('Server bio')
    expect(hydrated.bio).toBe('Server bio')
    expect(hydrated.serviceDescription).toBe('I do consulting')
    expect(hydrated.serviceCredential).toBe('10 years')
    expect(hydrated.feeMode).toBe('pass_to_subscriber')
  })

  it('reset returns to initial state', () => {
    const store = useOnboardingStore.getState()
    store.setEmail('test@example.com')
    store.setOtp('123456')
    store.setName('Alice')
    store.nextStep()

    store.reset()
    const reset = useOnboardingStore.getState()
    expect(reset.email).toBe('')
    expect(reset.otp).toBe('')
    expect(reset.name).toBe('')
    expect(reset.currentStep).toBe(0)
  })
})

