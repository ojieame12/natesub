import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { publicRateLimit } from '../middleware/rateLimit.js'
import { cached, CACHE_TTL } from '../utils/cache.js'

const analytics = new Hono()

// Validation schemas
const pageViewSchema = z.object({
  profileId: z.string().uuid(),
  // Allow any string for referrer - apps, mail clients, etc. don't always send valid URLs
  referrer: z.string().max(2000).optional().nullable(),
  utmSource: z.string().max(100).optional().nullable(),
  utmMedium: z.string().max(100).optional().nullable(),
  utmCampaign: z.string().max(100).optional().nullable(),
})

const updateViewSchema = z.object({
  reachedPayment: z.boolean().optional(),
  startedCheckout: z.boolean().optional(),
  completedCheckout: z.boolean().optional(),
})

// Hash visitor info for unique counting (no PII stored)
function hashVisitor(ip: string, userAgent: string): string {
  return crypto
    .createHash('sha256')
    .update(`${ip}:${userAgent}`)
    .digest('hex')
    .slice(0, 16) // Short hash is fine for this
}

// Detect device type from user agent
function getDeviceType(userAgent: string): string {
  const ua = userAgent.toLowerCase()
  if (/mobile|android|iphone|ipod|blackberry|windows phone/i.test(ua)) {
    return 'mobile'
  }
  if (/ipad|tablet/i.test(ua)) {
    return 'tablet'
  }
  return 'desktop'
}

// ============================================
// PUBLIC: Record page view (no auth required)
// Rate limited and validated to prevent spam/injection
// ============================================

analytics.post(
  '/view',
  publicRateLimit,
  zValidator('json', pageViewSchema),
  async (c) => {
  try {
    const { profileId, referrer, utmSource, utmMedium, utmCampaign } = c.req.valid('json')

    // Get visitor info from headers
    const ip = c.req.header('x-forwarded-for')?.split(',')[0] ||
               c.req.header('x-real-ip') ||
               'unknown'
    const userAgent = c.req.header('user-agent') || 'unknown'
    const visitorHash = hashVisitor(ip, userAgent)
    const deviceType = getDeviceType(userAgent)

    // Check for recent view from same visitor (debounce - 30 min window)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
    const recentView = await db.pageView.findFirst({
      where: {
        profileId,
        visitorHash,
        createdAt: { gte: thirtyMinutesAgo },
      },
    })

    if (recentView) {
      // Return existing view ID for conversion tracking updates
      return c.json({ viewId: recentView.id, existing: true })
    }

    // Create new page view
    const pageView = await db.pageView.create({
      data: {
        profileId,
        visitorHash,
        referrer: referrer || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        deviceType,
      },
    })

    return c.json({ viewId: pageView.id })
  } catch (error) {
    console.error('Failed to record page view:', error)
    return c.json({ error: 'Failed to record view' }, 500)
  }
})

// ============================================
// PUBLIC: Update conversion progress
// Rate limited and validated
// ============================================

analytics.patch(
  '/view/:viewId',
  publicRateLimit,
  zValidator('param', z.object({ viewId: z.string().uuid() })),
  zValidator('json', updateViewSchema),
  async (c) => {
  try {
    const { viewId } = c.req.valid('param')
    const { reachedPayment, startedCheckout, completedCheckout } = c.req.valid('json')

    const updateData: { reachedPayment?: boolean; startedCheckout?: boolean; completedCheckout?: boolean } = {}
    if (reachedPayment !== undefined) updateData.reachedPayment = reachedPayment
    if (startedCheckout !== undefined) updateData.startedCheckout = startedCheckout
    if (completedCheckout !== undefined) updateData.completedCheckout = completedCheckout

    // Use updateMany to gracefully handle missing viewIds (returns count: 0 instead of throwing)
    // This makes the endpoint idempotent and avoids 500s for stale/expired view IDs
    const result = await db.pageView.updateMany({
      where: { id: viewId },
      data: updateData,
    })

    // Still return success even if view not found (idempotent, no-op is fine)
    return c.json({ success: true, updated: result.count > 0 })
  } catch (error) {
    console.error('Failed to update page view:', error)
    return c.json({ error: 'Failed to update view' }, 500)
  }
})

// ============================================
// PRIVATE: Get analytics for my page
// ============================================

analytics.get('/stats', requireAuth, async (c) => {
  try {
    const userId = c.get('userId')

    // Get user's profile
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { id: true },
    })

    if (!profile) {
      return c.json({ error: 'Profile not found' }, 404)
    }

    // Cache analytics stats for 1 minute to reduce DB load
    // Stats don't need to be real-time accurate for dashboard display
    const cacheKey = `analytics:stats:${profile.id}`
    const stats = await cached(cacheKey, CACHE_TTL.SHORT, async () => {
      // Get date ranges
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      const thisMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)

      // Batch all queries in parallel for efficiency
      const [
        todayViews,
        weekViews,
        monthViews,
        totalViews,
        uniqueToday,
        uniqueWeek,
        uniqueMonth,
        reachedPayment,
        startedCheckout,
        completedCheckout,
        conversions,
        deviceStats,
        referrerStats,
        dailyViews,
      ] = await Promise.all([
        // View counts
        db.pageView.count({
          where: { profileId: profile.id, createdAt: { gte: today } },
        }),
        db.pageView.count({
          where: { profileId: profile.id, createdAt: { gte: thisWeek } },
        }),
        db.pageView.count({
          where: { profileId: profile.id, createdAt: { gte: thisMonth } },
        }),
        db.pageView.count({
          where: { profileId: profile.id },
        }),

        // Unique visitors (COUNT DISTINCT)
        db.$queryRaw<[{ count: number }]>`
          SELECT COUNT(DISTINCT "visitorHash")::int as count
          FROM page_views
          WHERE "profileId" = ${profile.id} AND "createdAt" >= ${today}
        `.then(r => r[0]?.count ?? 0),
        db.$queryRaw<[{ count: number }]>`
          SELECT COUNT(DISTINCT "visitorHash")::int as count
          FROM page_views
          WHERE "profileId" = ${profile.id} AND "createdAt" >= ${thisWeek}
        `.then(r => r[0]?.count ?? 0),
        db.$queryRaw<[{ count: number }]>`
          SELECT COUNT(DISTINCT "visitorHash")::int as count
          FROM page_views
          WHERE "profileId" = ${profile.id} AND "createdAt" >= ${thisMonth}
        `.then(r => r[0]?.count ?? 0),

        // Conversion funnel
        db.pageView.count({
          where: { profileId: profile.id, createdAt: { gte: thisMonth }, reachedPayment: true },
        }),
        db.pageView.count({
          where: { profileId: profile.id, createdAt: { gte: thisMonth }, startedCheckout: true },
        }),
        db.pageView.count({
          where: { profileId: profile.id, createdAt: { gte: thisMonth }, completedCheckout: true },
        }),

        // Actual conversions (subscriptions)
        db.subscription.count({
          where: { creatorId: userId, startedAt: { gte: thisMonth } },
        }),

        // Device breakdown
        db.pageView.groupBy({
          by: ['deviceType'],
          where: { profileId: profile.id, createdAt: { gte: thisMonth } },
          _count: true,
        }),

        // Top referrers
        db.pageView.groupBy({
          by: ['referrer'],
          where: {
            profileId: profile.id,
            createdAt: { gte: thisMonth },
          },
          _count: true,
          orderBy: { _count: { referrer: 'desc' } },
          take: 6,
        }),

        // Daily views chart
        db.$queryRaw<{ date: string; count: number }[]>`
          SELECT DATE("createdAt") as date, COUNT(*)::int as count
          FROM page_views
          WHERE "profileId" = ${profile.id}
            AND "createdAt" >= ${fourteenDaysAgo}
          GROUP BY DATE("createdAt")
          ORDER BY date ASC
        `,
      ])

      // Calculate conversion rates
      const viewToPaymentRate = monthViews > 0 ? (reachedPayment / monthViews) * 100 : 0
      const paymentToCheckoutRate = reachedPayment > 0 ? (startedCheckout / reachedPayment) * 100 : 0
      const checkoutToSubscribeRate = startedCheckout > 0 ? (conversions / startedCheckout) * 100 : 0
      const overallConversionRate = monthViews > 0 ? (conversions / monthViews) * 100 : 0

      return {
        views: {
          today: todayViews,
          week: weekViews,
          month: monthViews,
          total: totalViews,
        },
        uniqueVisitors: {
          today: uniqueToday,
          week: uniqueWeek,
          month: uniqueMonth,
        },
        funnel: {
          views: monthViews,
          reachedPayment,
          startedCheckout,
          completedCheckout,
          conversions,
        },
        rates: {
          viewToPayment: Math.round(viewToPaymentRate * 10) / 10,
          paymentToCheckout: Math.round(paymentToCheckoutRate * 10) / 10,
          checkoutToSubscribe: Math.round(checkoutToSubscribeRate * 10) / 10,
          overall: Math.round(overallConversionRate * 10) / 10,
        },
        devices: deviceStats.map(d => ({
          type: d.deviceType || 'unknown',
          count: d._count,
        })),
        referrers: referrerStats
          .map(r => ({
            source: r.referrer || 'Direct',
            count: r._count,
          }))
          .slice(0, 5),
        dailyViews: dailyViews.map(d => ({
          date: d.date,
          count: d.count,
        })),
      }
    })

    return c.json(stats)
  } catch (error) {
    console.error('Failed to get analytics:', error)
    return c.json({ error: 'Failed to get analytics' }, 500)
  }
})

export default analytics
