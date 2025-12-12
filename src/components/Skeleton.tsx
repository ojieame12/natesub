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

type PageSkeletonVariant = 'default' | 'list' | 'detail' | 'form'

interface PageSkeletonProps {
  variant?: PageSkeletonVariant
}

/**
 * PageSkeleton - Full page loading skeleton for Suspense fallback
 * Matches common page layouts to prevent layout shift
 */
export function PageSkeleton({ variant = 'default' }: PageSkeletonProps) {
  return (
    <div className="page-skeleton">
      {/* Header */}
      <div className="page-skeleton-header">
        <Skeleton width={24} height={24} borderRadius="var(--radius-sm)" />
        <Skeleton width={120} height={20} />
        <div style={{ width: 24 }} />
      </div>

      {/* Content */}
      <div className="page-skeleton-content">
        {variant === 'list' && (
          <>
            <Skeleton width="40%" height={28} style={{ marginBottom: 16 }} />
            <SkeletonList count={5} />
          </>
        )}

        {variant === 'detail' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <SkeletonAvatar size={80} />
              <Skeleton width={160} height={24} />
              <Skeleton width={100} height={16} />
            </div>
            <SkeletonCard height={120} />
            <SkeletonText lines={4} />
          </>
        )}

        {variant === 'form' && (
          <>
            <Skeleton width="60%" height={28} style={{ marginBottom: 8 }} />
            <Skeleton width="80%" height={16} style={{ marginBottom: 24 }} />
            <Skeleton height={48} style={{ marginBottom: 16 }} borderRadius="var(--radius-md)" />
            <Skeleton height={48} style={{ marginBottom: 16 }} borderRadius="var(--radius-md)" />
            <Skeleton height={48} style={{ marginBottom: 24 }} borderRadius="var(--radius-md)" />
            <Skeleton height={52} borderRadius="var(--radius-lg)" />
          </>
        )}

        {variant === 'default' && (
          <>
            <Skeleton width="50%" height={28} style={{ marginBottom: 16 }} />
            <SkeletonCard height={100} />
            <div style={{ marginTop: 24 }}>
              <Skeleton width="30%" height={16} style={{ marginBottom: 12 }} />
              <SkeletonList count={3} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Skeleton
