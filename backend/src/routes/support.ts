/**
 * Support Ticket Routes
 *
 * Public and authenticated endpoints for support ticket management.
 * - POST /support/tickets - Create a new support ticket (no auth required)
 * - GET /support/tickets - List my tickets (auth required)
 * - GET /support/tickets/:id - Get ticket details (auth required)
 * - POST /support/tickets/:id/reply - Add message to ticket (auth required)
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/client.js'
import { optionalAuth, requireAuth } from '../middleware/auth.js'
import { supportTicketRateLimit } from '../middleware/rateLimit.js'
import { sendSupportTicketConfirmationEmail } from '../services/email.js'
import type { TicketCategory, TicketPriority } from '@prisma/client'

const support = new Hono()

// Schema for creating a ticket
const createTicketSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  category: z.enum(['general', 'billing', 'technical', 'account', 'payout', 'dispute']),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
})

// Schema for replying to a ticket
const replySchema = z.object({
  message: z.string().min(1).max(5000),
})

/**
 * POST /support/tickets
 * Create a new support ticket (no auth required, but includes userId if logged in)
 * Rate limited to 5 tickets per hour per IP to prevent spam
 */
support.post('/tickets', supportTicketRateLimit, optionalAuth, async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  const parsed = createTicketSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { email, name, category, subject, message } = parsed.data
  const userId = c.get('userId') as string | undefined

  // If logged in, get user email
  let userEmail = email
  let userName = name
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { profile: { select: { displayName: true } } },
    })
    if (user) {
      userEmail = user.email
      userName = userName || user.profile?.displayName || undefined
    }
  }

  // Determine priority based on category
  let priority: TicketPriority = 'normal'
  if (category === 'dispute' || category === 'payout') {
    priority = 'high'
  }

  const ticket = await db.supportTicket.create({
    data: {
      userId,
      email: userEmail,
      name: userName,
      category: category as TicketCategory,
      subject,
      message,
      priority,
      messages: {
        create: {
          isAdmin: false,
          senderName: userName || userEmail,
          message,
        },
      },
    },
    include: {
      messages: true,
    },
  })

  // Send confirmation email (don't await - fire and forget)
  sendSupportTicketConfirmationEmail(userEmail, ticket.id, subject).catch((err) => {
    console.error('[support] Failed to send confirmation email:', err)
  })

  return c.json({
    success: true,
    ticketId: ticket.id,
    message: 'Your support ticket has been submitted. We\'ll respond within 1-2 business days.',
  })
})

// Schema for pagination query params
const paginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
})

/**
 * GET /support/tickets
 * List my tickets with cursor-based pagination (auth required)
 * Query params: cursor (ticket ID), limit (1-100, default 20)
 */
support.get('/tickets', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Parse pagination params
  const queryParsed = paginationSchema.safeParse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  })

  const { cursor, limit } = queryParsed.success
    ? queryParsed.data
    : { cursor: undefined, limit: 20 }

  const tickets = await db.supportTicket.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1, // Fetch one extra to detect hasMore
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1, // Skip the cursor item itself
    }),
    select: {
      id: true,
      category: true,
      subject: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      _count: {
        select: { messages: true },
      },
    },
  })

  // Determine if there are more results
  const hasMore = tickets.length > limit
  const results = hasMore ? tickets.slice(0, limit) : tickets
  const nextCursor = hasMore ? results[results.length - 1]?.id : null

  return c.json({
    tickets: results,
    hasMore,
    nextCursor,
  })
})

/**
 * GET /support/tickets/:id
 * Get ticket details with messages (auth required)
 */
support.get('/tickets/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const ticketId = c.req.param('id')

  const ticket = await db.supportTicket.findFirst({
    where: {
      id: ticketId,
      userId, // Only allow viewing own tickets
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404)
  }

  return c.json({ ticket })
})

/**
 * POST /support/tickets/:id/reply
 * Add a message to a ticket (auth required)
 */
support.post('/tickets/:id/reply', requireAuth, async (c) => {
  const userId = c.get('userId')
  const ticketId = c.req.param('id')

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  const parsed = replySchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }

  // Verify ticket belongs to user
  const ticket = await db.supportTicket.findFirst({
    where: {
      id: ticketId,
      userId,
    },
  })

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404)
  }

  // Don't allow replies on closed tickets
  if (ticket.status === 'closed') {
    return c.json({ error: 'Cannot reply to a closed ticket' }, 400)
  }

  // Get user info for sender name
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: { select: { displayName: true } } },
  })

  const senderName = user?.profile?.displayName || ticket.name || ticket.email

  // Add the message
  const message = await db.supportMessage.create({
    data: {
      ticketId,
      isAdmin: false,
      senderName,
      message: parsed.data.message,
    },
  })

  // If ticket was resolved, reopen it
  if (ticket.status === 'resolved') {
    await db.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'open' },
    })
  }

  return c.json({ success: true, message })
})

export default support
