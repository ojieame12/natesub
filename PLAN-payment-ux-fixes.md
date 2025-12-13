# Payment Flow UX Fixes Plan

## Overview
Fix loading states, transitions, animations, and UX issues across Stripe/Paystack payment flows.

---

## Phase 1: Critical Fixes

### 1.1 Payment Button Loading States
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Replace "Loading..." text with `<Loader2 size={18} className="spin" />` spinner
- Use consistent loading indicator across both Stripe and Paystack buttons
- Ensure button width is fixed to prevent layout shift

### 1.2 Full-Screen Redirect Loading Overlay
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Add `isRedirecting` state that activates after checkout URL is received
- Create full-screen overlay with spinner and "Redirecting to payment..." text
- Prevent any interaction while redirecting

### 1.3 Bank Dropdown Outside Click
**Files:** `src/onboarding/PaystackConnect.tsx`
- Add `useEffect` with document click listener
- Close dropdown when clicking outside the dropdown container
- Use `useRef` to track dropdown element

### 1.4 Pass AbortSignal to API Calls
**Files:** `src/PaymentSettings.tsx`
- Pass `signal: abortController.signal` to fetch calls
- Update API client to accept abort signal (if not already supported)

---

## Phase 2: High Priority Fixes

### 2.1 View Transition Animations
**Files:** `src/subscribe/SubscribeBoundary.tsx`, `src/subscribe/template-one.css`
- Add CSS transitions for view changes using `transform` and `opacity`
- Track `previousView` and `direction` (left/right) for slide direction
- Add `.sub-view-enter`, `.sub-view-exit` animation classes
- Use 300ms transition duration

### 2.2 Account Verification Typing Indicator
**Files:** `src/onboarding/PaystackConnect.tsx`
- Add `isTyping` state that activates on input change
- Show "Will verify when you stop typing..." during debounce period
- Clear typing state when verification starts

### 2.3 Remove or Implement Voice Player
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Option A: Implement actual audio playback with `<audio>` element
- Option B: Remove voice player UI entirely if not needed
- Recommendation: Implement basic audio player with play/pause

### 2.4 Polling Progress Indicator
**Files:** `src/StripeComplete.tsx`
- Add `pollAttempts` state to track progress
- Show progress text: "Checking... (attempt 3 of 12)"
- After max attempts, show "Verification is taking longer than expected" with manual retry button

### 2.5 Format Requirements in Error State
**Files:** `src/StripeComplete.tsx`
- Import/create `formatRequirement()` function (already exists in PaymentSettings)
- Apply formatting to requirements list in error state
- Move helper to shared utils file

### 2.6 Skeleton Loading States
**Files:** `src/PaymentSettings.tsx`, `src/components/Skeleton.tsx` (new)
- Create reusable Skeleton component with pulse animation
- Add skeleton layout matching dashboard structure
- Show skeleton while loading instead of just spinner

---

## Phase 3: Medium Priority Fixes

### 3.1 Consistent Loading Indicators
**Files:** Multiple
- Audit all loading states and standardize on `<Loader2 className="spin" />`
- Remove custom `.sub-spinner` CSS, use Loader2 everywhere
- Create shared `<LoadingSpinner size="sm|md|lg" />` component if needed

### 3.2 Safe Back Navigation
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Replace `navigate(-1)` with `navigate('/')` or known fallback
- Check `window.history.length` to determine if back is safe

### 3.3 Longer Copy Feedback
**Files:** `src/StripeComplete.tsx`
- Increase copied timeout from 2000ms to 3000ms
- Add subtle animation on checkmark appearance

### 3.4 Haptic Feedback on Swipe
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Import Capacitor Haptics plugin
- Add `Haptics.impact({ style: 'light' })` on successful swipe
- Wrap in try-catch for web fallback

### 3.5 Remove Empty Payout Row Click
**Files:** `src/PaymentSettings.tsx`
- Remove `Pressable` wrapper from payout history rows
- Or add actual navigation to payout detail view

### 3.6 Reduced Motion Support
**Files:** `src/subscribe/SubscribeBoundary.tsx`, CSS files
- Wrap Lottie in `prefersReducedMotion` check
- Add `@media (prefers-reduced-motion: reduce)` CSS rules
- Disable or simplify animations for accessibility

### 3.7 Verification Retry Button
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Change "Try Again" to actually retry Paystack verification
- Add `handleRetryVerification()` function
- Only navigate away after 3 failed retries

### 3.8 Disable Button Until Redirect
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Keep button disabled from click until page unloads
- Use `isRedirecting` state (from 1.2) to maintain disabled state

---

## Phase 4: Low Priority Fixes

### 4.1 Dropdown Focus Trap
**Files:** `src/onboarding/PaystackConnect.tsx`
- Add keyboard event handlers for arrow keys, Enter, Escape
- Trap Tab key within dropdown
- Close on Escape

### 4.2 Form Keyboard Submit
**Files:** `src/onboarding/PaystackConnect.tsx`
- Wrap inputs in `<form>` with `onSubmit`
- Handle Enter key to submit when valid

### 4.3 Account Number Formatting
**Files:** `src/onboarding/PaystackConnect.tsx`
- Add visual formatting (spaces every 3-4 digits) for display
- Keep actual value unformatted for API
- Use `formatAccountNumber()` helper

### 4.4 Move Inline Styles to CSS
**Files:** `src/PaymentSettings.tsx`, `src/PaymentSettings.css`
- Extract inline styles to CSS classes
- Create semantic class names
- Maintain existing visual design

### 4.5 Ensure External Links Open New Tab
**Files:** `src/PaymentSettings.tsx`
- Audit all `window.open` calls
- Ensure `'_blank'` is second parameter
- Add `noopener noreferrer` to link rels

### 4.6 Offline Detection
**Files:** `src/subscribe/SubscribeBoundary.tsx`
- Add `navigator.onLine` check before checkout
- Show toast if offline: "You appear to be offline"
- Disable payment buttons when offline

---

## New Files to Create

1. `src/components/Skeleton.tsx` - Reusable skeleton loading component
2. `src/components/RedirectOverlay.tsx` - Full-screen redirect loading state
3. `src/utils/requirements.ts` - Shared requirement formatting helper
4. `src/hooks/useClickOutside.ts` - Reusable outside click hook

---

## Testing Checklist

- [ ] Subscribe flow: all view transitions smooth
- [ ] Subscribe flow: payment button shows spinner
- [ ] Subscribe flow: redirect shows overlay
- [ ] Paystack onboarding: dropdown closes on outside click
- [ ] Paystack onboarding: typing indicator shows during debounce
- [ ] Stripe complete: polling shows progress
- [ ] Stripe complete: error shows formatted requirements
- [ ] Payment settings: skeleton loading appears
- [ ] All: reduced motion preference respected
- [ ] All: keyboard navigation works
- [ ] All: no console errors

---

## Estimated Scope

- **Phase 1 (Critical):** 4 fixes
- **Phase 2 (High):** 6 fixes
- **Phase 3 (Medium):** 8 fixes
- **Phase 4 (Low):** 6 fixes
- **Total:** 24 fixes across ~8 files
