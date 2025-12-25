import { useState, useRef, useCallback, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import './PullToRefresh.css'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: ReactNode
  disabled?: boolean
  threshold?: number // Pixels to pull before triggering refresh
}

export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  threshold = 80,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const currentY = useRef(0)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || isRefreshing) return

    // Only start pull if we're at the top of the scroll container
    const container = containerRef.current
    if (!container || container.scrollTop > 5) return

    startY.current = e.touches[0].clientY
    currentY.current = startY.current
    setIsPulling(true)
  }, [disabled, isRefreshing])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || disabled || isRefreshing) return

    const container = containerRef.current
    if (!container || container.scrollTop > 5) {
      setIsPulling(false)
      setPullDistance(0)
      return
    }

    currentY.current = e.touches[0].clientY
    const diff = currentY.current - startY.current

    if (diff > 0) {
      // Apply resistance - pull feels heavier as you pull further
      const resistance = 0.4
      const distance = Math.min(diff * resistance, threshold * 1.5)
      setPullDistance(distance)

      // Prevent scroll bounce on iOS
      if (distance > 10) {
        e.preventDefault()
      }
    }
  }, [isPulling, disabled, isRefreshing, threshold])

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling) return

    setIsPulling(false)

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true)
      setPullDistance(threshold) // Keep at threshold while refreshing

      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [isPulling, pullDistance, threshold, isRefreshing, onRefresh])

  // Calculate progress (0-1) for animations
  const progress = Math.min(pullDistance / threshold, 1)
  const isTriggered = progress >= 1

  return (
    <div
      ref={containerRef}
      className="pull-to-refresh-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className={`pull-indicator ${isRefreshing ? 'refreshing' : ''} ${isTriggered ? 'triggered' : ''}`}
        style={{
          height: pullDistance,
          opacity: progress,
        }}
      >
        <div
          className="pull-indicator-icon"
          style={{
            transform: `rotate(${progress * 180}deg) scale(${0.5 + progress * 0.5})`,
          }}
        >
          <RefreshCw size={20} className={isRefreshing ? 'spinning' : ''} />
        </div>
        <span className="pull-indicator-text">
          {isRefreshing ? 'Refreshing...' : isTriggered ? 'Release to refresh' : 'Pull to refresh'}
        </span>
      </div>

      {/* Content with transform */}
      <div
        className="pull-content"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: isPulling ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}
