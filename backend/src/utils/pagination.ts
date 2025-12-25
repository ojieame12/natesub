/**
 * Pagination Utility
 *
 * Shared pagination logic for admin endpoints to eliminate duplication.
 */

import { z } from 'zod'

/**
 * Default pagination constants
 */
export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 50,
  maxLimit: 200,
} as const

/**
 * Standard pagination schema for query parameters
 *
 * Usage:
 * ```typescript
 * const query = paginationSchema.parse(c.req.query())
 * ```
 */
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(PAGINATION_DEFAULTS.page),
  limit: z.coerce.number().min(1).max(PAGINATION_DEFAULTS.maxLimit).default(PAGINATION_DEFAULTS.limit),
})

export type PaginationParams = z.infer<typeof paginationSchema>

/**
 * Extended pagination schema with search
 */
export const paginationWithSearchSchema = paginationSchema.extend({
  search: z.string().optional(),
})

export type PaginationWithSearchParams = z.infer<typeof paginationWithSearchSchema>

/**
 * Pagination metadata in responses
 */
export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Standard paginated response structure
 */
export interface PaginatedResult<T> {
  data: T[]
  pagination: PaginationMeta
}

/**
 * Get skip and take values for Prisma queries
 *
 * Usage:
 * ```typescript
 * const { skip, take } = getPaginationOffsets({ page: 2, limit: 50 })
 * const users = await db.user.findMany({ skip, take })
 * ```
 */
export function getPaginationOffsets(params: PaginationParams): { skip: number; take: number } {
  const skip = (params.page - 1) * params.limit
  return { skip, take: params.limit }
}

/**
 * Build pagination metadata from query results
 */
export function buildPaginationMeta(total: number, params: PaginationParams): PaginationMeta {
  const totalPages = Math.ceil(total / params.limit)
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages,
    hasNext: params.page < totalPages,
    hasPrev: params.page > 1,
  }
}

/**
 * Format a paginated response with data and metadata
 *
 * Usage:
 * ```typescript
 * const users = await db.user.findMany({ skip, take })
 * const total = await db.user.count({ where })
 * return c.json(formatPaginatedResponse(users, total, { page: 1, limit: 50 }))
 * ```
 */
export function formatPaginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams
): PaginatedResult<T> {
  return {
    data,
    pagination: buildPaginationMeta(total, params),
  }
}

/**
 * Legacy response format for backward compatibility
 *
 * Maintains the old response structure while adding new pagination metadata.
 * Use this during migration to avoid breaking existing clients.
 *
 * Usage:
 * ```typescript
 * return c.json(formatLegacyPaginatedResponse(users, total, params, 'users'))
 * // Returns: { users: [...], total, page, totalPages, pagination: {...} }
 * ```
 */
export function formatLegacyPaginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams,
  dataKey: string
): Record<string, unknown> {
  const totalPages = Math.ceil(total / params.limit)
  return {
    [dataKey]: data,
    total,
    page: params.page,
    totalPages,
    // New format for gradual migration
    pagination: buildPaginationMeta(total, params),
  }
}

/**
 * Create a reusable paginated query handler
 *
 * Usage:
 * ```typescript
 * const getUsers = createPaginatedHandler(
 *   async ({ skip, take, search }) => {
 *     const where = search ? { email: { contains: search } } : {}
 *     const [data, total] = await Promise.all([
 *       db.user.findMany({ where, skip, take }),
 *       db.user.count({ where }),
 *     ])
 *     return { data, total }
 *   }
 * )
 *
 * // In route handler:
 * const result = await getUsers(c.req.query())
 * return c.json(result)
 * ```
 */
export function createPaginatedHandler<T, Q extends PaginationParams>(
  fetcher: (params: Q & { skip: number; take: number }) => Promise<{ data: T[]; total: number }>
) {
  return async (queryParams: Q): Promise<PaginatedResult<T>> => {
    const { skip, take } = getPaginationOffsets(queryParams)
    const { data, total } = await fetcher({ ...queryParams, skip, take })
    return formatPaginatedResponse(data, total, queryParams)
  }
}
