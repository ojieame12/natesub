/**
 * Pagination - Table pagination controls
 */

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  limit: number
  onPageChange: (page: number) => void
}

export default function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
}: PaginationProps) {
  const start = (page - 1) * limit + 1
  const end = Math.min(page * limit, total)

  return (
    <div className="admin-pagination">
      <div className="admin-pagination-info">
        Showing {start}-{end} of {total}
      </div>
      <div className="admin-pagination-buttons">
        <button
          className="admin-btn admin-btn-secondary admin-btn-small"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </button>
        <button
          className="admin-btn admin-btn-secondary admin-btn-small"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  )
}
