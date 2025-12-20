/**
 * Admin Support Controller
 *
 * Support ticket management routes.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { sendSupportTicketReplyEmail } from '../../services/email.js'
import { lastNDays } from '../../utils/timezone.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'

const support = new Hono()

// ============================================
// SUPPORT TICKET STATS
// ============================================

/**
 * GET /admin/support/tickets/stats
 * Support ticket statistics
 */
support.get('/tickets/stats', async (c) => {
  const { start: last24h } = lastNDays(1)
  const { start: last7d } = lastNDays(7)

  const [open, inProgress, newLast24h, resolvedLast7d, byCategory, byPriority] = await Promise.all([
    db.supportTicket.count({ where: { status: 'open' } }),
    db.supportTicket.count({ where: { status: 'in_progress' } }),
    db.supportTicket.count({ where: { createdAt: { gte: last24h } } }),
    db.supportTicket.count({ where: { status: 'resolved', resolvedAt: { gte: last7d } } }),
    db.supportTicket.groupBy({
      by: ['category'],
      where: { status: { in: ['open', 'in_progress'] } },
      _count: true
    }),
    db.supportTicket.groupBy({
      by: ['priority'],
      where: { status: { in: ['open', 'in_progress'] } },
      _count: true
    })
  ])

  return c.json({
    current: {
      open,
      inProgress,
      total: open + inProgress
    },
    newLast24h,
    resolvedLast7d,
    byCategory: byCategory.map(c => ({ category: c.category, count: c._count })),
    byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count }))
  })
})

// ============================================
// SUPPORT TICKET LIST & DETAIL
// ============================================

/**
 * GET /admin/support/tickets
 * List all support tickets
 */
support.get('/tickets', async (c) => {
  const query = z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'all']).default('all'),
    priority: z.enum(['low', 'normal', 'high', 'urgent', 'all']).default('all'),
    category: z.enum(['general', 'billing', 'technical', 'account', 'payout', 'dispute', 'all']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {}

  if (query.status !== 'all') where.status = query.status
  if (query.priority !== 'all') where.priority = query.priority
  if (query.category !== 'all') where.category = query.category

  const [tickets, total] = await Promise.all([
    db.supportTicket.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ],
      include: {
        _count: { select: { messages: true } }
      }
    }),
    db.supportTicket.count({ where })
  ])

  return c.json({
    tickets: tickets.map(t => ({
      id: t.id,
      email: t.email,
      name: t.name,
      userId: t.userId,
      category: t.category,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      assignedTo: t.assignedTo,
      messageCount: t._count.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      resolvedAt: t.resolvedAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

/**
 * GET /admin/support/tickets/:id
 * Get ticket details with full message thread
 */
support.get('/tickets/:id', async (c) => {
  const { id } = c.req.param()

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } }
    }
  })

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  return c.json({ ticket })
})

// ============================================
// SUPPORT TICKET ACTIONS
// ============================================

/**
 * PATCH /admin/support/tickets/:id
 * Update ticket status, priority, assignment, or notes
 */
support.patch('/tickets/:id', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    assignedTo: z.string().nullable().optional(),
    adminNotes: z.string().nullable().optional()
  }).parse(await c.req.json())

  const ticket = await db.supportTicket.findUnique({ where: { id } })
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const updateData: any = { ...body }

  if (body.status === 'resolved' && ticket.status !== 'resolved') {
    updateData.resolvedAt = new Date()
  }

  const updated = await db.supportTicket.update({
    where: { id },
    data: updateData
  })

  return c.json({ success: true, ticket: updated })
})

/**
 * POST /admin/support/tickets/:id/reply
 * Add an admin reply to a ticket
 */
support.post('/tickets/:id/reply', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    message: z.string().min(1).max(5000)
  }).parse(await c.req.json())

  const ticket = await db.supportTicket.findUnique({ where: { id } })
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const userId = c.get('userId') as string | undefined
  let senderName = 'NatePay Support'
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true }
    })
    if (user) senderName = user.email
  }

  const message = await db.supportMessage.create({
    data: {
      ticketId: id,
      isAdmin: true,
      senderName,
      message: body.message
    }
  })

  if (ticket.status === 'open') {
    await db.supportTicket.update({
      where: { id },
      data: { status: 'in_progress' }
    })
  }

  sendSupportTicketReplyEmail(ticket.email, ticket.subject, body.message).catch((err) => {
    console.error('[admin] Failed to send support reply email:', err)
  })

  return c.json({ success: true, message })
})

/**
 * POST /admin/support/tickets/:id/resolve
 * Resolve a ticket with a resolution note
 */
support.post('/tickets/:id/resolve', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    resolution: z.string().min(1).max(1000),
    sendReply: z.boolean().default(true),
    replyMessage: z.string().optional()
  }).parse(await c.req.json())

  const ticket = await db.supportTicket.findUnique({ where: { id } })
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  if (body.sendReply && body.replyMessage) {
    await db.supportMessage.create({
      data: {
        ticketId: id,
        isAdmin: true,
        senderName: 'NatePay Support',
        message: body.replyMessage
      }
    })
  }

  const updated = await db.supportTicket.update({
    where: { id },
    data: {
      status: 'resolved',
      resolution: body.resolution,
      resolvedAt: new Date()
    }
  })

  return c.json({ success: true, ticket: updated })
})

export default support
