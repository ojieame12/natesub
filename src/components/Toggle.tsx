import { useCallback } from 'react'

interface ToggleProps {
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label?: string
}

/**
 * Toggle - Accessible switch component
 *
 * Features:
 * - Proper ARIA semantics (role="switch", aria-checked)
 * - Keyboard accessible (Enter/Space to toggle)
 * - Focus visible styling support
 * - Disabled state handling
 */
export function Toggle({ value, onChange, disabled, label }: ToggleProps) {
  const handleClick = useCallback(() => {
    if (!disabled) {
      onChange(!value)
    }
  }, [disabled, onChange, value])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onChange(!value)
    }
  }, [disabled, onChange, value])

  return (
    <div
      role="switch"
      aria-checked={value}
      aria-disabled={disabled || undefined}
      aria-label={label}
      tabIndex={disabled ? -1 : 0}
      className={`toggle ${value ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="toggle-knob" />
    </div>
  )
}

export default Toggle
