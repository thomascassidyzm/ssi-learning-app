/**
 * Shared platform-subscription gate — the same "is this trial/paid record
 * still live?" predicate is needed by api/school/subscription.ts and the
 * class-coverage entitlement cascade (api/_utils/classCoverage.ts). Factored
 * out so both stay in lockstep instead of drifting two copies of the same
 * status math.
 */

/**
 * The platform gate, applied identically everywhere it's checked:
 *   active = status === 'active'
 *         || status == null                       (legacy / pre-migration)
 *         || (status === 'trial' && (expires_at == null || expires_at > now))
 * NULL / absent status fails OPEN (true) — legacy rows and pre-migration DBs.
 * A 'trial' with NO expiry also fails OPEN: that is the bare schools.platform_status
 * DEFAULT 'trial' (migration 20260616) before provision.ts stamps a real window,
 * a pre-lever-3 school, or a row orphaned by an email-burn 409. Only an ELAPSED
 * trial (non-null expiry in the past) or an explicit expired/past_due/cancelled locks.
 */
export function isPlatformActive(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
): boolean {
  if (status == null) return true // legacy / pre-migration → fail open
  if (status === 'active') return true
  if (status === 'trial') return !expiresAt || new Date(expiresAt).getTime() > Date.now()
  return false // past_due | expired | cancelled
}
