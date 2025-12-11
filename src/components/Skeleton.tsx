import type { CSSProperties } from 'react'
import './Skeleton.css'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string
  className?: string
  style?: CSSProperties
}

/**
 * Skeleton - Loading placeholder with shimmer animation
 *
 * Usage:
 * <Skeleton width="100%" height={20} />
 * <Skeleton width={200} height={200} borderRadius="var(--radius-full)" />
 */
export function Skeleton({
  width = '100%',
  height = 20,
  borderRadius = 'var(--radius-sm)',
  className = '',
  style,
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius,
        ...style,
      }}
    />
  )
}

// Common skeleton presets
export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={14}
          width={i === lines - 1 ? '60%' : '100%'}
        />
      ))}
    </div>
  )
}

export function SkeletonAvatar({ size = 48 }: { size?: number }) {
  return (
    <Skeleton
      width={size}
      height={size}
      borderRadius="var(--radius-full)"
    />
  )
}

export function SkeletonCard({ height = 100 }: { height?: number }) {
  return (
    <div className="skeleton-card">
      <Skeleton height={height} borderRadius="var(--radius-lg)" />
    </div>
  )
}

export function SkeletonListItem() {
  return (
    <div className="skeleton-list-item">
      <SkeletonAvatar size={44} />
      <div className="skeleton-list-item-content">
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" height={12} />
      </div>
    </div>
  )
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </div>
  )
}

export default Skeleton
