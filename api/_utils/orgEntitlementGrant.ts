/**
 * The org free period, as a row — api/_utils/orgEntitlementGrant.ts
 * ================================================================
 *
 * An enrolment is a promise; the `user_entitlements` row is the thing that
 * keeps it. Two writers need to make that row and they must agree exactly:
 * api/org/enrol.ts on the way in, and api/cron/org-entitlement-reconcile.ts
 * afterwards for anything that slipped through. So the rule lives here once.
 *
 * THE FAILURE THIS EXISTS TO PREVENT. The entitlement insert used to be
 * swallowed as non-fatal while the endpoint still answered `success: true`
 * with a date on it — so a learner could be told their free year ran to next
 * September and hold nothing at all. Nothing downstream noticed:
 * api/_utils/orgFreeAccess.ts reads the INTERSECTION of policy and
 * entitlement, so an empty intersection simply sells them a course their
 * funder had already paid for, silently, for a year.
 *
 * IDEMPOTENCY IS READ-THEN-WRITE, and it has to be. `user_entitlements` has
 * no unique constraint that would catch a duplicate of this shape: its
 * constraints are UNIQUE (learner_id, entitlement_code_id) and a partial
 * unique index on (learner_id, email_access_grant_id), and an org grant sets
 * NEITHER column. So a refresh would happily write a second grant. We look
 * first, and only insert when nothing live already covers the courses.
 *
 * A benign double-insert under a genuine race is acceptable and is the right
 * way round: two grants of the same courses cost nothing, a missing one costs
 * a learner their year.
 */

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Namespace for org-grant ids. Arbitrary, fixed, and never reused elsewhere. */
const ORG_GRANT_NAMESPACE = 'ssi:org-enrolment-free-period'

/**
 * The id an org grant WOULD have, derived from the learner and the group.
 *
 * THE FAILURE THIS EXISTS TO PREVENT. Read-then-write alone loses a genuine
 * race: ten simultaneous taps from one impatient learner on a slow phone all
 * read "no entitlement" before any of them writes, and ten grants land. The
 * primary key is the only unique constraint on this table an org grant can
 * reach — entitlement_code_id and email_access_grant_id are both null here —
 * so we compute the key instead of letting the database invent one. The
 * second writer then gets 23505 and stops, which is what "exactly one grant"
 * actually costs.
 *
 * A UUIDv5 by hand: sha1 of namespace + name, with the version and variant
 * bits set. Deterministic across processes and deployments, which is the whole
 * point.
 */
export function orgGrantId(learnerId: string, groupId: string): string {
  const h = createHash('sha1').update(`${ORG_GRANT_NAMESPACE}:${learnerId}:${groupId}`).digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface EntitlementRow {
  access_type: string
  granted_courses: string[] | null
  expires_at: string | null
}

/**
 * Does this learner already hold a live entitlement unlocking every course the
 * policy grants? A 'full' entitlement covers the lot; a 'courses' one covers
 * what it lists. An expired row covers nothing — the same reading
 * api/_utils/orgFreeAccess.ts does, kept deliberately identical.
 */
export function coversCourses(rows: EntitlementRow[], grantedCourses: string[], now: Date = new Date()): boolean {
  if (!grantedCourses.length) return true
  const unlocked = new Set<string>()
  let full = false
  for (const e of rows) {
    if (e.expires_at && new Date(e.expires_at) <= now) continue
    if (e.access_type === 'full') full = true
    if (e.access_type === 'courses' && Array.isArray(e.granted_courses)) {
      for (const code of e.granted_courses) unlocked.add(code)
    }
  }
  return full || grantedCourses.every((c) => unlocked.has(c))
}

export type GrantOutcome =
  | { status: 'already' }
  | { status: 'granted' }
  | { status: 'failed'; error: unknown }

/**
 * Make sure the grant exists, exactly once.
 *
 * `expiresAt` MUST be the enrolment row's own free_access_until, never a
 * freshly computed date: the learner's year runs from THEIR enrolment, and
 * recomputing it on a retry would quietly extend it every time they refreshed.
 */
export async function ensureOrgEntitlement(
  supabase: SupabaseClient,
  learnerId: string,
  groupId: string,
  grantedCourses: string[],
  expiresAt: string,
  now: Date = new Date(),
): Promise<GrantOutcome> {
  if (!grantedCourses?.length) return { status: 'already' }

  const { data, error: readErr } = await supabase
    .from('user_entitlements')
    .select('access_type, granted_courses, expires_at')
    .eq('learner_id', learnerId)

  // A read we could not do is NOT permission to write a second grant — but it
  // is also not permission to leave the learner with none. Treat it as a
  // failure and let the caller decide; the reconcile cron will come back.
  if (readErr) return { status: 'failed', error: readErr }

  if (coversCourses((data ?? []) as EntitlementRow[], grantedCourses, now)) return { status: 'already' }

  const { error: insErr } = await supabase.from('user_entitlements').insert({
    id: orgGrantId(learnerId, groupId),
    learner_id: learnerId,
    access_type: 'courses',
    granted_courses: grantedCourses,
    expires_at: expiresAt,
  })
  // 23505 means a concurrent writer got there first with the same computed id.
  // That is success, not failure — the row the learner needs exists.
  if (insErr && (insErr as { code?: string }).code === '23505') return { status: 'already' }
  if (insErr) return { status: 'failed', error: insErr }
  return { status: 'granted' }
}
