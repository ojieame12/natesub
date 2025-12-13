# Auth & Security Production Readiness Plan

## Overview
Comprehensive plan to bring auth, session management, and security from 4/10 to 9/10 production readiness.

**Current State:** Critical vulnerabilities, not production ready
**Target State:** Secure, reliable, production-grade auth system

---

## Phase 1: Critical Security (Days 1-2)
*Launch blockers - must complete before any production release*

### 1.1 Secure Token Storage (Mobile)
**Problem:** Tokens stored in localStorage, readable by any script/app

**Files to modify:**
- `src/api/client.ts`
- `capacitor.config.ts`
- `package.json`

**Implementation:**
```
1. Install @capacitor-community/secure-storage-plugin
2. Create src/utils/secureStorage.ts abstraction layer
3. Replace all localStorage token calls with secure storage
4. Fallback to localStorage for web (with warning in dev)
5. Migrate existing tokens on app update
```

**Acceptance Criteria:**
- [ ] Tokens stored in iOS Keychain on mobile
- [ ] Tokens stored in Android EncryptedSharedPreferences
- [ ] Web falls back to localStorage with HttpOnly cookie option
- [ ] Migration handles existing users seamlessly

---

### 1.2 Token Refresh Mechanism
**Problem:** No refresh tokens, expiry = hard logout

**Files to modify:**
- `src/api/client.ts`
- `src/api/hooks.ts`
- Backend: `src/routes/auth.ts`

**Implementation:**
```
1. Backend: Issue refresh token (7 days) + access token (15 min)
2. Backend: POST /auth/refresh endpoint
3. Client: Store refresh token separately (secure storage)
4. Client: Auto-refresh access token when <5 min remaining
5. Client: Queue requests during refresh, replay after
6. Client: If refresh fails, trigger logout flow
```

**Token Structure:**
```typescript
interface TokenPair {
  accessToken: string    // JWT, 15 min expiry
  refreshToken: string   // Opaque, 7 day expiry
  expiresAt: number      // Unix timestamp
}
```

**Acceptance Criteria:**
- [ ] Access tokens expire in 15 minutes
- [ ] Refresh tokens expire in 7 days
- [ ] Auto-refresh happens transparently
- [ ] Failed refresh triggers clean logout
- [ ] No request failures during token refresh

---

### 1.3 Session Timeout
**Problem:** Users stay logged in forever

**Files to modify:**
- `src/App.tsx`
- `src/hooks/useActivityTimeout.ts` (new)
- `src/api/client.ts`

**Implementation:**
```
1. Create useActivityTimeout hook
2. Track last activity (click, keypress, touch, scroll)
3. Show warning modal at 25 min of inactivity
4. Auto-logout at 30 min of inactivity
5. Reset timer on any user interaction
6. Persist last activity timestamp to detect stale sessions on app resume
```

**Acceptance Criteria:**
- [ ] Warning shown at 25 min inactivity
- [ ] Auto-logout at 30 min inactivity
- [ ] Timer resets on user interaction
- [ ] Works across browser tabs
- [ ] Works on mobile app resume

---

### 1.4 Server-Side Rate Limiting
**Problem:** Brute force attacks possible on OTP

**Files to modify:**
- Backend: `src/routes/auth.ts`
- Backend: `src/middleware/rateLimit.ts`

**Implementation:**
```
1. Rate limit /auth/magic-link: 5 requests per email per hour
2. Rate limit /auth/verify: 10 attempts per email per 15 min
3. Rate limit by IP: 100 auth requests per hour
4. Implement exponential backoff after failures
5. Return clear error messages with retry-after header
6. Log all rate limit hits for monitoring
```

**Rate Limit Tiers:**
```
Endpoint              | Limit           | Window  | Key
---------------------|-----------------|---------|------------
POST /auth/magic-link | 5 per email     | 1 hour  | email
POST /auth/verify     | 10 per email    | 15 min  | email
All /auth/*           | 100 per IP      | 1 hour  | IP
```

**Acceptance Criteria:**
- [ ] Cannot request >5 magic links per hour per email
- [ ] Cannot attempt >10 OTP verifications per 15 min
- [ ] Rate limit headers returned (X-RateLimit-*)
- [ ] Clear user-facing error messages
- [ ] Alerts triggered on suspicious activity

---

## Phase 2: Auth Flow Hardening (Days 3-4)

### 2.1 OTP Security Improvements
**Problem:** OTP can be reused, no clear expiry, enumeration possible

**Files to modify:**
- Backend: `src/services/auth.ts`
- Backend: `src/routes/auth.ts`
- `src/onboarding/OtpStep.tsx`

**Implementation:**
```
1. OTP expires after 10 minutes (server-side)
2. OTP invalidated after first successful use
3. OTP invalidated after 5 failed attempts
4. Show countdown timer on frontend (10:00 → 0:00)
5. Generic error for invalid/expired/used OTP
6. Don't reveal if email exists (same response for unknown email)
```

**Acceptance Criteria:**
- [ ] OTP expires in 10 minutes
- [ ] OTP is one-time use only
- [ ] 5 failed attempts locks OTP
- [ ] Frontend shows countdown
- [ ] No account enumeration possible

---

### 2.2 CSRF Protection
**Problem:** State-changing operations vulnerable to CSRF

**Files to modify:**
- Backend: `src/middleware/csrf.ts` (new)
- Backend: `src/index.ts`
- `src/api/client.ts`

**Implementation:**
```
1. Generate CSRF token on session start
2. Include token in meta tag or cookie
3. Send token in X-CSRF-Token header for mutations
4. Validate token server-side for POST/PUT/DELETE
5. Exempt webhook endpoints (use signature verification instead)
```

**Acceptance Criteria:**
- [ ] All mutations require valid CSRF token
- [ ] Token rotates per session
- [ ] Clear error on CSRF failure
- [ ] Webhooks exempt but signature-verified

---

### 2.3 Multi-Device Session Management
**Problem:** No way to see/revoke other sessions

**Files to modify:**
- Backend: `src/models/Session.ts` (new)
- Backend: `src/routes/auth.ts`
- `src/Settings.tsx`
- `src/api/hooks.ts`

**Implementation:**
```
1. Create sessions table (id, userId, token, device, ip, lastActive, createdAt)
2. Track device info on login (user agent, IP)
3. GET /auth/sessions - list all active sessions
4. DELETE /auth/sessions/:id - revoke specific session
5. DELETE /auth/sessions - revoke all sessions (logout everywhere)
6. Add "Active Sessions" section to Settings
```

**Session Model:**
```typescript
interface Session {
  id: string
  userId: string
  tokenHash: string
  deviceName: string
  deviceType: 'ios' | 'android' | 'web'
  ipAddress: string
  lastActiveAt: Date
  createdAt: Date
}
```

**Acceptance Criteria:**
- [ ] Users can see all active sessions
- [ ] Users can revoke individual sessions
- [ ] "Logout everywhere" functionality
- [ ] Current session highlighted
- [ ] Device info shown (iOS, Chrome, etc.)

---

## Phase 3: State Management Fixes (Days 5-6)

### 3.1 Auth State Machine
**Problem:** Race conditions between AuthRedirect, AuthErrorHandler, RequireAuth

**Files to modify:**
- `src/App.tsx`
- `src/auth/AuthStateMachine.ts` (new)
- `src/auth/AuthProvider.tsx` (new)

**Implementation:**
```
1. Create XState machine for auth states
2. States: idle, checking, authenticated, unauthenticated, refreshing, error
3. Single source of truth for auth state
4. Replace imperative effects with state transitions
5. All components subscribe to machine state
```

**State Machine:**
```
States:
- idle: Initial state, no auth check yet
- checking: Validating token with server
- authenticated: Valid session, user data loaded
- unauthenticated: No valid session
- refreshing: Token refresh in progress
- error: Auth system error

Transitions:
- idle → checking: On app mount
- checking → authenticated: Valid token
- checking → unauthenticated: No/invalid token
- authenticated → refreshing: Token near expiry
- refreshing → authenticated: Refresh success
- refreshing → unauthenticated: Refresh failed
- authenticated → unauthenticated: Logout or 401
```

**Acceptance Criteria:**
- [ ] Single auth state machine
- [ ] No race conditions
- [ ] Clear state transitions
- [ ] Proper loading states
- [ ] Error recovery built-in

---

### 3.2 Onboarding Store Security
**Problem:** Sensitive data stored unencrypted in localStorage

**Files to modify:**
- `src/onboarding/store.ts`
- `src/utils/encryption.ts` (new)

**Implementation:**
```
1. Remove email from persisted state (server has it after OTP)
2. Encrypt sensitive fields before persistence
3. Add data expiry (24 hours)
4. Validate schema on rehydration
5. Clear on logout
6. Add version migration support
```

**Fields to protect:**
```
Remove from persistence:
- email (not needed after verification)
- otp (never persist)

Encrypt if persisting:
- name
- bio
- voiceIntroUrl
```

**Acceptance Criteria:**
- [ ] No plaintext sensitive data in localStorage
- [ ] Data expires after 24 hours
- [ ] Schema validation on load
- [ ] Clean migration path
- [ ] Full clear on logout

---

### 3.3 Logout Flow Hardening
**Problem:** Incomplete cleanup, no server verification

**Files to modify:**
- `src/Settings.tsx`
- `src/auth/logout.ts` (new)
- `src/api/client.ts`

**Implementation:**
```
1. Create dedicated logout function
2. Call server logout first (invalidate session)
3. If server fails, continue with local cleanup after timeout
4. Clear in order: tokens, stores, cache, storage
5. Verify all cleared before redirect
6. Broadcast to other tabs via BroadcastChannel
```

**Logout Sequence:**
```
1. Show "Logging out..." state
2. POST /auth/logout (with timeout)
3. Clear secure storage (token)
4. Clear localStorage (stores)
5. Clear React Query cache
6. Broadcast logout to other tabs
7. Navigate to /onboarding
8. Verify clean state
```

**Acceptance Criteria:**
- [ ] Server session invalidated
- [ ] All local data cleared
- [ ] Other tabs notified
- [ ] Works even if server unreachable
- [ ] Clean redirect to login

---

## Phase 4: Mobile Security (Days 7-8)

### 4.1 iOS Keychain Integration
**Problem:** Tokens in localStorage, not Keychain

**Files to modify:**
- `capacitor.config.ts`
- `package.json`
- `src/utils/secureStorage.ts`
- `ios/App/Podfile`

**Implementation:**
```
1. Install @capacitor-community/secure-storage-plugin
2. Configure iOS Keychain access group
3. Create platform-aware storage abstraction
4. Migrate existing tokens on first run
5. Handle Keychain errors gracefully
```

**Acceptance Criteria:**
- [ ] Tokens in iOS Keychain
- [ ] Tokens in Android EncryptedSharedPreferences
- [ ] Graceful fallback on error
- [ ] Migration from localStorage works

---

### 4.2 App Lifecycle Handling
**Problem:** No handling of background/foreground transitions

**Files to modify:**
- `src/App.tsx`
- `src/hooks/useAppState.ts` (new)

**Implementation:**
```
1. Listen to Capacitor App state changes
2. On background: Record timestamp
3. On foreground: Check if session timed out
4. If >5 min background: Re-validate token
5. If >30 min background: Require re-auth
6. Clear sensitive UI data when backgrounding
```

**Acceptance Criteria:**
- [ ] Session re-validated on foreground
- [ ] Auto-logout after 30 min background
- [ ] Sensitive data hidden in app switcher
- [ ] Works on iOS and Android

---

### 4.3 Biometric Re-Authentication
**Problem:** No biometric auth for sensitive operations

**Files to modify:**
- `src/hooks/useBiometrics.ts` (new)
- `src/Settings.tsx`
- `src/PaymentSettings.tsx`

**Implementation:**
```
1. Install @capacitor-community/biometric-auth
2. Prompt for biometric on sensitive operations
3. Allow fallback to PIN/password
4. Make biometric lock optional (Settings toggle)
5. Require biometric after background resume (optional)
```

**Protected Operations:**
```
- Viewing payment settings
- Changing payout details
- Deleting account
- Exporting data
- (Optional) App unlock after background
```

**Acceptance Criteria:**
- [ ] Biometric prompt for sensitive operations
- [ ] Fallback to device PIN
- [ ] User can enable/disable
- [ ] Works on Face ID, Touch ID, Android fingerprint

---

## Phase 5: API Security (Days 9-10)

### 5.1 Request Signing
**Problem:** No protection against request tampering

**Files to modify:**
- `src/api/client.ts`
- Backend: `src/middleware/requestSignature.ts` (new)

**Implementation:**
```
1. Generate request signature: HMAC-SHA256(method + path + body + timestamp)
2. Include in X-Request-Signature header
3. Server validates signature
4. Reject requests >5 min old (replay protection)
5. Use per-session signing key
```

**Acceptance Criteria:**
- [ ] All requests signed
- [ ] Replay attacks prevented
- [ ] Tampering detected
- [ ] Minimal performance impact

---

### 5.2 Error Handling Improvements
**Problem:** Inconsistent error handling, information leakage

**Files to modify:**
- `src/api/client.ts`
- Backend: `src/middleware/errorHandler.ts`

**Implementation:**
```
1. Standardize error response format
2. Distinguish auth (401) vs authz (403) vs validation (400)
3. Never leak internal details in production
4. Implement retry with exponential backoff
5. Add circuit breaker for cascading failures
6. Add request timeout (30s default)
```

**Error Response Format:**
```typescript
interface ApiError {
  code: string          // Machine-readable: "AUTH_EXPIRED"
  message: string       // Human-readable: "Your session has expired"
  retryable: boolean    // Can client retry?
  retryAfter?: number   // Seconds to wait before retry
}
```

**Acceptance Criteria:**
- [ ] Consistent error format
- [ ] Clear error codes
- [ ] No internal details leaked
- [ ] Proper retry behavior
- [ ] Circuit breaker working

---

### 5.3 Security Headers
**Problem:** No CSP, weak CORS, missing security headers

**Files to modify:**
- Backend: `src/index.ts`
- `index.html`
- `vite.config.ts`

**Implementation:**
```
1. Add Content-Security-Policy header
2. Add X-Frame-Options: DENY
3. Add X-Content-Type-Options: nosniff
4. Add Strict-Transport-Security
5. Configure CORS properly (specific origins, not *)
6. Add Referrer-Policy: strict-origin-when-cross-origin
```

**Headers:**
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://api.natepay.co
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
```

**Acceptance Criteria:**
- [ ] All security headers present
- [ ] CSP blocks inline scripts
- [ ] Clickjacking prevented
- [ ] HTTPS enforced

---

## Phase 6: Monitoring & Audit (Days 11-12)

### 6.1 Auth Event Logging
**Problem:** No visibility into auth events

**Files to modify:**
- Backend: `src/services/authLog.ts` (new)
- Backend: `src/routes/auth.ts`

**Implementation:**
```
1. Log all auth events to database
2. Events: login, logout, refresh, failed_attempt, session_revoked
3. Include: userId, ip, userAgent, timestamp, success/failure
4. Create admin endpoint for viewing logs
5. Set up alerts for suspicious patterns
```

**Events to Log:**
```
- LOGIN_SUCCESS
- LOGIN_FAILED (reason: invalid_otp, expired_otp, rate_limited)
- LOGOUT
- TOKEN_REFRESH
- SESSION_REVOKED
- PASSWORD_RESET (if applicable)
- SUSPICIOUS_ACTIVITY
```

**Acceptance Criteria:**
- [ ] All auth events logged
- [ ] Logs queryable by user/time/type
- [ ] PII handled properly (hashed IPs)
- [ ] Retention policy (90 days)
- [ ] Alerts on anomalies

---

### 6.2 Security Alerts
**Problem:** No detection of attacks

**Files to modify:**
- Backend: `src/services/securityAlerts.ts` (new)

**Implementation:**
```
1. Detect: >5 failed logins per account per hour
2. Detect: >100 requests per IP per minute
3. Detect: Login from new device/location
4. Detect: Multiple sessions created rapidly
5. Send alerts via email/Slack
6. Auto-block suspicious IPs
```

**Alert Thresholds:**
```
Alert                  | Threshold          | Action
-----------------------|--------------------|-----------------
Brute force           | 10 fails/15min     | Temp lock account
DDoS attempt          | 1000 req/min/IP    | Block IP
New device login      | First time         | Email user
Impossible travel     | 2 logins far apart | Alert + verify
Session hijacking     | IP change mid-sess | Invalidate session
```

**Acceptance Criteria:**
- [ ] Real-time anomaly detection
- [ ] Automated blocking
- [ ] User notifications
- [ ] Admin dashboard
- [ ] Low false positive rate

---

## Phase 7: Testing & Validation (Days 13-14)

### 7.1 Security Testing
```
1. Penetration testing on auth endpoints
2. Token security audit (JWT best practices)
3. XSS testing (try to steal tokens)
4. CSRF testing (try cross-site mutations)
5. Rate limit testing (verify enforcement)
6. Session testing (fixation, hijacking)
```

### 7.2 Reliability Testing
```
1. Load testing on auth endpoints
2. Chaos testing (what if Redis down?)
3. Network failure testing
4. Multi-device concurrent testing
5. Token refresh under load
6. Race condition testing
```

### 7.3 Mobile Testing
```
1. iOS Keychain on multiple devices
2. Background/foreground transitions
3. App kill and restart
4. Biometric auth flows
5. Deep link security
6. Offline → online transitions
```

---

## Implementation Timeline

```
Week 1:
├── Day 1-2: Phase 1 (Critical Security)
│   ├── Secure token storage
│   ├── Token refresh mechanism
│   ├── Session timeout
│   └── Rate limiting
│
├── Day 3-4: Phase 2 (Auth Hardening)
│   ├── OTP improvements
│   ├── CSRF protection
│   └── Multi-device sessions

Week 2:
├── Day 5-6: Phase 3 (State Management)
│   ├── Auth state machine
│   ├── Store security
│   └── Logout hardening
│
├── Day 7-8: Phase 4 (Mobile Security)
│   ├── iOS Keychain
│   ├── App lifecycle
│   └── Biometric auth

Week 3:
├── Day 9-10: Phase 5 (API Security)
│   ├── Request signing
│   ├── Error handling
│   └── Security headers
│
├── Day 11-12: Phase 6 (Monitoring)
│   ├── Auth logging
│   └── Security alerts
│
├── Day 13-14: Phase 7 (Testing)
│   ├── Security testing
│   ├── Reliability testing
│   └── Mobile testing
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Token storage security | localStorage | Keychain/Secure |
| Session timeout | Never | 30 min |
| Token refresh | None | Auto every 15 min |
| Rate limiting | None | 10 OTP/15min |
| CSRF protection | None | Full |
| Multi-device logout | No | Yes |
| Security headers | 1/7 | 7/7 |
| Auth event logging | None | 100% |
| Mobile keychain | No | Yes |
| Biometric auth | No | Optional |

**Target Production Readiness: 9/10**

---

## Files to Create

```
New Files:
├── src/utils/secureStorage.ts
├── src/utils/encryption.ts
├── src/auth/AuthStateMachine.ts
├── src/auth/AuthProvider.tsx
├── src/auth/logout.ts
├── src/hooks/useActivityTimeout.ts
├── src/hooks/useAppState.ts
├── src/hooks/useBiometrics.ts
│
Backend:
├── src/middleware/csrf.ts
├── src/middleware/requestSignature.ts
├── src/models/Session.ts
├── src/services/authLog.ts
├── src/services/securityAlerts.ts
```

## Files to Modify

```
Frontend:
├── src/api/client.ts (major)
├── src/api/hooks.ts
├── src/App.tsx (major)
├── src/onboarding/store.ts
├── src/onboarding/OtpStep.tsx
├── src/Settings.tsx
├── capacitor.config.ts
├── package.json
│
Backend:
├── src/routes/auth.ts (major)
├── src/middleware/rateLimit.ts
├── src/index.ts
```

---

## Risk Mitigation

1. **Breaking existing sessions**: Implement migration path, don't invalidate all tokens at once
2. **Mobile app update timing**: Ship backend changes first, then mobile
3. **Rate limit false positives**: Start with generous limits, tighten over time
4. **Keychain migration**: Handle gracefully if Keychain unavailable
5. **Backward compatibility**: Support old tokens during transition period (1 week)

---

## Definition of Done

- [ ] All critical security issues resolved
- [ ] Token storage secure on all platforms
- [ ] Session timeout working
- [ ] Rate limiting enforced
- [ ] CSRF protection active
- [ ] Multi-device sessions manageable
- [ ] Auth events logged
- [ ] Security headers present
- [ ] Mobile security complete
- [ ] All tests passing
- [ ] Security audit passed
- [ ] Production readiness score 9/10
