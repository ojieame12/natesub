/**
 * Add one calendar month to a date (proper month handling)
 * Handles edge cases like Jan 31 -> Feb 28, etc.
 */
export function addOneMonth(date: Date): Date {
  const result = new Date(date)
  const currentMonth = result.getMonth()
  result.setMonth(currentMonth + 1)

  // Handle edge case: if we went too far (e.g., Jan 31 -> Mar 3)
  // Roll back to last day of intended month
  if (result.getMonth() !== (currentMonth + 1) % 12) {
    result.setDate(0) // Go to last day of previous month
  }

  return result
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase()
}
