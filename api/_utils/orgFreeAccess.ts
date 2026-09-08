/**
 * FREE ACCESS THROUGH A FUNDED ORG ENROLMENT — the answer to "should this
 * learner ever be shown a price?"
 *
 * A Canolfan (National Centre for Learning Welsh) learner enrols through
 * api/org/enrol, which writes an `org_enrolments` row carrying
 * `free_access_until` — their year, running from their own enrolment date.
 * Content ACCESS already followed, because enrolment also writes a
 * `user_entitlements` row that `checkCourseAccess` honours. What did NOT
 * follow is the SELLING: every upgrade prompt in the app is driven by
 * "is there an active Paddle subscription?", and a funded learner has none.
 * So somebody whose year is already paid for was shown "Premium £15/mo —
 * Upgrade", and the welcome pack had to carry a warning telling them to
 * ignore it. A payment warning is the thing that makes a nervous learner
 * quietly not sign up.
 *
 * This resolves the grant so /api/subscription can report it alongside the
 * subscription, and the client can suppress the prompt from ONE signal
 * rather than each surface growing its own idea of "free".
 *
 * WHAT MAKES A GRANT ACTIVE: `free_access_until > now`, and nothing else.
 * `cancellation_state` is deliberately NOT a condition — despite reading like
 * one, it records what happened to the learner's OWN prior paid subscription
 * ('not_needed' | 'needed' | 'learner_confirmed' | 'verified_cancelled', see
 * the column comment in 20260908e_org_enrolments.sql). None of its values
 * means "this enrolment is cancelled", and treating 'needed' as a
 * cancellation would strip free access from exactly the learners who are
 * paying twice.
 *
 * READ-ONLY, and it never throws: a learner is never bounced or upsold
 * because this query failed — a failure returns null, which is the same
 * answer as "no grant", i.e. the app behaves exactly as it did before.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface OrgFreeAccess {
  /** The org's `groups` row this enrolment belongs to. */
  groupId: string
  /** Display name of the funder, e.g. 'National Centre for Learning Welsh'. */
  orgName: string | null
  /** ISO timestamp when the free period ends. Always in the future here. */
  until: string
}

export async function resolveOrgFreeAccess(
  supabase: SupabaseClient,
  learnerId: string
): Promise<OrgFreeAccess | null> {
  try {
    const nowIso = new Date().toISOString()
    // Most generous first: somebody enrolled by two orgs keeps the later date.
    const { data, error } = await supabase
      .from('org_enrolments')
      .select('group_id, free_access_until')
      .eq('learner_id', learnerId)
      .gt('free_access_until', nowIso)
      .order('free_access_until', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) return null
    const row = data[0] as { group_id: string; free_access_until: string }

    // The org's name is a nicety (it makes the settings line read "free until
    // 8 September 2027, through the National Centre for Learning Welsh"), so
    // a missing policy row must not cost the learner their suppression.
    let orgName: string | null = null
    const { data: policy } = await supabase
      .from('org_enrolment_policies')
      .select('org_display_name')
      .eq('group_id', row.group_id)
      .maybeSingle()
    if (policy && typeof (policy as { org_display_name?: string }).org_display_name === 'string') {
      orgName = (policy as { org_display_name: string }).org_display_name
    }

    return { groupId: row.group_id, orgName, until: row.free_access_until }
  } catch {
    return null
  }
}
