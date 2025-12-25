import { useState, useRef, useEffect } from 'react'
import { Check, ChevronsRight } from 'lucide-react'

interface SlideToPayProps {
    onComplete: () => void
    disabled?: boolean
}

/**
 * SlideToPay - Draggable slider button for payment confirmation
 *
 * Features:
 * - Touch and mouse drag support
 * - Visual progress feedback
 * - Completion threshold (90% drag)
 * - Animated bounce hint
 */
export default function SlideToPay({ onComplete, disabled }: SlideToPayProps) {
    const [dragWidth, setDragWidth] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const [completed, setCompleted] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const startX = useRef(0)

    const handleStart = (clientX: number) => {
        if (completed || disabled) return
        setIsDragging(true)
        startX.current = clientX
    }

    const handleMove = (clientX: number) => {
        if (!isDragging || !containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        const maxDrag = rect.width - 44
        const offsetX = clientX - startX.current
        const newWidth = Math.max(0, Math.min(offsetX, maxDrag))
        setDragWidth(newWidth)

        if (newWidth > maxDrag * 0.9) {
            setIsDragging(false)
            setCompleted(true)
            setDragWidth(maxDrag)
            onComplete()
        }
    }

    const handleEnd = () => {
        if (!isDragging) return
        setIsDragging(false)
        if (!completed) setDragWidth(0)
    }

    const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX)
    const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX)
    const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX)
    const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX)
    const onTouchEnd = () => handleEnd()

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mouseup', handleEnd)
            window.addEventListener('touchend', handleEnd)
        } else {
            window.removeEventListener('mouseup', handleEnd)
            window.removeEventListener('touchend', handleEnd)
        }
        return () => {
            window.removeEventListener('mouseup', handleEnd)
            window.removeEventListener('touchend', handleEnd)
        }
    }, [isDragging])

    return (
        <div
            ref={containerRef}
            style={{
                background: '#f1f1ee',
                height: 48,
                position: 'relative',
                overflow: 'hidden',
                userSelect: 'none',
                touchAction: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                border: '1px solid #e5e5e5',
            }}
            onMouseMove={isDragging ? onMouseMove : undefined}
        >
            {/* Progress fill */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: dragWidth + 44,
                    background: 'linear-gradient(135deg, #FFD208 0%, #FF941A 100%)',
                    transition: isDragging ? 'none' : 'width 0.3s ease',
                }}
            />

            {/* Label */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: completed ? 'white' : '#666',
                    fontWeight: 600,
                    fontSize: 11,
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                    pointerEvents: 'none',
                    opacity: Math.max(0, 1 - dragWidth / 100),
                }}
            >
                {completed ? 'PROCESSING' : 'SLIDE TO PAY'}
            </div>

            {/* Drag handle */}
            <div
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove as React.TouchEventHandler}
                onTouchEnd={onTouchEnd}
                style={{
                    height: 46,
                    width: 44,
                    top: 0,
                    left: 0,
                    position: 'absolute',
                    background: completed ? 'white' : '#fff',
                    transform: `translateX(${dragWidth}px)`,
                    transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRight: '1px solid #e5e5e5',
                    zIndex: 2,
                    cursor: 'grab',
                    boxShadow: '4px 0 15px rgba(0,0,0,0.1)',
                }}
            >
                <div
                    style={{
                        animation: !completed ? 'slide-bounce 1.5s infinite' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    {completed ? (
                        <Check size={20} color="#10b981" />
                    ) : (
                        <ChevronsRight size={20} color="#333" />
                    )}
                </div>
            </div>

            <style>{`
                @keyframes slide-bounce {
                    0%, 100% { transform: translateX(0); }
                    50% { transform: translateX(3px); }
                }
            `}</style>
        </div>
    )
}
