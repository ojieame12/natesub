# Admin Deep Dive (Routes, Data, Accuracy, Stability)

This is a focused audit of the **Admin Dashboard**: every view/route/request, what it depends on (DB vs provider APIs), why numbers can diverge from Stripe/Paystack dashboards, common crash causes, and the highest-impact improvements.

## 1) Admin Architecture (What Talks To What)

**Frontend**
- Entry route: `src/App.tsx` (`/admin/*`)
- Guard: `src/admin/AdminRoute.tsx` calls `GET /admin/me`
- Layout + pages: `src/admin/AdminLayout.tsx` and `src/admin/pages/*`
- Data hooks: `src/admin/api.ts` (React Query)

**Backend**
- Admin router: `backend/src/routes/admin/index.ts`
- Admin auth: `backend/src/middleware/adminAuth.ts`
- Key controllers:
  - System/ops: `backend/src/routes/admin/system.ts`
  - Revenue analytics: `backend/src/routes/admin-revenue.ts`
  - Payments: `backend/src/routes/admin/payments.ts`
  - Users: `backend/src/routes/admin/users.ts`
  - Subs: `backend/src/routes/admin/subscriptions.ts`
  - Stripe admin: `backend/src/routes/admin/stripe.ts`
  - Paystack admin: `backend/src/routes/admin/paystack.ts`
  - Support: `backend/src/routes/admin/support.ts`

**Critical Reality**
- Admin **Overview/Revenue** pages are **DB-derived analytics**.
- Admin **Stripe** tab is **live Stripe API** (e.g. `stripe.balance.retrieve()`).
- These are different sources and different metrics, so they will not always match.

## 2) UI Route → Page → Backend Request Map

| UI Route | UI Component | Primary Requests | Data Source | Notes |
|---|---|---|---|---|
| `/admin` | `src/admin/pages/Overview.tsx` | `GET /admin/dashboard`, `GET /admin/revenue/overview`, `GET /admin/activity` | DB | KPI summary + freshness |
| `/admin/revenue` | `src/admin/pages/Revenue.tsx` | `GET /admin/revenue/*` | DB | Trend charts + breakdown tables |
| `/admin/users` | `src/admin/pages/Users.tsx` | `GET /admin/users`, `POST /admin/users/:id/block`, `POST /admin/users/:id/unblock`, `DELETE /admin/users/:id` | DB + Stripe (on delete) | Deleting a user can call Stripe cancels |
| `/admin/create-creator` | `src/admin/pages/CreateCreator.tsx` | `GET /admin/paystack/banks/:country`, `POST /admin/paystack/resolve-account`, `POST /admin/users/create-creator` | Paystack API + DB | Paystack bank resolution + subaccount creation |
| `/admin/payments` | `src/admin/pages/Payments.tsx` | `GET /admin/payments`, `POST /admin/payments/:id/refund` | DB + Stripe/Paystack | Refund is provider write action |
| `/admin/subscriptions` | `src/admin/pages/Subscriptions.tsx` | `GET /admin/subscriptions`, `POST /admin/subscriptions/:id/cancel` | DB + Stripe/Paystack | Cancel triggers provider cancellation |
| `/admin/stripe` | `src/admin/pages/Stripe.tsx` | `GET /admin/stripe/balance`, `GET /admin/stripe/accounts`, `GET /admin/stripe/transfers`, `GET /admin/stripe/events`, actions | Stripe API + DB | Mostly live Stripe API |
| `/admin/emails` | `src/admin/pages/Emails.tsx` | `GET /admin/emails` | DB | Email logs (Resend results stored) |
| `/admin/reminders` | `src/admin/pages/Reminders.tsx` | `GET /admin/reminders/stats`, `GET /admin/reminders` | DB | Scheduled reminder tracking |
| `/admin/logs` | `src/admin/pages/Logs.tsx` | `GET /admin/logs/stats`, `GET /admin/logs` | DB | System log explorer |
| `/admin/invoices` | `src/admin/pages/Invoices.tsx` | `GET /admin/invoices` | DB | Request/invoice overview |
| `/admin/ops` | `src/admin/pages/Operations.tsx` | `GET /admin/health`, `/admin/webhooks/*`, `/admin/reconciliation/*`, `/admin/sync/*`, disputes/blocked views | DB + Paystack/Stripe | Ops + reconciliation surfaces |
| `/admin/support` | `src/admin/pages/Support.tsx` | `/admin/support/tickets/*` | DB | Ticket ops |

## 3) Why Stripe “Money/Subscribers/Revenue” Can Differ From Admin Overview/Revenue

### 3.1 Different metrics
- **Admin → Stripe → Platform Balance** is: *how much is currently in Stripe* (available/pending/reserved), per currency.
- **Admin → Overview/Revenue** is: *what we recorded as succeeded payments + computed platform fees*, derived from our `payments` table.

Those are not the same thing:
- Stripe balance includes **pending funds**, **refunds**, **disputes**, **Stripe fees**, **manual adjustments**, and **timing differences**.
- Our overview is typically **platform fees** and **successful payments** only (and relies on our business logic for fee math).

### 3.2 Webhooks are the source of truth for DB analytics
Overview/Revenue reflect what your DB knows, and the DB is updated primarily via:
- Stripe webhooks: `backend/src/routes/webhooks/stripe/*` → `backend/src/workers/webhookProcessor.ts`
- Paystack webhooks: `backend/src/routes/webhooks/paystack/*` → `backend/src/workers/webhookProcessor.ts`

If webhook processing is delayed, failing, or the worker isn’t running, DB-derived numbers lag.

### 3.3 Timing bug that caused “date mismatch” (fixed)
Previously, admin analytics used `payments.createdAt` for “today/this month” windows.
- `createdAt` is **when our DB wrote the row**, not necessarily when the payment happened.
- Webhook delays or replays can make a “yesterday” payment show up as “today” in admin.

Fix applied:
- Admin revenue reporting now uses `payments.occurredAt` for time windows and trends.
- Payment list now exposes `occurredAt` and the UI displays it.

Files:
- `backend/src/routes/admin-revenue.ts`
- `backend/src/routes/admin/system.ts`
- `backend/src/routes/admin/payments.ts`
- `src/admin/pages/Payments.tsx`

### 3.4 Multi-currency is the biggest remaining accuracy gap
If you have multiple currencies (Stripe balances can show GBP/EUR/etc, Paystack NGN/KES/etc):
- **Summing cents across currencies is mathematically invalid.**
- Some admin KPIs still show single “USD” formatted totals while the underlying data may be multi-currency.

Recommended fix:
- For KPI cards, display a **currency breakdown** (e.g., `USD $X · NGN ₦Y`) or implement a **base-currency conversion** using stored historic FX at ingestion time.
- Without storing FX per payment, live FX conversion is approximate and not audit-safe.

## 4) “Random Crashes / Funny Loads” — Most Likely Causes

### Frontend-side
- **Unexpected null/undefined from APIs** (e.g., nullable IDs) → runtime `.slice()`/formatters crash.
- **`Intl.NumberFormat` currency errors** if currency codes are malformed in DB (can throw).
- **No error UI** on many pages: query failures can look like empty tables (“No data”) instead of a clear error.
- **Navigation + auth race**: if `/admin/me` fails transiently, admin may show “Connection Error”.

Mitigations applied:
- Added a global admin error boundary to prevent white-screen crashes and provide a reload escape hatch:
  - `src/admin/AdminErrorBoundary.tsx`
  - wired in `src/admin/AdminLayout.tsx`

### Backend-side
- **Webhook worker not running** (when Redis/BullMQ is enabled) ⇒ DB doesn’t update ⇒ overview looks stale.
- **Provider rate limits** (Stripe admin endpoints that call Stripe per row can be slow/unstable).
- **Missing webhooks** or processing failures ⇒ payments/subscriptions drift from providers.

Mitigations applied:
- Admin now surfaces **data freshness** (last payment + last processed webhook) so staleness is visible.
- Ops page includes **reconciliation/sync** tools to detect and repair drift:
  - `src/admin/pages/Operations.tsx`

## 5) Performance / Optimization Opportunities

### Stripe admin pages
`GET /admin/stripe/accounts` currently calls `stripe.accounts.retrieve()` for every account on the page.
Risks:
- Slow page loads with many accounts.
- Stripe rate limits causing intermittent failures.

Improvements:
- Concurrency-limit Stripe calls (p-limit).
- Cache results (short TTL) for the list page.
- Persist “last-known” Stripe status in DB via webhook/account.updated and render that in admin list; fetch live only on detail.

### Revenue analytics
For large datasets, groupBy/aggregate endpoints can get expensive.
Improvements:
- Add partial indexes for `occurredAt` windows (already have `payments_creatorId_occurredAt_idx`).
- Consider pre-aggregated daily tables for charts (only if query load becomes a problem).

## 6) Testing Coverage for Admin (Golden Suite Additions)

Existing:
- Backend admin integration tests exist (revenue/payments/etc).
- Playwright admin smoke navigates all routes and fails on runtime errors:
  - `e2e/admin-smoke.spec.ts`

Recommended next tests:
- Add API-contract tests for `/admin/stripe/balance` and `/admin/revenue/*` response shapes (schema drift prevention).
- Add UI tests that simulate API failure modes (e.g., 500/invalid JSON) to verify error states.

