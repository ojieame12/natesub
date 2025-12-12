import { useState, useEffect, useRef } from 'react'

interface AnimatedNumberProps {
    value: number
    duration?: number
    className?: string
    /** Format function for displaying the number */
    format?: (value: number) => string
}

/**
 * AnimatedNumber - Rolls up numbers for a premium feel
 * Used for currency values, stats, and metrics
 */
export function AnimatedNumber({
    value,
    duration = 500,
    className = '',
    format = (n) => n.toString(),
}: AnimatedNumberProps) {
    const [displayValue, setDisplayValue] = useState(value)
    const previousValue = useRef(value)
    const frameRef = useRef<number | undefined>(undefined)
    const startTime = useRef<number | undefined>(undefined)

    useEffect(() => {
        // Skip animation if values are the same
        if (value === previousValue.current) return

        const from = previousValue.current
        const to = value
        previousValue.current = value

        // Cancel any existing animation
        if (frameRef.current) {
            cancelAnimationFrame(frameRef.current)
        }

        const start = Date.now()
        startTime.current = start

        const animate = () => {
            const elapsed = Date.now() - (startTime.current || start)
            const progress = Math.min(elapsed / duration, 1)

            // Ease out cubic for smooth deceleration
            const easeOut = 1 - Math.pow(1 - progress, 3)

            const current = from + (to - from) * easeOut
            setDisplayValue(Math.round(current))

            if (progress < 1) {
                frameRef.current = requestAnimationFrame(animate)
            } else {
                setDisplayValue(to)
            }
        }

        frameRef.current = requestAnimationFrame(animate)

        return () => {
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current)
            }
        }
    }, [value, duration])

    return (
        <span
            className={`animated-number ${className}`}
            style={{ fontVariantNumeric: 'tabular-nums' }}
        >
            {format(displayValue)}
        </span>
    )
}

/**
 * AnimatedCurrency - AnimatedNumber preset for currency values
 */
interface AnimatedCurrencyProps {
    value: number
    symbol?: string
    duration?: number
    className?: string
    showDecimals?: boolean
}

export function AnimatedCurrency({
    value,
    symbol = '$',
    duration = 500,
    className = '',
    showDecimals = false,
}: AnimatedCurrencyProps) {
    const format = (n: number) => {
        if (showDecimals) {
            return `${symbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        }
        return `${symbol}${n.toLocaleString('en-US')}`
    }

    return (
        <AnimatedNumber
            value={value}
            duration={duration}
            className={className}
            format={format}
        />
    )
}
