/**
 * Shared platform-subscription gate — the ONE answer to "is this trial/paid
 * record still live?", for every caller on both sides of the wire: the server
 * (api/school/subscription.ts, the class-coverage entitlement cascade in
 * api/_utils/classCoverage.ts, the offline-lease resolver) and the browser
 * (packages/player-vue/src/composables/schools/useSchoolContext.ts, which used
 * to keep a hand-written mirror of this math).
 *
 * It lives in @ssi/core precisely so those two cannot drift.
 */

/**
 * A TRIAL WITH NO END DATE MUST NOT MEAN FOREVER (Tom, 2026-09-09).
 *
 * A `trial` row with a NULL `platform_expires_at` used to fail OPEN with no
 * bound at all, on the reading that it is a transient pre-provisioning state.
 * It is not transient in practice: measured on production 2026-09-08, six of
 * 42 schools sat in it, three of them ordinary signups that had been there for
 * days — free dashboard access for as long as the row exists.
 *
 * So the window is BOUNDED. The row stays fail-open only for this grace after
 * its own creation; past that it is INACTIVE.
 *
 * Why 24 hours. Provisioning stamps the expiry in the SAME HTTP request that
 * inserts the school row — api/onboarding/provision.ts creates the school, then
 * calls provisionSchoolPlatformTrial a few hundred milliseconds later. The real
 * transient window is sub-second. The only honest reason to allow longer is a
 * signup that errored between the two writes and is rescued when the admin
 * comes back and re-provisions, which is minutes to hours. 24h is a large
 * margin over both and still nothing like "forever".
 */
export const PLATFORM_TRIAL_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * The platform gate, applied identically everywhere it's checked:
 *   active = status === 'active'
 *         || status == null                       (legacy / pre-migration)
 *         || (status === 'trial' && expires_at > now)
 *         || (status === 'trial' && expires_at == null
 *             && created_at is within PLATFORM_TRIAL_GRACE_MS)
 *
 * NULL / absent status still fails OPEN (true) — legacy rows and pre-migration
 * DBs. An ELAPSED trial (non-null expiry in the past) or an explicit
 * expired/past_due/cancelled locks, as before.
 *
 * `createdAt` is the ROW's own creation timestamp (schools/teachers/groups all
 * carry `created_at`, non-null). An unstamped trial whose createdAt is UNKNOWN
 * resolves INACTIVE: without it there is no way to tell mid-signup from
 * indefinite, and "no end date" must never be the answer that grants access.
 * Every caller can supply it — pass it.
 */
export function isPlatformActive(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
  createdAt?: string | null | undefined,
): boolean {
  if (status == null) return true // legacy / pre-migration → fail open
  if (status === 'active') return true
  if (status === 'trial') {
    if (expiresAt) return new Date(expiresAt).getTime() > Date.now()
    return isWithinTrialGrace(createdAt)
  }
  return false // past_due | expired | cancelled
}

/** True while an unstamped row is still inside its provisioning grace. */
export function isWithinTrialGrace(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false
  const t = new Date(createdAt).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t < PLATFORM_TRIAL_GRACE_MS
}

/**
 * True for the state this file exists to close: a trial that carries no end
 * date and is past its grace. Used by the surfaces that must SAY SO — an
 * invisible lockout is the same class of fault as an invisible free ride.
 */
export function isUnstampedTrialLapsed(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
  createdAt?: string | null | undefined,
): boolean {
  return status === 'trial' && !expiresAt && !isWithinTrialGrace(createdAt)
}
