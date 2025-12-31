/**
 * Playwright Global Teardown
 *
 * Cleans up all E2E test data after the test suite completes.
 * This prevents database bloat and connection pool exhaustion.
 */

const API_URL = 'http://localhost:3001'
const E2E_API_KEY = process.env.E2E_API_KEY || 'e2e-local-dev-key'

export default async function globalTeardown() {
  console.log('[e2e] Running global teardown - cleaning up test data...')

  try {
    const response = await fetch(`${API_URL}/e2e/cleanup`, {
      method: 'POST',
      headers: {
        'x-e2e-api-key': E2E_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}), // Clean all E2E data (no runId = clean everything)
    })

    if (response.ok) {
      const result = await response.json()
      console.log('[e2e] Cleanup complete:', result.deleted)
    } else {
      console.warn('[e2e] Cleanup failed:', response.status, await response.text())
    }
  } catch (error) {
    // Server might already be stopped - that's okay
    console.warn('[e2e] Cleanup skipped (server may be stopped):', (error as Error).message)
  }
}
