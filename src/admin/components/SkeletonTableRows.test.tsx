import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SkeletonTableRows } from './SkeletonTableRows'

describe('SkeletonTableRows', () => {
  it('renders correct number of rows and columns', () => {
    const { container } = render(
      <table><tbody><SkeletonTableRows columns={5} rows={3} /></tbody></table>
    )
    expect(container.querySelectorAll('tr')).toHaveLength(3)
    expect(container.querySelectorAll('td')).toHaveLength(15)
  })

  it('uses default 5 rows when not specified', () => {
    const { container } = render(
      <table><tbody><SkeletonTableRows columns={4} /></tbody></table>
    )
    expect(container.querySelectorAll('tr')).toHaveLength(5)
    expect(container.querySelectorAll('td')).toHaveLength(20)
  })

  it('renders skeleton elements in cells', () => {
    const { container } = render(
      <table><tbody><SkeletonTableRows columns={3} rows={2} /></tbody></table>
    )
    expect(container.querySelectorAll('.skeleton')).toHaveLength(6)
  })
})
