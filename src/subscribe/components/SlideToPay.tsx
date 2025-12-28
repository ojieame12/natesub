import { useState, useRef, useEffect } from 'react'
import { Check } from 'lucide-react'

// Colors matching design system
const COLORS = {
    neutral100: '#F5F5F4',
    neutral200: '#E7E5E4',
    neutral400: '#A8A29E',
    neutral900: '#1C1917',
    white: '#FFFFFF',
}

// Filled double arrow icon
function FilledArrows({ color }: { color: string }) {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M6 4L12 10L6 16" fill={color} />
            <path d="M10 4L16 10L10 16" fill={color} />
        </svg>
    )
}

interface SlideToPayProps {
    onComplete: () => void
    disabled?: boolean
}

/**
 * SlideToPay - Draggable slider button for payment confirmation
 *
 * Design: Pill-shaped track with circular handle
 * - Inactive: Light gray handle
 * - Active/Ready: Black handle
 * - Completion at 90% drag
 */
export default function SlideToPay({ onComplete, disabled }: SlideToPayProps) {
    const [dragX, setDragX] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const [completed, setCompleted] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const startX = useRef(0)
    // Use ref to prevent multiple onComplete calls (state updates are async)
    const completedRef = useRef(false)

    const HANDLE_SIZE = 48
    const TRACK_HEIGHT = 64
    const TRACK_PADDING = 8

    const handleStart = (clientX: number) => {
        if (completed || disabled) return
        setIsDragging(true)
        startX.current = clientX - dragX
    }

    const handleMove = (clientX: number) => {
        // Check ref synchronously to prevent duplicate calls
        if (!isDragging || !containerRef.current || completedRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        const maxDrag = rect.width - HANDLE_SIZE - (TRACK_PADDING * 2)
        const newX = Math.max(0, Math.min(clientX - startX.current, maxDrag))
        setDragX(newX)

        // Complete at 90% threshold - use ref to guarantee single execution
        if (newX > maxDrag * 0.9) {
            completedRef.current = true // Set immediately to block concurrent calls
            setIsDragging(false)
            setCompleted(true)
            setDragX(maxDrag)
            onComplete()
        }
    }

    const handleEnd = () => {
        if (!isDragging) return
        setIsDragging(false)
        if (!completed) {
            setDragX(0)
        }
    }

    const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX)
    const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX)
    const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX)

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => handleMove(e.clientX)
        const onMouseUp = () => handleEnd()
        const onTouchEnd = () => handleEnd()
        const onTouchCancel = () => handleEnd() // Handle touch interruption (e.g., notification)

        if (isDragging) {
            window.addEventListener('mousemove', onMouseMove)
            window.addEventListener('mouseup', onMouseUp)
            window.addEventListener('touchend', onTouchEnd)
            window.addEventListener('touchcancel', onTouchCancel)
        }

        return () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            window.removeEventListener('touchend', onTouchEnd)
            window.removeEventListener('touchcancel', onTouchCancel)
        }
    }, [isDragging])

    // Determine handle color based on state
    const isActive = !disabled && !completed
    const handleColor = isActive ? COLORS.neutral900 : COLORS.white
    const handleBorder = isActive ? 'none' : `1px solid ${COLORS.neutral200}`
    const iconColor = isActive ? COLORS.white : COLORS.neutral400

    return (
        <div
            ref={containerRef}
            style={{
                background: COLORS.neutral100,
                height: TRACK_HEIGHT,
                borderRadius: TRACK_HEIGHT / 2, // Pill shape
                position: 'relative',
                overflow: 'hidden',
                userSelect: 'none',
                touchAction: 'none',
                cursor: disabled ? 'not-allowed' : 'default',
                opacity: disabled ? 0.6 : 1,
            }}
        >
            {/* Gradient fill that follows the drag - only shows when actively sliding */}
            {dragX > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        height: '100%',
                        // End at center of handle so the handle covers the edge
                        width: dragX + TRACK_PADDING + (HANDLE_SIZE / 2),
                        // Gradient fades to transparent at the right edge for smooth look
                        background: 'linear-gradient(90deg, #FFD208 0%, #FF941A 60%, transparent 100%)',
                        // Only round the left side - right edge hidden by handle
                        borderTopLeftRadius: TRACK_HEIGHT / 2,
                        borderBottomLeftRadius: TRACK_HEIGHT / 2,
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                        transition: isDragging ? 'none' : 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                        pointerEvents: 'none',
                    }}
                />
            )}

            {/* Label */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: completed ? COLORS.neutral900 : COLORS.neutral400,
                    fontWeight: 500,
                    fontSize: 15,
                    pointerEvents: 'none',
                    opacity: Math.max(0.3, 1 - dragX / 80),
                    transition: completed ? 'opacity 0.3s ease' : 'none',
                }}
            >
                {completed ? 'Processing...' : 'Slide to Pay'}
            </div>

            {/* Circular Drag Handle */}
            <div
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                style={{
                    position: 'absolute',
                    top: TRACK_PADDING,
                    left: TRACK_PADDING,
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    borderRadius: '50%', // Circular
                    background: handleColor,
                    border: handleBorder,
                    transform: `translateX(${dragX}px)`,
                    transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: disabled ? 'not-allowed' : 'grab',
                    boxShadow: isActive
                        ? '0 4px 16px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.1)'
                        : '0 2px 8px rgba(0,0,0,0.1)',
                    zIndex: 2,
                }}
            >
                <div
                    style={{
                        animation: !completed && !isDragging && isActive ? 'handleBounce 1.5s ease-in-out infinite' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    {completed ? (
                        <Check size={20} color="#10b981" strokeWidth={2.5} />
                    ) : (
                        <FilledArrows color={iconColor} />
                    )}
                </div>
            </div>

            <style>{`
                @keyframes handleBounce {
                    0%, 100% { transform: translateX(0); }
                    50% { transform: translateX(4px); }
                }
            `}</style>
        </div>
    )
}
