import { db } from '../db/client.js'
import { generateTokenNonce } from './cancelToken.js'

/**
 * Ensure a subscription has a manage token nonce.
 *
 * This lazily backfills legacy rows where manageTokenNonce is null so
 * token revocation checks are consistently enforceable.
 */
export async function ensureManageTokenNonce(
  subscriptionId: string,
  currentNonce: string | null | undefined
): Promise<string> {
  if (currentNonce) return currentNonce

  const newNonce = generateTokenNonce()

  // Try to set nonce only if still null (safe for concurrent workers).
  const updated = await db.subscription.updateMany({
    where: {
      id: subscriptionId,
      manageTokenNonce: null,
    },
    data: {
      manageTokenNonce: newNonce,
    },
  })

  if (updated.count > 0) return newNonce

  // Another request likely set it first; read canonical value.
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    select: { manageTokenNonce: true },
  })

  return subscription?.manageTokenNonce || newNonce
}
