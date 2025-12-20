/**
 * Pagination - Enhanced table pagination controls
 *
 * Features:
 * - Page number buttons with smart ellipsis
 * - Jump to page input
 * - Previous/Next buttons
 * - Showing X-Y of Z display
 */

import { useState } from 'react'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  limit: number
  onPageChange: (page: number) => void
  loading?: boolean
}

export default function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  loading = false,
}: PaginationProps) {
  const [jumpValue, setJumpValue] = useState('')
  const start = (page - 1) * limit + 1
  const end = Math.min(page * limit, total)

  // Generate page numbers with ellipsis
  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = []
    const showPages = 5 // Max pages to show

    if (totalPages <= showPages + 2) {
      // Show all pages if not many
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      // Always show first page
      pages.push(1)

      if (page > 3) {
        pages.push('ellipsis')
      }

      // Pages around current
      const startPage = Math.max(2, page - 1)
      const endPage = Math.min(totalPages - 1, page + 1)

      for (let i = startPage; i <= endPage; i++) {
        pages.push(i)
      }

      if (page < totalPages - 2) {
        pages.push('ellipsis')
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages)
      }
    }

    return pages
  }

  const handleJump = () => {
    const pageNum = parseInt(jumpValue, 10)
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum)
      setJumpValue('')
    }
  }

  const handleJumpKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJump()
    }
  }

  const pageNumbers = getPageNumbers()

  return (
    <div className="admin-pagination">
      <div className="admin-pagination-info">
        Showing {start.toLocaleString()}-{end.toLocaleString()} of {total.toLocaleString()}
      </div>

      <div className="admin-pagination-controls">
        {/* Previous button */}
        <button
          className="admin-btn admin-btn-secondary admin-btn-small"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || loading}
        >
          ← Prev
        </button>

        {/* Page numbers */}
        <div className="admin-pagination-pages">
          {pageNumbers.map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`ellipsis-${i}`} className="admin-pagination-ellipsis">…</span>
            ) : (
              <button
                key={p}
                className={`admin-pagination-page ${p === page ? 'active' : ''}`}
                onClick={() => onPageChange(p)}
                disabled={loading}
              >
                {p}
              </button>
            )
          )}
        </div>

        {/* Next button */}
        <button
          className="admin-btn admin-btn-secondary admin-btn-small"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || loading}
        >
          Next →
        </button>

        {/* Jump to page */}
        {totalPages > 5 && (
          <div className="admin-pagination-jump">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={handleJumpKeyDown}
              placeholder="Go to"
              className="admin-pagination-input"
              disabled={loading}
            />
            <button
              className="admin-btn admin-btn-secondary admin-btn-small"
              onClick={handleJump}
              disabled={loading || !jumpValue}
            >
              Go
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
