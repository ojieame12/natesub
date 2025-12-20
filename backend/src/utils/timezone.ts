/**
 * Timezone Utilities
 *
 * Centralized timezone handling for consistent date/time operations.
 * All admin reports and analytics should use these utilities.
 *
 * Business timezone is UTC for consistency across regions.
 */

import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
  format,
} from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

/**
 * System-wide business timezone for reports and analytics.
 * Using UTC ensures consistency regardless of server location.
 */
export const BUSINESS_TIMEZONE = 'UTC'

/**
 * Get current time in business timezone
 */
export function nowInBusinessTz(): Date {
  return toZonedTime(new Date(), BUSINESS_TIMEZONE)
}

/**
 * Get start of today in business timezone
 */
export function todayStart(): Date {
  const now = nowInBusinessTz()
  return fromZonedTime(startOfDay(now), BUSINESS_TIMEZONE)
}

/**
 * Get end of today in business timezone
 */
export function todayEnd(): Date {
  const now = nowInBusinessTz()
  return fromZonedTime(endOfDay(now), BUSINESS_TIMEZONE)
}

/**
 * Get start of current week in business timezone (Sunday)
 */
export function thisWeekStart(): Date {
  const now = nowInBusinessTz()
  return fromZonedTime(startOfWeek(now), BUSINESS_TIMEZONE)
}

/**
 * Get end of current week in business timezone
 */
export function thisWeekEnd(): Date {
  const now = nowInBusinessTz()
  return fromZonedTime(endOfWeek(now), BUSINESS_TIMEZONE)
}

/**
 * Get start of current month in business timezone
 */
export function thisMonthStart(): Date {
  const now = nowInBusinessTz()
  return fromZonedTime(startOfMonth(now), BUSINESS_TIMEZONE)
}

/**
 * Get end of current month in business timezone
 */
export function thisMonthEnd(): Date {
  const now = nowInBusinessTz()
  return fromZonedTime(endOfMonth(now), BUSINESS_TIMEZONE)
}

/**
 * Get start of current year in business timezone
 */
export function thisYearStart(): Date {
  const now = nowInBusinessTz()
  return fromZonedTime(startOfYear(now), BUSINESS_TIMEZONE)
}

/**
 * Get date range for "last N days" in business timezone
 */
export function lastNDays(n: number): { start: Date; end: Date } {
  const now = nowInBusinessTz()
  const end = fromZonedTime(endOfDay(now), BUSINESS_TIMEZONE)
  const start = fromZonedTime(startOfDay(subDays(now, n - 1)), BUSINESS_TIMEZONE)
  return { start, end }
}

/**
 * Get date range for "last N months" in business timezone
 */
export function lastNMonths(n: number): { start: Date; end: Date } {
  const now = nowInBusinessTz()
  const end = fromZonedTime(endOfDay(now), BUSINESS_TIMEZONE)
  const start = fromZonedTime(startOfMonth(subMonths(now, n - 1)), BUSINESS_TIMEZONE)
  return { start, end }
}

/**
 * Get date range for previous month in business timezone
 */
export function previousMonth(): { start: Date; end: Date } {
  const now = nowInBusinessTz()
  const lastMonth = subMonths(now, 1)
  return {
    start: fromZonedTime(startOfMonth(lastMonth), BUSINESS_TIMEZONE),
    end: fromZonedTime(endOfMonth(lastMonth), BUSINESS_TIMEZONE),
  }
}

/**
 * Get date range for previous year in business timezone
 */
export function previousYear(): { start: Date; end: Date } {
  const now = nowInBusinessTz()
  const lastYear = subYears(now, 1)
  return {
    start: fromZonedTime(startOfYear(lastYear), BUSINESS_TIMEZONE),
    end: fromZonedTime(endOfDay(subDays(startOfYear(now), 1)), BUSINESS_TIMEZONE),
  }
}

/**
 * Format a date for display in business timezone
 */
export function formatInBusinessTz(date: Date, formatStr: string = 'yyyy-MM-dd HH:mm:ss'): string {
  const zonedDate = toZonedTime(date, BUSINESS_TIMEZONE)
  return format(zonedDate, formatStr)
}

/**
 * Parse a period string to date range
 * Supports: 'today', 'week', 'month', 'year', '7d', '30d', '90d', 'all'
 */
export function parsePeriod(period: string): { start: Date | null; end: Date } {
  const end = todayEnd()

  switch (period) {
    case 'today':
      return { start: todayStart(), end }
    case 'week':
      return { start: thisWeekStart(), end }
    case 'month':
      return { start: thisMonthStart(), end }
    case 'year':
      return { start: thisYearStart(), end }
    case '7d':
      return lastNDays(7)
    case '30d':
      return lastNDays(30)
    case '90d':
      return lastNDays(90)
    case 'all':
    default:
      return { start: null, end }
  }
}
