# Admin System Remediation Master Plan

## Objective
Transform the current "monolithic script" admin system into a secure, scalable, and maintainable enterprise-grade module. This plan addresses all identified security gaps, performance bottlenecks, and architectural technical debt.

---

## Phase 1: Security Hardening & Standardization (High Priority)

**Goal:** Mitigate immediate security risks and establish a consistent authentication model.

### 1.1 Centralize Authentication Middleware
- **Current State:** Auth logic is copy-pasted in multiple files; relies on hardcoded checks.
- **Action:**
  - [ ] Create `backend/src/middleware/adminAuth.ts`
  - [ ] Consolidate API_KEY (Retool) and Session (Frontend) logic into this single middleware
  - [ ] Implement Access Logs within the middleware to track who accessed what and when

### 1.2 Dynamic Admin Access Control
- **Current State:** Hardcoded `ADMIN_EMAILS` array in `config/admin.ts`
- **Action:**
  - [ ] Update User schema in Prisma: Add `role` enum (`USER`, `ADMIN`, `SUPER_ADMIN`)
  - [ ] Create a migration script to promote existing hardcoded emails to `SUPER_ADMIN` in the DB
  - [ ] Update middleware to check `user.role` instead of the email list

### 1.3 Role-Based Access Control (RBAC)
- **Current State:** Binary access (Admin vs Non-Admin)
- **Action:**
  - [ ] Define permissions:
    - `READ_ONLY`: View stats, logs, users (Support/Jr Admin)
    - `OPERATOR`: Refund payments, cancel subscriptions
    - `SUPER_ADMIN`: Delete users, manage API keys, view sensitive revenue data
  - [ ] Implement a `requireRole('SUPER_ADMIN')` HOF or middleware for destructive routes (`DELETE /users`, `/refund`)

### 1.4 Timezone Standardization
- **Current State:** Application uses server local time (`new Date()`)
- **Action:**
  - [ ] Introduce `date-fns-tz`
  - [ ] Define a system-wide constant `BUSINESS_TIMEZONE` (e.g., `'UTC'` or user's operating region)
  - [ ] Refactor all reports to use `startOfDay(now, { timeZone: BUSINESS_TIMEZONE })`

---

## Phase 2: Architecture Refactoring (Splitting the Monolith)

**Goal:** Break down the 3,000+ line `admin.ts` file into maintainable domain modules.

### 2.1 Directory Restructuring
- **Action:** Create `backend/src/routes/admin/` directory
- **New Structure:**
  ```
  backend/src/routes/admin/
  ├── index.ts                    # Router entry point
  ├── controllers/
  │   ├── users.controller.ts
  │   ├── payments.controller.ts
  │   ├── subscriptions.controller.ts
  │   ├── logs.controller.ts
  │   └── system.controller.ts    # Health, Metrics
  └── services/
      ├── adminUser.service.ts
      └── adminRevenue.service.ts
  ```

### 2.2 Controller Extraction
- **Action:** Systematically move route handlers from the monolithic `admin.ts` to their respective controllers
- **Detail:**
  - [ ] Move User management logic (Block/Unblock/Delete) to `users.controller.ts`
  - [ ] Move Payment logic (Refunds/Sync) to `payments.controller.ts`
  - [ ] Ensure all controllers import the centralized `adminAuth` middleware

---

## Phase 3: Performance & Scalability

**Goal:** Prevent database lockups and ensure fast dashboard loading times.

### 3.1 Caching Strategy (Redis/In-Memory)
- **Current State:** Heavy aggregation queries run on every request
- **Action:**
  - [ ] Implement a caching layer (e.g., `node-cache` or Redis)
  - [ ] Cache Dashboard Stats (`/dashboard`) for 60 seconds
  - [ ] Cache Revenue Reports (`/revenue/*`) for 1 hour (historical data doesn't change often)
  - [ ] Add cache invalidation hooks (e.g., invalidate User Cache when a user is blocked)

### 3.2 Database Optimization
- **Action:**
  - [ ] Audit all `findMany` queries in admin routes
  - [ ] Ensure `select` clauses are used to fetch only necessary fields
  - [ ] Add missing DB indexes on frequently filtered columns:
    - `Payment(status, createdAt)`
    - `Subscription(status, creatorId)`
    - `SystemLog(type, level)`

---

## Phase 4: Reliability & Testing

**Goal:** Ensure the system is robust and fail-safe.

### 4.1 Global Error Handling
- **Action:** Implement a global error boundary for Admin routes
- **Detail:** Return standardized JSON error responses `{ error: string, code: string, requestId: string }`

### 4.2 Automated Reconciliation
- **Action:**
  - [ ] Convert manual `/reconciliation/run` buttons into scheduled Cron Jobs
  - [ ] Alert admins via email/Slack if reconciliation detects > X discrepancies

### 4.3 Integration Tests
- **Action:**
  - [ ] Add specific integration tests for Admin flows using Supertest
  - [ ] Test Cases:
    - "Non-admin cannot access admin routes"
    - "Admin can block user"
    - "Admin cannot refund > transaction amount"

---

## Execution Timeline

| Day | Tasks | Risk Level |
|-----|-------|------------|
| 1-2 | Auth Middleware & DB Schema | High (Risk Mitigation) |
| 3-4 | Split `admin.ts` file | Medium (Code Health) |
| 5 | Performance Caching & Indexes | Medium |
| 6 | Testing & Final Polish | Low |

---

## Current State Audit (Verified)

| Issue | Status | Evidence |
|-------|--------|----------|
| Hardcoded Admin List | Confirmed | `config/admin.ts` has single email |
| Duplicated Auth Logic | Confirmed | Auth in `admin.ts` (L43) and `admin-revenue.ts` (L80) |
| No RBAC | Confirmed | Binary `isAdminEmail()` check |
| Monolithic Files | Confirmed | `admin.ts` = 3,063 lines |
| Heavy Aggregations | Confirmed | Multiple `Promise.all` with `db.payment.aggregate` |
| Timezone Issues | Confirmed | Uses `new Date()` without timezone |
| No Global Error Handler | Confirmed | No admin-specific error boundary |

---

## Files to Modify/Create

### New Files
- `backend/src/middleware/adminAuth.ts`
- `backend/src/routes/admin/index.ts`
- `backend/src/routes/admin/controllers/*.ts`
- `backend/src/routes/admin/services/*.ts`

### Modified Files
- `backend/prisma/schema.prisma` (add Role enum)
- `backend/src/config/admin.ts` (deprecate)
- `backend/src/routes/admin.ts` (split into controllers)
- `backend/src/routes/admin-revenue.ts` (use shared middleware)

---

## Success Criteria

- [ ] Single source of truth for admin authentication
- [ ] Admin roles stored in database, not code
- [ ] No route handler > 100 lines
- [ ] Dashboard loads in < 500ms
- [ ] All destructive actions require SUPER_ADMIN role
- [ ] 100% test coverage on admin auth flows
