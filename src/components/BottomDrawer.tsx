/**
 * BottomDrawer - Swipe-to-dismiss bottom sheet component
 *
 * Features:
 * - Swipe down to close (gesture-to-close) - scoped to handle area
 * - Velocity-based fling detection with NaN/Infinity guards
 * - Spring physics animation
 * - Backdrop tap to close
 * - Accessible: role="dialog", aria-modal, focus trap/restore
 * - Background scroll lock
 * - Portal rendering (avoids transform ancestor issues)
 * - Reduced motion support
 * - rAF-based drag for smooth 60fps motion
 */

import { useRef, useCallback, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './BottomDrawer.css'

interface BottomDrawerProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  /** Minimum drag distance to trigger close (default: 80px) */
  threshold?: number
  /** Minimum velocity to trigger fling-close (default: 0.5 px/ms) */
  velocityThreshold?: number
}

export function BottomDrawer({
  open,
  onClose,
  children,
  title,
  threshold = 80,
  velocityThreshold = 0.5,
}: BottomDrawerProps) {
  const titleId = useId()

  // Refs for smooth drag (no re-renders during drag)
  const drawerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const isClosing = useRef(false)
  const startY = useRef(0)
  const startTime = useRef(0)
  const currentOffset = useRef(0)
  const rafId = useRef<number>(0)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Check reduced motion preference (defensive for SSR/test environments)
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  )

  // Apply transform via rAF for smooth 60fps motion
  const applyTransform = useCallback((offset: number, opacity?: number) => {
    if (drawerRef.current) {
      drawerRef.current.style.transform = `translateY(${offset}px)`
    }
    if (overlayRef.current && opacity !== undefined) {
      overlayRef.current.style.opacity = String(opacity)
    }
  }, [])

  // Lock background scroll when open
  useEffect(() => {
    if (!open) return

    const scrollContainer = document.querySelector('.app-content') as HTMLElement | null
    const body = document.body

    // Lock scroll on both .app-content and body
    const originalOverflow = body.style.overflow
    const originalContentOverflow = scrollContainer?.style.overflow

    body.style.overflow = 'hidden'
    if (scrollContainer) {
      scrollContainer.style.overflow = 'hidden'
    }

    return () => {
      body.style.overflow = originalOverflow
      if (scrollContainer) {
        scrollContainer.style.overflow = originalContentOverflow || ''
      }
    }
  }, [open])

  // Focus management: trap focus and restore on close
  useEffect(() => {
    if (!open) return

    // Save previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement

    // Focus the drawer
    const drawer = drawerRef.current
    if (drawer) {
      // Small delay to ensure drawer is rendered
      requestAnimationFrame(() => {
        drawer.focus()
      })
    }

    return () => {
      // Restore focus on close
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus()
      }
    }
  }, [open])

  // Handle escape key
  useEffect(() => {
    if (!open) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  // Focus trap - keep focus within drawer
  useEffect(() => {
    if (!open) return

    const drawer = drawerRef.current
    if (!drawer) return

    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusableElements = drawer.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (!firstElement) return

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault()
        lastElement?.focus()
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault()
        firstElement?.focus()
      }
    }

    document.addEventListener('keydown', handleFocusTrap)
    return () => document.removeEventListener('keydown', handleFocusTrap)
  }, [open])

  // Reset state when drawer opens
  useEffect(() => {
    if (open) {
      isClosing.current = false
      currentOffset.current = 0
      if (drawerRef.current) {
        drawerRef.current.style.transform = ''
        drawerRef.current.classList.remove('closing')
      }
      if (overlayRef.current) {
        overlayRef.current.style.opacity = ''
        overlayRef.current.classList.remove('closing')
      }
    }
  }, [open])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only allow drag from handle area
    const target = e.target as HTMLElement
    const handleArea = target.closest('.bottom-drawer-handle-area')
    if (!handleArea) return

    startY.current = e.touches[0].clientY
    startTime.current = Date.now()
    currentOffset.current = 0
    isDragging.current = true

    // Disable transition during drag
    if (drawerRef.current) {
      drawerRef.current.style.transition = 'none'
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return

    const clientY = e.touches[0].clientY
    const diff = clientY - startY.current

    // Only allow downward drag (positive diff)
    if (diff > 0) {
      // Apply resistance - feels heavier as you drag further
      const resistance = 0.6
      currentOffset.current = diff * resistance

      // Use rAF for smooth updates
      if (rafId.current) {
        cancelAnimationFrame(rafId.current)
      }
      rafId.current = requestAnimationFrame(() => {
        const opacity = Math.max(0.3, 1 - currentOffset.current / 200)
        applyTransform(currentOffset.current, opacity)
      })

      // Prevent scroll while dragging
      e.preventDefault()
    }
  }, [applyTransform])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return
    isDragging.current = false

    // Cancel any pending rAF
    if (rafId.current) {
      cancelAnimationFrame(rafId.current)
    }

    const endTime = Date.now()
    const duration = endTime - startTime.current
    const distance = currentOffset.current / 0.6 // Undo resistance for velocity calc

    // Guard against division by zero / NaN / Infinity
    const velocity = duration > 0 ? distance / duration : 0
    const safeVelocity = Number.isFinite(velocity) ? velocity : 0

    // Re-enable transition
    if (drawerRef.current) {
      drawerRef.current.style.transition = ''
    }

    // Close if dragged past threshold OR fast fling
    if (currentOffset.current >= threshold || safeVelocity > velocityThreshold) {
      isClosing.current = true

      // Add closing class for animation
      if (drawerRef.current) {
        drawerRef.current.classList.add('closing')
        drawerRef.current.style.transform = 'translateY(100%)'
      }
      if (overlayRef.current) {
        overlayRef.current.classList.add('closing')
      }

      // Wait for animation (or immediate if reduced motion)
      const delay = prefersReducedMotion.current ? 0 : 200
      setTimeout(() => {
        onClose()
        isClosing.current = false
        currentOffset.current = 0
      }, delay)
    } else {
      // Spring back
      applyTransform(0, 1)
      currentOffset.current = 0
    }
  }, [threshold, velocityThreshold, onClose, applyTransform])

  // Handle backdrop click
  const handleBackdropClick = useCallback(() => {
    if (isClosing.current) return

    isClosing.current = true
    if (drawerRef.current) {
      drawerRef.current.classList.add('closing')
    }
    if (overlayRef.current) {
      overlayRef.current.classList.add('closing')
    }

    const delay = prefersReducedMotion.current ? 0 : 200
    setTimeout(() => {
      onClose()
      isClosing.current = false
    }, delay)
  }, [onClose])

  if (!open && !isClosing.current) return null

  const drawerContent = (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="bottom-drawer-overlay"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="bottom-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle - only this area triggers swipe */}
        <div className="bottom-drawer-handle-area">
          <div className="bottom-drawer-handle" />
        </div>

        {/* Title */}
        {title && (
          <h3 id={titleId} className="bottom-drawer-title">
            {title}
          </h3>
        )}

        {/* Content */}
        <div className="bottom-drawer-content">
          {children}
        </div>
      </div>
    </>
  )

  // Render via portal to avoid transform ancestor issues
  return createPortal(drawerContent, document.body)
}
