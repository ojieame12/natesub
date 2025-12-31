import { useState, useCallback } from 'react'

/**
 * Hook that ensures a minimum duration for async operations.
 * Prevents jarring instant transitions that feel unpolished.
 *
 * @param minMs - Minimum duration in milliseconds (default: 300ms)
 * @returns { withMinLatency, isPending }
 *
 * @example
 * function SomeStep() {
 *   const { withMinLatency, isPending } = useMinLatency(300)
 *
 *   const handleNext = async () => {
 *     await withMinLatency(saveProgress())
 *     nextStep()
 *   }
 *
 *   return (
 *     <button disabled={isPending} onClick={handleNext}>
 *       {isPending ? <Spinner /> : 'Continue'}
 *     </button>
 *   )
 * }
 */
export function useMinLatency(minMs = 300) {
  const [isPending, setIsPending] = useState(false)

  const withMinLatency = useCallback(
    async <T>(promise: Promise<T>): Promise<T> => {
      setIsPending(true)
      const start = Date.now()

      try {
        const result = await promise
        const elapsed = Date.now() - start

        // If operation was faster than minimum, wait the remaining time
        if (elapsed < minMs) {
          await new Promise((resolve) => setTimeout(resolve, minMs - elapsed))
        }

        return result
      } finally {
        setIsPending(false)
      }
    },
    [minMs]
  )

  return { withMinLatency, isPending }
}
