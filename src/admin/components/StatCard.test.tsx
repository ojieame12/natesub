import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatCard from './StatCard'

describe('StatCard', () => {
  it('shows skeleton when loading', () => {
    const { container } = render(<StatCard label="Test" value="$100" loading />)
    expect(container.querySelector('.skeleton')).toBeInTheDocument()
    expect(screen.queryByText('$100')).not.toBeInTheDocument()
  })

  it('shows value when not loading', () => {
    render(<StatCard label="Test" value="$100" loading={false} />)
    expect(screen.getByText('$100')).toBeInTheDocument()
  })

  it('shows subtext when provided', () => {
    render(<StatCard label="Test" value="$100" subtext="5 payments" />)
    expect(screen.getByText('5 payments')).toBeInTheDocument()
  })

  it('shows skeleton for subtext when loading with subtext defined', () => {
    const { container } = render(<StatCard label="Test" value="$100" subtext="5 payments" loading />)
    // Should have 2 skeletons: one for value, one for subtext
    expect(container.querySelectorAll('.skeleton').length).toBe(2)
  })

  it('applies variant class', () => {
    const { container } = render(<StatCard label="Test" value="$100" variant="success" />)
    expect(container.querySelector('.admin-stat-card.success')).toBeInTheDocument()
  })
})
