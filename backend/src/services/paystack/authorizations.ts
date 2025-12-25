// Paystack Authorizations - Card Token Management

import { paystackFetch } from './client.js'

/**
 * Deactivate an authorization (revoke card payment permission)
 *
 * Call when:
 * - User deletes their account
 * - User requests to remove a saved card
 * - Subscription is permanently canceled
 */
export async function deactivateAuthorization(authorizationCode: string): Promise<boolean> {
  try {
    await paystackFetch<{ message: string }>('/customer/deactivate_authorization', {
      method: 'POST',
      body: JSON.stringify({
        authorization_code: authorizationCode,
      }),
    })
    console.log(`[paystack] Deactivated authorization ${authorizationCode.slice(0, 8)}...`)
    return true
  } catch (error) {
    console.error(`[paystack] Failed to deactivate authorization ${authorizationCode.slice(0, 8)}...:`, error)
    return false
  }
}

/**
 * Batch deactivate multiple authorizations
 * Used when deleting a user with multiple subscriptions
 */
export async function deactivateAuthorizationsBatch(authorizationCodes: string[]): Promise<{
  success: number
  failed: number
}> {
  let success = 0
  let failed = 0

  for (const code of authorizationCodes) {
    const result = await deactivateAuthorization(code)
    if (result) {
      success++
    } else {
      failed++
    }
    // Small delay to avoid rate limiting
    if (authorizationCodes.length > 5) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return { success, failed }
}
