# Public Subscriber Portal - V1 Spec

## Overview

A public, always-on URL where subscribers can view and manage all their subscriptions across all creators without logging in or finding email links.

**URL:** `/subscriptions`

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  /subscriptions                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────┐                       │
│  │  Manage Your Subscriptions           │                       │
│  │                                       │                       │
│  │  Enter your email to view and        │                       │
│  │  manage all your subscriptions.      │                       │
│  │                                       │                       │
│  │  ┌────────────────────────────────┐  │                       │
│  │  │ email@example.com              │  │                       │
│  │  └────────────────────────────────┘  │                       │
│  │                                       │                       │
│  │  [      Continue      ]              │                       │
│  │                                       │                       │
│  └──────────────────────────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Enter Verification Code                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  We sent a 6-digit code to j***n@example.com                    │
│                                                                  │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐               │
│  │  1  │ │  2  │ │  3  │ │  4  │ │  5  │ │  6  │               │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘               │
│                                                                  │
│  Didn't receive it? [Resend]                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Your Subscriptions                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  j***n@example.com                         [Sign out]           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 👤 Creator Name                                             │ │
│  │    $10.00/month · Active                                    │ │
│  │    Next billing: Jan 15, 2025                               │ │
│  │    Statement: CREATORNAME                                   │ │
│  │                                        [Manage →]           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 👤 Another Creator                                          │ │
│  │    ₦5,000/month · Payment failed                           │ │
│  │    Action required                                          │ │
│  │                                        [Manage →]           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 👤 Past Creator                                             │ │
│  │    $5.00/month · Canceled                                   │ │
│  │    Access until: Dec 31, 2024                               │ │
│  │                                        [Resubscribe →]      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  No more subscriptions.                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (click Manage)
┌─────────────────────────────────────────────────────────────────┐
│  Subscription Details (inline expand or modal)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ← Back                                                         │
│                                                                  │
│  👤 Creator Name                                                │
│     $10.00/month                                                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Status          Active                                      │ │
│  │ Member since    March 2024 (10 months)                      │ │
│  │ Total paid      $100.00                                     │ │
│  │ Next billing    Jan 15, 2025                                │ │
│  │ Statement as    CREATORNAME                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [💳 Update Payment Method]     (Stripe only)                   │
│  [✕ Cancel Subscription]                                        │
│                                                                  │
│  Payment History                                                │
│  ├─ Dec 15, 2024   $10.00  ✓                                   │
│  ├─ Nov 15, 2024   $10.00  ✓                                   │
│  └─ Oct 15, 2024   $10.00  ✓                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### 1. Send OTP

```
POST /subscriber/otp
```

**Request:**
```json
{
  "email": "subscriber@example.com"
}
```

**Response (always 200, generic message):**
```json
{
  "message": "If this email has subscriptions, you'll receive a verification code."
}
```

**Security:**
- Rate limit: 3 requests per email per 15 minutes
- Rate limit: 10 requests per IP per 15 minutes
- OTP TTL: 10 minutes
- Max attempts: 5 per OTP

**Implementation:**
- Query `User` by email where user has at least one subscription as subscriber
- If found, generate 6-digit OTP, store in Redis/DB with TTL
- Send email with OTP
- Always return same response (no email enumeration)

---

### 2. Verify OTP

```
POST /subscriber/verify
```

**Request:**
```json
{
  "email": "subscriber@example.com",
  "otp": "123456"
}
```

**Response (success):**
```json
{
  "success": true,
  "expiresAt": "2025-01-01T12:00:00Z"
}
```

**Response (failure):**
```json
{
  "error": "Invalid or expired code",
  "attemptsRemaining": 2
}
```

**On success:**
- Set `subscriber_session` cookie:
  - Value: signed JWT with `{ email, type: 'subscriber_portal', exp: 1hr }`
  - `httpOnly: true`
  - `secure: true`
  - `sameSite: 'strict'`
  - `maxAge: 3600` (1 hour)
- Delete OTP from store

---

### 3. List Subscriptions

```
GET /subscriber/subscriptions
```

**Auth:** `subscriber_session` cookie required

**Response:**
```json
{
  "email": "subscriber@example.com",
  "maskedEmail": "s***r@example.com",
  "subscriptions": [
    {
      "id": "sub_123",
      "creator": {
        "displayName": "Creator Name",
        "username": "creatorname",
        "avatarUrl": "https://..."
      },
      "amount": 10.00,
      "currency": "USD",
      "interval": "month",
      "status": "active",
      "statusLabel": "Active",
      "currentPeriodEnd": "2025-01-15T00:00:00Z",
      "startedAt": "2024-03-01T00:00:00Z",
      "totalPaid": 100.00,
      "paymentCount": 10,
      "provider": "stripe",
      "canUpdatePayment": true,
      "updatePaymentMethod": "portal",
      "billingDescriptor": "CREATORNAME",
      "isPastDue": false,
      "cancelAtPeriodEnd": false
    },
    {
      "id": "sub_456",
      "creator": {
        "displayName": "Another Creator",
        "username": "another",
        "avatarUrl": null
      },
      "amount": 5000,
      "currency": "NGN",
      "interval": "month",
      "status": "past_due",
      "statusLabel": "Payment failed",
      "currentPeriodEnd": "2024-12-20T00:00:00Z",
      "startedAt": "2024-06-01T00:00:00Z",
      "totalPaid": 30000,
      "paymentCount": 6,
      "provider": "paystack",
      "canUpdatePayment": false,
      "updatePaymentMethod": "resubscribe",
      "billingDescriptor": "ANOTHER",
      "isPastDue": true,
      "cancelAtPeriodEnd": false
    }
  ]
}
```

**Notes:**
- Sort by: active first, then by most recent activity
- Include canceled subscriptions that still have access (cancelAtPeriodEnd with future date)
- Do NOT include fully ended subscriptions (status=canceled AND periodEnd in past)

---

### 4. Get Subscription Details

```
GET /subscriber/subscriptions/:id
```

**Auth:** `subscriber_session` cookie required

**Response:**
```json
{
  "subscription": {
    "id": "sub_123",
    "creator": {
      "displayName": "Creator Name",
      "username": "creatorname",
      "avatarUrl": "https://..."
    },
    "amount": 10.00,
    "currency": "USD",
    "interval": "month",
    "status": "active",
    "statusLabel": "Active",
    "currentPeriodEnd": "2025-01-15T00:00:00Z",
    "startedAt": "2024-03-01T00:00:00Z",
    "createdAt": "2024-03-01T00:00:00Z",
    "totalPaid": 100.00,
    "paymentCount": 10,
    "provider": "stripe",
    "canUpdatePayment": true,
    "updatePaymentMethod": "portal",
    "billingDescriptor": "CREATORNAME",
    "isPastDue": false,
    "pastDueMessage": null,
    "cancelAtPeriodEnd": false
  },
  "payments": [
    {
      "id": "pay_1",
      "amount": 10.00,
      "currency": "USD",
      "date": "2024-12-15T00:00:00Z",
      "status": "succeeded"
    }
  ],
  "actions": {
    "resubscribeUrl": "https://natepay.co/creatorname"
  }
}
```

---

### 5. Cancel Subscription

```
POST /subscriber/subscriptions/:id/cancel
```

**Auth:** `subscriber_session` cookie required

**Request:**
```json
{
  "reason": "too_expensive",
  "comment": "Optional feedback"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Your subscription has been canceled. You'll have access until January 15, 2025.",
  "accessUntil": "2025-01-15T00:00:00Z",
  "resubscribeUrl": "https://natepay.co/creatorname"
}
```

---

### 6. Get Payment Portal URL (Stripe only)

```
GET /subscriber/subscriptions/:id/portal
```

**Auth:** `subscriber_session` cookie required

**Response:**
```json
{
  "url": "https://billing.stripe.com/session/..."
}
```

**Error (Paystack):**
```json
{
  "error": "Payment management is not available for this payment method.",
  "instructions": "To update your payment method, cancel and resubscribe with a new card.",
  "resubscribeUrl": "https://natepay.co/creatorname"
}
```

---

### 7. Sign Out

```
POST /subscriber/signout
```

**Response:**
```json
{
  "success": true
}
```

Clears `subscriber_session` cookie.

---

## Data Model Notes

### Existing Models Used
- `User` - subscriber lookup by email
- `Subscription` - where `subscriberId = user.id`
- `Payment` - for history
- `Profile` - for creator info

### No New Models Required
- OTP storage: use existing OTP mechanism or Redis key `subscriber_otp:{email}`
- Session: stateless JWT in cookie (no DB session table needed)

---

## Security Requirements

### Headers (all portal routes)
```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
X-Robots-Tag: noindex, nofollow
```

### Cookie Settings
```typescript
{
  name: 'subscriber_session',
  httpOnly: true,
  secure: true, // HTTPS only
  sameSite: 'strict',
  maxAge: 3600, // 1 hour
  path: '/subscriber' // Scoped to portal routes only
}
```

### Rate Limiting
| Endpoint | Per Email | Per IP |
|----------|-----------|--------|
| POST /subscriber/otp | 3/15min | 10/15min |
| POST /subscriber/verify | 5 attempts per OTP | 20/15min |
| GET /subscriber/* | - | 100/min |
| POST /subscriber/*/cancel | 5/hour | 20/hour |

### Audit Logging
Log all actions with:
- Email (masked in logs)
- Subscription ID
- Action type
- IP address
- User agent
- Timestamp

---

## Frontend Components

### New Files
```
src/subscriber/
├── SubscriberPortal.tsx      # Main page component
├── EmailStep.tsx             # Email input form
├── OtpStep.tsx               # OTP verification
├── SubscriptionsList.tsx     # List view
├── SubscriptionCard.tsx      # Individual subscription card
├── SubscriptionDetail.tsx    # Expanded detail view
└── hooks/
    └── useSubscriberSession.ts  # Session state management
```

### Route
```tsx
// App.tsx
<Route path="/subscriptions" element={<SubscriberPortal />} />
```

Add to public routes list (no auth required).

---

## Email Template

### Subject
```
Your verification code: {code}
```

### Body
```
Hi,

Your verification code is: {code}

This code expires in 10 minutes.

If you didn't request this, you can safely ignore this email.
```

---

## Status Label Mapping

| Status | cancelAtPeriodEnd | Label | Color |
|--------|-------------------|-------|-------|
| active | false | Active | Green |
| active | true | Canceling | Yellow |
| past_due | - | Payment failed | Red |
| canceled | - | Canceled | Gray |
| trialing | - | Trial | Blue |

---

## Edge Cases

1. **No subscriptions found**: Show friendly empty state with "You don't have any active subscriptions."

2. **All subscriptions canceled**: Show them with "Resubscribe" option.

3. **Mixed currencies**: Display each in its own currency, no totals across currencies.

4. **Session expires mid-action**: Return 401, frontend redirects to email step with message "Session expired, please verify again."

5. **Subscription deleted while viewing**: Return 404 on detail/action endpoints.

---

## Implementation Order

1. **Backend OTP/Verify** - `POST /subscriber/otp`, `POST /subscriber/verify`
2. **Backend List** - `GET /subscriber/subscriptions`
3. **Frontend Email + OTP** - Basic flow working
4. **Frontend List View** - Show subscriptions
5. **Backend Detail + Actions** - Cancel, portal
6. **Frontend Detail + Actions** - Complete flow
7. **Security hardening** - Rate limits, headers, logging
8. **Email template** - Styled OTP email

---

## Out of Scope (V2)

- Download invoices/receipts
- Update email address
- Notification preferences
- Multiple emails per person
- Deep link from app to portal
