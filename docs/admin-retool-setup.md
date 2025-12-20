# NatePay Admin Portal - Retool Setup Guide

## Overview

This guide walks you through setting up an admin portal in Retool to manage NatePay operations including user management, payments, refunds, and platform monitoring.

## Prerequisites

1. A Retool account (free tier works for getting started)
2. Your deployed API URL (e.g., `https://api.natepay.co`)
3. An `ADMIN_API_KEY` environment variable set on your backend

## Step 1: Create Admin API Key

Generate a secure API key and add it to your backend environment:

```bash
# Generate a secure key
openssl rand -hex 32

# Add to your .env or Railway/Vercel environment:
ADMIN_API_KEY=your_generated_key_here
```

## Step 2: Create Retool REST API Resource

1. In Retool, go to **Resources** → **Create new** → **REST API**
2. Configure:
   - **Name**: `NatePay Admin API`
   - **Base URL**: `https://your-api-url.com/admin`
   - **Headers**:
     - `x-admin-api-key`: `{{ ADMIN_API_KEY }}` (use Retool secrets)
     - `Content-Type`: `application/json`

## Step 3: Set Up Dashboard

Create a new Retool app called "NatePay Admin" and add these queries:

### Dashboard Stats Query

```
Name: getDashboardStats
Method: GET
URL: /dashboard
```

This returns:
```json
{
  "users": { "total": 1250, "newToday": 15, "newThisMonth": 180 },
  "subscriptions": { "active": 890 },
  "revenue": { "totalCents": 5000000, "thisMonthCents": 250000 },
  "flags": { "disputedPayments": 2, "failedPaymentsToday": 5 }
}
```

### User List Query

```
Name: getUsers
Method: GET
URL: /users
URL Parameters:
  - search: {{ searchInput.value }}
  - page: {{ userTable.pageIndex + 1 }}
  - limit: 50
  - status: {{ statusSelect.value || 'all' }}
```

### User Details Query

```
Name: getUserDetails
Method: GET
URL: /users/{{ userTable.selectedRow.data.id }}
```

### Block User Query

```
Name: blockUser
Method: POST
URL: /users/{{ userTable.selectedRow.data.id }}/block
Body: { "reason": {{ blockReasonInput.value }} }
```

### Unblock User Query

```
Name: unblockUser
Method: POST
URL: /users/{{ userTable.selectedRow.data.id }}/unblock
```

### Payment List Query

```
Name: getPayments
Method: GET
URL: /payments
URL Parameters:
  - status: {{ paymentStatusFilter.value || 'all' }}
  - page: {{ paymentTable.pageIndex + 1 }}
  - limit: 50
```

### Refund Payment Query

```
Name: refundPayment
Method: POST
URL: /payments/{{ paymentTable.selectedRow.data.id }}/refund
Body: {
  "reason": {{ refundReasonInput.value }},
  "amount": {{ partialRefundAmount.value || null }}
}
```

### Subscription List Query

```
Name: getSubscriptions
Method: GET
URL: /subscriptions
URL Parameters:
  - status: {{ subStatusFilter.value || 'all' }}
  - page: {{ subTable.pageIndex + 1 }}
  - limit: 50
```

### Cancel Subscription Query

```
Name: cancelSubscription
Method: POST
URL: /subscriptions/{{ subTable.selectedRow.data.id }}/cancel
Body: { "immediate": {{ cancelImmediateToggle.value }} }
```

### Activity Feed Query

```
Name: getActivity
Method: GET
URL: /activity
URL Parameters:
  - page: 1
  - limit: 100
  - type: {{ activityTypeFilter.value }}
```

### System Logs Query

```
Name: getSystemLogs
Method: GET
URL: /logs
URL Parameters:
  - type: {{ logTypeFilter.value }}
  - level: {{ logLevelFilter.value }}
  - page: {{ logsTable.pageIndex + 1 }}
  - limit: 100
```

### Logs Stats Query

```
Name: getLogsStats
Method: GET
URL: /logs/stats
```

Returns:
```json
{
  "last24h": {
    "emailsSent": 150,
    "emailsFailed": 3,
    "remindersSent": 45,
    "totalErrors": 8
  },
  "errorsByType": [
    { "type": "payment_error", "count": 5 },
    { "type": "webhook_error", "count": 3 }
  ]
}
```

### Reminders Query

```
Name: getReminders
Method: GET
URL: /reminders
URL Parameters:
  - status: {{ reminderStatusFilter.value || 'all' }}
  - type: {{ reminderTypeFilter.value }}
  - page: {{ remindersTable.pageIndex + 1 }}
  - limit: 50
```

### Reminders Stats Query

```
Name: getRemindersStats
Method: GET
URL: /reminders/stats
```

### Emails Query

```
Name: getEmails
Method: GET
URL: /emails
URL Parameters:
  - status: {{ emailStatusFilter.value || 'all' }}
  - template: {{ emailTemplateFilter.value }}
  - page: {{ emailsTable.pageIndex + 1 }}
  - limit: 100
```

### Invoices Query

```
Name: getInvoices
Method: GET
URL: /invoices
URL Parameters:
  - status: {{ invoiceStatusFilter.value || 'all' }}
  - page: {{ invoicesTable.pageIndex + 1 }}
  - limit: 50
```

### Revenue Overview Query

```
Name: getRevenueOverview
Method: GET
URL: /revenue/overview
```

Returns:
```json
{
  "allTime": { "totalVolumeCents": 5000000, "platformFeeCents": 400000, "creatorPayoutsCents": 4600000, "paymentCount": 1500 },
  "thisMonth": { "totalVolumeCents": 250000, "platformFeeCents": 20000, "creatorPayoutsCents": 230000, "paymentCount": 75 },
  "lastMonth": { ... },
  "today": { ... },
  "paymentsByStatus": { "succeeded": 1450, "failed": 30, "refunded": 15, "disputed": 5 }
}
```

### Revenue by Provider Query

```
Name: getRevenueByProvider
Method: GET
URL: /revenue/by-provider
URL Parameters:
  - period: {{ revenuePeriodSelect.value || 'month' }}
```

### Revenue by Currency Query

```
Name: getRevenueByCurrency
Method: GET
URL: /revenue/by-currency
URL Parameters:
  - period: {{ revenuePeriodSelect.value || 'month' }}
```

### Daily Revenue Trend Query

```
Name: getDailyRevenue
Method: GET
URL: /revenue/daily
URL Parameters:
  - days: {{ daysSlider.value || 30 }}
```

### Monthly Revenue Trend Query

```
Name: getMonthlyRevenue
Method: GET
URL: /revenue/monthly
URL Parameters:
  - months: {{ monthsSlider.value || 12 }}
```

### Top Creators Query

```
Name: getTopCreators
Method: GET
URL: /revenue/top-creators
URL Parameters:
  - limit: 20
  - period: {{ topCreatorsPeriod.value || 'month' }}
```

### Refunds & Disputes Query

```
Name: getRefundsStats
Method: GET
URL: /revenue/refunds
URL Parameters:
  - period: {{ refundsPeriod.value || 'month' }}
```

## Step 4: Build UI Components

### Dashboard Tab

Add these stat boxes:
- **Total Users**: `{{ getDashboardStats.data.users.total }}`
- **New Today**: `{{ getDashboardStats.data.users.newToday }}`
- **Active Subscriptions**: `{{ getDashboardStats.data.subscriptions.active }}`
- **Revenue (Platform Fee)**: `{{ formatCurrency(getDashboardStats.data.revenue.thisMonthCents / 100) }}/month`
- **Disputes**: `{{ getDashboardStats.data.flags.disputedPayments }}` (show alert if > 0)
- **Failed Today**: `{{ getDashboardStats.data.flags.failedPaymentsToday }}`

### Users Tab

1. **Search Input**: Text input with `searchInput` name
2. **Status Filter**: Select with options: `all`, `active`, `blocked`
3. **Users Table**: Table component named `userTable`
   - Columns: Email, Username, Country, Payment Provider, Revenue, Subscribers, Status, Created
   - Row selection enabled
4. **User Details Panel**: Shows when row selected
   - Block/Unblock button
   - Recent subscriptions list
   - Payment history

### Payments Tab

1. **Status Filter**: Select with options: `all`, `succeeded`, `failed`, `refunded`, `disputed`
2. **Payments Table**: Table named `paymentTable`
   - Columns: ID, Creator, Subscriber, Amount, Fee, Status, Provider, Date
3. **Refund Modal**:
   - Reason input
   - Optional partial amount
   - Confirm button triggers `refundPayment` query

### Subscriptions Tab

1. **Status Filter**: Select with options: `all`, `active`, `canceled`, `past_due`
2. **Subscriptions Table**: Table named `subTable`
   - Columns: Creator, Subscriber, Amount, Interval, Status, LTV, Created
3. **Cancel Modal**:
   - Immediate vs end-of-period toggle
   - Confirm button

### Activity Tab

1. **Type Filter**: Select for activity types (`admin_block`, `admin_unblock`, `admin_refund`, etc.)
2. **Activity List**: List view showing recent admin actions

### System Logs Tab

1. **Type Filter**: Select for log types (`email_sent`, `email_failed`, `reminder_sent`, `payment_error`, etc.)
2. **Level Filter**: Select with options: `info`, `warning`, `error`
3. **Logs Table**: Table named `logsTable`
   - Columns: Type, Level, Message, User, Entity, Created
4. **Stats Cards**: Show emails sent, failed, errors in last 24h

### Emails Tab

1. **Status Filter**: Select with options: `all`, `sent`, `failed`
2. **Template Filter**: Select for email templates (`new_subscriber`, `update`, `welcome`, etc.)
3. **Emails Table**: Table named `emailsTable`
   - Columns: Status, To, Subject, Template, Message ID, Created

### Reminders Tab

1. **Status Filter**: Select with options: `all`, `scheduled`, `sent`, `failed`, `canceled`
2. **Type Filter**: Select for reminder types
3. **Reminders Table**: Table named `remindersTable`
   - Columns: Type, Channel, Status, Scheduled For, Sent At, Retry Count
4. **Stats Cards**: Show scheduled, sent today, failed, upcoming next 24h

### Invoices Tab

1. **Status Filter**: Select with options: `all`, `sent`, `paid`, `expired`
2. **Invoices Table**: Table named `invoicesTable`
   - Columns: Creator, Recipient, Amount, Status, Due Date, Created

### Revenue Tab

1. **Period Filter**: Select with options: `today`, `week`, `month`, `year`, `all`
2. **Overview Cards**:
   - Total Volume (all-time, this month, today)
   - Platform Fees Collected (your revenue)
   - Creator Payouts
   - Payment Count
3. **Charts**:
   - Daily revenue line chart (use `getDailyRevenue`)
   - Monthly trend bar chart (use `getMonthlyRevenue`)
4. **Provider Breakdown**: Pie chart showing Stripe vs Paystack volume
5. **Currency Breakdown**: Table showing volume by currency
6. **Top Creators**: Table showing highest-earning creators
7. **Refunds & Disputes**: Stats cards showing refund/dispute counts and amounts

## Step 5: Add Auto-Refresh

Set `getDashboardStats` to run on page load and every 60 seconds for real-time monitoring.

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | Platform stats overview |
| `/users` | GET | List users with search/filter |
| `/users/:id` | GET | User details |
| `/users/:id/block` | POST | Block user |
| `/users/:id/unblock` | POST | Unblock user |
| `/users/:id` | DELETE | Delete user (requires `confirm: "DELETE"`) |
| `/payments` | GET | List payments |
| `/payments/:id` | GET | Payment details |
| `/payments/:id/refund` | POST | Issue refund (Stripe/Paystack) |
| `/subscriptions` | GET | List subscriptions |
| `/subscriptions/:id/cancel` | POST | Cancel subscription |
| `/activity` | GET | Admin activity feed |
| `/logs` | GET | System logs with filters |
| `/logs/stats` | GET | Email/reminder/error stats (24h) |
| `/reminders` | GET | List scheduled/sent reminders |
| `/reminders/stats` | GET | Reminder stats |
| `/emails` | GET | List sent/failed emails |
| `/invoices` | GET | List invoices (requests with due dates) |
| `/revenue/overview` | GET | Revenue overview (all-time, this month, today) |
| `/revenue/by-provider` | GET | Revenue by Stripe vs Paystack |
| `/revenue/by-currency` | GET | Revenue breakdown by currency |
| `/revenue/daily` | GET | Daily revenue trend (last N days) |
| `/revenue/monthly` | GET | Monthly revenue trend (last N months) |
| `/revenue/top-creators` | GET | Top creators by revenue |
| `/revenue/refunds` | GET | Refund and dispute statistics |
| `/webhooks/stats` | GET | Webhook processing stats |
| `/webhooks/failed` | GET | Failed webhooks |
| `/webhooks/:id/retry` | POST | Retry webhook |
| `/health` | GET | System health check |
| `/metrics` | GET | Basic platform metrics |
| `/transfers/stuck` | GET | Stuck Paystack transfers |
| `/reconciliation/missing` | GET | Missing transactions |

## Security Notes

1. **Never expose ADMIN_API_KEY** in client-side code
2. Use Retool's **Secrets** feature to store the API key
3. Enable **Audit Logs** in Retool for compliance
4. Consider IP whitelisting if Retool provides static IPs
5. All admin actions are logged in the `Activity` table for audit trails

## Troubleshooting

### 401 Unauthorized
- Verify `ADMIN_API_KEY` is set correctly in both backend and Retool

### Refund Failed
- Check if payment was already refunded
- Verify payment status is `succeeded`
- Check Stripe/Paystack dashboard for more details

### User Delete Failed
- User must have 0 active subscribers before deletion
- Cancel all subscriptions first
