/**
 * FilterBar - Search and filter controls
 */

interface FilterBarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  filters?: Array<{
    name: string
    value: string
    options: Array<{ value: string; label: string }>
    onChange: (value: string) => void
  }>
  onClear?: () => void
}

export default function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters = [],
  onClear,
}: FilterBarProps) {
  const hasActiveFilters = searchValue || filters.some((f) => f.value && f.value !== 'all')

  return (
    <div className="admin-filter-bar">
      <input
        type="text"
        className="admin-search-input"
        placeholder={searchPlaceholder}
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {filters.map((filter) => (
        <select
          key={filter.name}
          className="admin-select"
          value={filter.value}
          onChange={(e) => filter.onChange(e.target.value)}
        >
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ))}
      {hasActiveFilters && onClear && (
        <button className="admin-btn admin-btn-secondary admin-btn-small" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  )
}
