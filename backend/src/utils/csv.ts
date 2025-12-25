/**
 * CSV Export Utility
 *
 * Shared CSV generation logic for admin export endpoints.
 */

/**
 * Escape a value for CSV output
 *
 * Handles:
 * - null/undefined -> empty string
 * - Values with commas, quotes, or newlines -> quoted and escaped
 * - Regular values -> passed through
 */
export function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return ''

  const str = String(val)

  // Check if we need to quote the value
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Escape quotes by doubling them, then wrap in quotes
    return `"${str.replace(/"/g, '""')}"`
  }

  return str
}

/**
 * Convert headers and rows to a CSV string
 *
 * Usage:
 * ```typescript
 * const csv = toCSV(
 *   ['Name', 'Email', 'Amount'],
 *   [
 *     ['John', 'john@example.com', 1000],
 *     ['Jane', 'jane@example.com', 2000],
 *   ]
 * )
 * ```
 */
export function toCSV(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(escapeCSV).join(',')
  const dataLines = rows.map(row => row.map(escapeCSV).join(','))
  return [headerLine, ...dataLines].join('\n')
}

/**
 * Standard export response structure
 */
export interface ExportResponse {
  filename: string
  rowCount: number
  csv: string
}

/**
 * Generate a timestamped filename for exports
 */
export function generateExportFilename(prefix: string, extension: string = 'csv'): string {
  const date = new Date().toISOString().split('T')[0]
  return `${prefix}-${date}.${extension}`
}

/**
 * Create a standard export response
 *
 * Usage:
 * ```typescript
 * return c.json(createExportResponse(
 *   ['Name', 'Email'],
 *   users.map(u => [u.name, u.email]),
 *   'users-export'
 * ))
 * ```
 */
export function createExportResponse(
  headers: string[],
  rows: unknown[][],
  prefix: string
): ExportResponse {
  return {
    filename: generateExportFilename(prefix),
    rowCount: rows.length,
    csv: toCSV(headers, rows),
  }
}

/**
 * Field extractor for type-safe CSV mapping
 *
 * Usage:
 * ```typescript
 * const extractor = createFieldExtractor<User>([
 *   { header: 'ID', extract: u => u.id },
 *   { header: 'Email', extract: u => u.email },
 *   { header: 'Created', extract: u => u.createdAt.toISOString() },
 * ])
 *
 * const { headers, rows } = extractor(users)
 * return c.json(createExportResponse(headers, rows, 'users'))
 * ```
 */
export interface FieldDefinition<T> {
  header: string
  extract: (item: T) => unknown
}

export function createFieldExtractor<T>(fields: FieldDefinition<T>[]) {
  return (items: T[]): { headers: string[]; rows: unknown[][] } => {
    const headers = fields.map(f => f.header)
    const rows = items.map(item => fields.map(f => f.extract(item)))
    return { headers, rows }
  }
}

/**
 * Format a number as currency for CSV
 */
export function formatCentsToDollars(cents: number | bigint): string {
  const num = typeof cents === 'bigint' ? Number(cents) : cents
  return `$${(num / 100).toFixed(2)}`
}

/**
 * Format a date for CSV export
 */
export function formatDateForCSV(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString()
}

/**
 * Safely get nested property value
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return ''
    if (typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[part]
  }

  return current ?? ''
}
