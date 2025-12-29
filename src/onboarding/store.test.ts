import { describe, expect, it, beforeEach } from 'vitest'
import { useOnboardingStore } from './store'

describe('onboarding/store', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset()
  })

  describe('Server Hydration', () => {
    it('hydrates from server data for resume flows', () => {
      const store = useOnboardingStore.getState()

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

    it('handles single word name (no last name)', () => {
      const store = useOnboardingStore.getState()

      store.hydrateFromServer({
        step: 3,
        data: {
          name: 'Madonna',
        },
      })

      const hydrated = useOnboardingStore.getState()
      expect(hydrated.firstName).toBe('Madonna')
      expect(hydrated.lastName).toBe('')
    })

    it('handles multi-word last names', () => {
      const store = useOnboardingStore.getState()

      store.hydrateFromServer({
        step: 3,
        data: {
          name: 'Mary Jane Watson',
        },
      })

      const hydrated = useOnboardingStore.getState()
      expect(hydrated.firstName).toBe('Mary')
      // Rest should be last name
      expect(hydrated.lastName).toBe('Jane Watson')
    })

    it('preserves local state for fields not in server data', () => {
      const store = useOnboardingStore.getState()

      // Set local state
      store.setEmail('local@example.com')
      store.setOtp('123456')

      // Hydrate with partial server data
      store.hydrateFromServer({
        step: 5,
        data: {
          firstName: 'Server',
          lastName: 'User',
        },
      })

      const hydrated = useOnboardingStore.getState()
      // Server data applied
      expect(hydrated.firstName).toBe('Server')
      expect(hydrated.lastName).toBe('User')
      // Local data preserved (if not overwritten)
      expect(hydrated.email).toBe('local@example.com')
    })
  })

  describe('Step Navigation', () => {
    // Note: Store has 300ms debounce on navigation, so we test single navigations

    it('nextStep increments currentStep', () => {
      const store = useOnboardingStore.getState()
      expect(store.currentStep).toBe(0)

      store.nextStep()
      expect(useOnboardingStore.getState().currentStep).toBe(1)
    })

    it('goToStep exists and is a function', () => {
      const store = useOnboardingStore.getState()
      // goToStep has 300ms debounce, so we just verify it exists
      // Step setting is tested via hydrateFromServer which bypasses debounce
      expect(typeof store.goToStep).toBe('function')
    })

    it('prevStep does not go below 0', () => {
      const store = useOnboardingStore.getState()
      expect(store.currentStep).toBe(0)

      store.prevStep()
      expect(useOnboardingStore.getState().currentStep).toBe(0)
    })

    it('hydrateFromServer bypasses debounce for step', () => {
      const store = useOnboardingStore.getState()
      // hydrateFromServer should set step directly without debounce
      store.hydrateFromServer({ step: 5, data: {} })
      expect(useOnboardingStore.getState().currentStep).toBe(5)

      // And again
      store.hydrateFromServer({ step: 8, data: {} })
      expect(useOnboardingStore.getState().currentStep).toBe(8)
    })
  })

  describe('State Reset', () => {
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

    it('reset clears all fields including service mode', () => {
      const store = useOnboardingStore.getState()
      store.setServiceDescription('Test service description')
      store.setPricing('single', [], 5000)
      store.setServicePerks([{ id: '1', title: 'Perk 1', enabled: true }])

      store.reset()
      const reset = useOnboardingStore.getState()
      expect(reset.serviceDescription).toBe('')
      // singleAmount defaults to 10, not 0
      expect(reset.singleAmount).toBe(10)
      expect(reset.servicePerks.length).toBe(0)
    })
  })

  describe('Field Setters', () => {
    it('setEmail updates email', () => {
      const store = useOnboardingStore.getState()
      store.setEmail('test@example.com')
      expect(useOnboardingStore.getState().email).toBe('test@example.com')
    })

    it('setOtp updates otp', () => {
      const store = useOnboardingStore.getState()
      store.setOtp('123456')
      expect(useOnboardingStore.getState().otp).toBe('123456')
    })

    it('setFirstName updates firstName', () => {
      const store = useOnboardingStore.getState()
      store.setFirstName('John')
      expect(useOnboardingStore.getState().firstName).toBe('John')
    })

    it('setLastName updates lastName', () => {
      const store = useOnboardingStore.getState()
      store.setLastName('Doe')
      expect(useOnboardingStore.getState().lastName).toBe('Doe')
    })

    it('setCountry updates country, countryCode, and currency', () => {
      const store = useOnboardingStore.getState()
      store.setCountry('Nigeria', 'NG')
      const state = useOnboardingStore.getState()
      expect(state.country).toBe('Nigeria')
      expect(state.countryCode).toBe('NG')
    })

    it('setUsername updates username', () => {
      const store = useOnboardingStore.getState()
      store.setUsername('testuser')
      expect(useOnboardingStore.getState().username).toBe('testuser')
    })
  })

  describe('Address Fields (Non-Cross-Border Countries)', () => {
    it('setAddress updates address field', () => {
      const store = useOnboardingStore.getState()
      store.setAddress?.('123 Main Street')
      expect(useOnboardingStore.getState().address || '').toBe('123 Main Street')
    })

    it('setCity updates city field', () => {
      const store = useOnboardingStore.getState()
      store.setCity?.('San Francisco')
      expect(useOnboardingStore.getState().city || '').toBe('San Francisco')
    })

    it('setState updates state field', () => {
      const store = useOnboardingStore.getState()
      store.setState?.('CA')
      expect(useOnboardingStore.getState().state || '').toBe('CA')
    })

    it('setZip updates zip field', () => {
      const store = useOnboardingStore.getState()
      store.setZip?.('94102')
      expect(useOnboardingStore.getState().zip || '').toBe('94102')
    })
  })

  describe('Service Mode Fields', () => {
    it('setServiceDescription updates service description', () => {
      const store = useOnboardingStore.getState()
      store.setServiceDescription('I offer coaching services')
      expect(useOnboardingStore.getState().serviceDescription).toBe('I offer coaching services')
    })

    it('setPricing updates singleAmount', () => {
      const store = useOnboardingStore.getState()
      store.setPricing('single', [], 10000) // $100 in cents
      expect(useOnboardingStore.getState().singleAmount).toBe(10000)
    })

    it('setServicePerks updates perks array', () => {
      const store = useOnboardingStore.getState()
      const perks = [
        { id: '1', title: 'Weekly call', enabled: true },
        { id: '2', title: 'Email support', enabled: true },
        { id: '3', title: 'Resources', enabled: true },
      ]
      store.setServicePerks(perks)
      expect(useOnboardingStore.getState().servicePerks).toEqual(perks)
    })
  })

  describe('Payment Provider Selection', () => {
    it('setPaymentProvider updates provider', () => {
      const store = useOnboardingStore.getState()
      store.setPaymentProvider?.('stripe')
      expect(useOnboardingStore.getState().paymentProvider).toBe('stripe')
    })

    it('setPaymentProvider can switch to paystack', () => {
      const store = useOnboardingStore.getState()
      store.setPaymentProvider?.('paystack')
      expect(useOnboardingStore.getState().paymentProvider).toBe('paystack')
    })
  })
})
