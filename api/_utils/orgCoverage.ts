/**
 * Org-coverage entitlement — the org/workplace sibling of classCoverage.ts.
 *
 * A member affiliated to an ORG node gets ALL courses for exactly as long as
 * that org has live platform coverage (trial or paid). No member-level clock,
 * no member-level state, recomputed on every check — the same shape as the
 * class model, and for the same reason: one row (the org's) is the truth, so
 * expiry can never be stale on a member.
 *
 * WHY THIS EXISTS AT ALL. The existing cascade (`get_cascade_courses`, and
 * `resolveClassCourseCoverage`) starts from a CLASS tag and joins through
 * classes → schools. An org is *class-less by definition* (founder spec
 * 2026-08-01: "a class-less group/organisation node"), so its members match
 * nothing in either path and would be entitled to nothing at all during the
 * 30-day trial they were just sold. This closes that hole on the org axis
 * only; the class path is untouched.
 *
 * ALL COURSES, DELIBERATELY. Founder ruling 2026-08-01: the org trial is a
 * "30-day free trial covering ALL languages". That is a deliberate departure
 * from THE-MODEL.md §1.11's binary rule, where a node's TRIAL means exactly
 * one course and only PAID means all courses. The later, org-specific ruling
 * governs the org lane. Paid orgs get all courses too — an org is class-less,
 * so there is no per-class course to scope a seat to, and the seat itself is
 * what was bought.
 *
 * SCOPE RULE: a member is covered by the NEAREST ANCESTOR org that has a
 * platform status set. A sub-group ("Finance Dept") deliberately carries no
 * clock of its own — it bills through its org — so coverage is inherited up
 * the tree, exactly as the entitlement cascade inherits down it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatformActive } from './platformStatus'
import { chunk } from './schoolScope'

/** Depth cap on the ancestry walk — a guard against a cyclic parent_id, not a real depth limit. */
const MAX_ANCESTRY_DEPTH = 24

/**
 * Group node ids a user is affiliated to, from `user_tags` rows of
 * tag_type='group' (tag_value 'GROUP:<uuid>', permitted since
 * 20260718_the_model_expand).
 *
 * Deliberately NOT filtered by role_in_context: a leader is a member of their
 * own org too, and an org's staff are people it is paying a seat for. The
 * class path filters to 'student' because a teacher's access there comes from
 * their own teacher subscription; an org has no such second lane.
 */
async function affiliatedGroupIds(svc: SupabaseClient, authUid: string): Promise<string[]> {
  const { data: tags } = await svc
    .from('user_tags')
    .select('tag_value')
    .eq('user_id', authUid)
    .eq('tag_type', 'group')
    .is('removed_at', null)

  return [
    ...new Set(
      (tags ?? [])
        .map((t: any) => (t?.tag_value ? String(t.tag_value).replace('GROUP:', '') : null))
        .filter((id: string | null): id is string => !!id),
    ),
  ]
}

/**
 * Walk up from each seed node to the nearest ancestor carrying a
 * platform_status, and report whether ANY of them is currently live.
 *
 * Fetches one level at a time across ALL still-walking branches, so a member in
 * three orgs costs depth round trips, not 3×depth.
 */
async function anyAncestorOrgActive(svc: SupabaseClient, seedIds: string[]): Promise<boolean> {
  let frontier = [...seedIds]
  const visited = new Set<string>(frontier)

  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH && frontier.length > 0; depth++) {
    const rows: any[] = []
    for (const batch of chunk(frontier)) {
      const { data } = await svc
        .from('groups')
        .select('id, parent_id, platform_status, platform_expires_at')
        .in('id', batch)
      for (const r of data ?? []) rows.push(r)
    }

    const next: string[] = []
    for (const row of rows) {
      // A node with NO status is not "failing open" here — it is simply not
      // the billed node. Keep climbing to find the one that is. Only a node
      // that HAS a status answers the question.
      if (row.platform_status) {
        if (isPlatformActive(row.platform_status, row.platform_expires_at)) return true
        continue // this org's clock has run out — its subtree is not covered
      }
      if (row.parent_id && !visited.has(row.parent_id)) {
        visited.add(row.parent_id)
        next.push(row.parent_id)
      }
    }
    frontier = next
  }
  return false
}

/**
 * Resolve the course codes a member is entitled to via live ORG affiliation.
 * `authUid` MUST come from a verified JWT.
 *
 * Returns every live course code when the member's org has live coverage, and
 * an empty array otherwise — including for a user with no org affiliation at
 * all, which is the overwhelmingly common case and costs exactly one query.
 */
export async function resolveOrgCourseCoverage(
  svc: SupabaseClient,
  authUid: string,
): Promise<string[]> {
  const groupIds = await affiliatedGroupIds(svc, authUid)
  if (groupIds.length === 0) return []

  if (!(await anyAncestorOrgActive(svc, groupIds))) return []

  // "Covering ALL languages" — resolved at check time so a newly published
  // course is covered without touching any org row. The predicate is copied
  // verbatim from the PAID-grant expansion in api/entitlement/grant.ts so
  // "all courses" means the same catalogue in both places and cannot drift.
  const { data: courses } = await svc
    .from('courses')
    .select('course_code')
    .in('new_app_status', ['live', 'beta'])
  return [
    ...new Set(
      (courses ?? [])
        .map((c: any) => c?.course_code)
        .filter((code: unknown): code is string => typeof code === 'string' && code.length > 0),
    ),
  ]
}
