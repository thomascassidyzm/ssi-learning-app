/**
 * The ONE population resolver for the delivery-side intelligence surface.
 *
 * docs/delivery-side-intelligence-surface.md §3.5: "Every server endpoint the
 * surface reads from applies one shared population resolver... The resolver has
 * one test and every endpoint imports it. No page filters on its own." The two
 * errors that have already burned analysis in this repo are counting machines
 * and counting demo rows, and both of them happen when each surface writes its
 * own filter.
 *
 * WHAT IS EXCLUDED, and where each rule comes from:
 *
 *   1. Everything `test_learner_ids()` already excludes — demo rows, is_internal
 *      rows, thomas.cassidy+ addresses, and anyone tied to an is_test school.
 *      That function (supabase/migrations/20260715_test_learner_exclusion.sql)
 *      is the canonical definition and feeds board metrics and the
 *      daily_contributions trigger, so this resolver CALLS it rather than
 *      forking a second copy that can drift.
 *
 *   2. Staff platform roles — ssi_admin, tester, popty_user. The canonical
 *      function does not know these exist: it back-filled is_internal once, in
 *      2026-07, and nothing has set the flag since. Any staff row created after
 *      that back-fill is invisible to it. api/code/redeem.ts now sets
 *      is_internal at the moment it grants a platform_role, which closes the
 *      gap going forward; this rule closes it for every row already written.
 *
 *   3. Class entities — learners.is_class_entity. A class practising together
 *      is one row, and it is not a person.
 *
 *   4. Events from the two known machine countries. Japan and Finland are
 *      machines: Japan alone is 21% of events and 61% of audio retries. This is
 *      an EVENT-level rule rather than a learner-level one, so it is exposed
 *      separately as isMachineCountry().
 *
 * WHAT IS DELIBERATELY NOT EXCLUDED, and this one is a ruling rather than a
 * limitation (Tom, 2026-09-10): PEOPLE WHO DO NOT PAY. A comped teacher, a
 * gifted friend and a pilot school are real humans genuinely learning; their
 * sessions, weak points and drop-off are true signal, and hiding them makes
 * every number LESS accurate rather than safer. Whether somebody pays is a fact
 * about billing and lives in api/_utils/entitlementCohort.ts, which SPLITS this
 * population into paying / gifted / free without removing anybody from it. This
 * resolver has no opinion on money and must never acquire one.
 *
 * WHAT IS NOT EXCLUDED, stated rather than papered over: headless user agents.
 * player_events stores no user agent — the columns are id, occurred_at,
 * user_id, course_code, session_id, event_type, payload, client_version,
 * device_type, ip_country, env, learner_id — so there is nothing to test. The
 * country rule is the only machine filter available today.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Platform roles that mean staff or QA, never a real learner. */
export const STAFF_PLATFORM_ROLES = ['ssi_admin', 'tester', 'popty_user'] as const

/**
 * Countries whose traffic is machines. Japan and Finland are automated probes,
 * not people; excluding them is a rule, not a judgement call made per page.
 */
export const MACHINE_COUNTRIES = ['JP', 'FI'] as const

export function isMachineCountry(country: string | null | undefined): boolean {
  if (!country) return false
  return (MACHINE_COUNTRIES as readonly string[]).includes(country.toUpperCase())
}

export interface RealLearnerPopulation {
  /** learners.id of every real person. */
  realIds: Set<string>
  /** learners.id of everyone excluded, for the rare page that wants the other side. */
  excludedIds: Set<string>
  /** realIds.size, which is the number the population chip prints. */
  count: number
}

/**
 * Resolve the real-learner population. Takes a SERVICE-ROLE client, because
 * test_learner_ids() is granted to service_role only.
 *
 * Never throws on a partial failure of the canonical function: if the RPC is
 * unavailable, the flag-based rules still apply and the caller gets a
 * population that is too CAUTIOUS rather than too generous. Over-excluding
 * undercounts; under-excluding lies.
 */
export async function resolveRealLearners(svc: SupabaseClient): Promise<RealLearnerPopulation> {
  const excludedIds = new Set<string>()

  // Rule 1 — the canonical set.
  const { data: testRows } = await svc.rpc('test_learner_ids')
  for (const row of (testRows ?? []) as { learner_id: string }[]) {
    if (row?.learner_id) excludedIds.add(row.learner_id)
  }

  // Rules 2 and 3, plus the full roster we subtract from.
  const { data: learners, error } = await svc
    .from('learners')
    .select('id, is_class_entity, platform_role')

  if (error || !learners) {
    // No roster means no honest answer. An empty population reads as "too few
    // to say" everywhere downstream, which is the correct thing for a page to
    // say when it could not count.
    return { realIds: new Set(), excludedIds, count: 0 }
  }

  const realIds = new Set<string>()
  for (const l of learners as { id: string; is_class_entity: boolean | null; platform_role: string | null }[]) {
    const isStaff = !!l.platform_role && (STAFF_PLATFORM_ROLES as readonly string[]).includes(l.platform_role)
    if (isStaff || l.is_class_entity) excludedIds.add(l.id)
    if (!excludedIds.has(l.id)) realIds.add(l.id)
  }

  return { realIds, excludedIds, count: realIds.size }
}
