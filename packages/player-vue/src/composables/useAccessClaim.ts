/**
 * useAccessClaim — claim any email-allowlist (pre-granted) free access.
 *
 * Posts to /api/access/claim with the signed-in user's access token. The server
 * derives the email from the verified session, finds any active, unredeemed
 * email_access_grants for it, and applies them. Idempotent: returns granted:0
 * when there's nothing pending, so it's safe to call on EVERY sign-in.
 *
 * If anything was granted, refreshes the shared entitlements so the UI unlocks
 * without a reload.
 */

import { useSharedUserEntitlements } from '@/composables/useUserEntitlements'

// Single-flight per session token. Both the onAuthStateChange SIGNED_IN
// listener and App.vue's restored-session boot path claim for the same
// session, so without this every boot POSTed /api/access/claim twice.
// One claim per token is enough — the endpoint is idempotent, and a genuinely
// new sign-in arrives with a new token.
let claimedToken: string | null = null
let claimInFlight: Promise<number> | null = null

export function useAccessClaim() {
  /**
   * Claim allowlist grants for the current session.
   * @param accessToken Supabase session access token.
   * @returns number of grants applied (0 if none / on any failure).
   */
  async function claimAccess(accessToken: string): Promise<number> {
    if (!accessToken) return 0
    if (accessToken === claimedToken) return claimInFlight ?? 0
    claimedToken = accessToken
    claimInFlight = doClaim(accessToken)
    return claimInFlight
  }

  async function doClaim(accessToken: string): Promise<number> {
    try {
      const res = await fetch('/api/access/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })
      if (!res.ok) return 0
      const data = await res.json().catch(() => ({}))
      const granted: number = data?.granted ?? 0
      if (granted > 0) {
        try {
          await useSharedUserEntitlements().refresh()
        } catch {
          // entitlements refresh is best-effort
        }
      }
      return granted
    } catch {
      // Allowlist claim must never break sign-in — swallow.
      return 0
    }
  }

  return { claimAccess }
}
