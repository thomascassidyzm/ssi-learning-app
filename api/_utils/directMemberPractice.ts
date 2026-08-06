/**
 * directMemberPractice — practice hours for people attached DIRECTLY to a group
 * node, i.e. the `user_tags` tag_type='group' path with no school and no class
 * underneath them.
 *
 * WHY THIS EXISTS (live defect, 2026-08-06). Every practice number in the org
 * rollup is school-shaped: `school_summary` hangs off a `schools` row, and
 * `group_summary` just sums `school_summary`. But `computeNodeExtras` already
 * counts a group-tagged person in `learnerCount` through the NEW direct model.
 * So an org that invites people straight into the group — the shape you get from
 * "create an org, send someone a personal link" with no school ever created —
 * reports "1 learner, 0 hours practised" FOREVER, however much that person
 * practises. The explainer's `org-not-started` rule fires on exactly that pair
 * (learnerCount > 0 AND practiceHours === 0) and told a real field tester that
 * "none of them has practised yet" minutes after her test learner had done a
 * German session. The telemetry was fine; the rollup could not see it.
 *
 * This is the same founder ruling as 2026-07-18 ("a school's headline hours
 * should include staff's OWN practice… a more valid testament to true
 * engagement" — 20260718_headline_hours_include_staff_practice.sql), applied to
 * the next attachment shape the model grew: people in a group, not in a school.
 *
 * BASIS: `sessions.duration_seconds`, the estate's canonical practice source
 * (20260717a_practice_minutes_from_sessions.sql), summed over ALL of a user's
 * learner accounts — the same all-sessions basis `staff_practice_hours` uses.
 *
 * NO DOUBLE COUNT: anyone who ALSO carries a school or class tag inside the same
 * subtree is already counted through `school_summary` (student practice via
 * class_student_progress, staff practice via the school tag), so they are
 * excluded here. What is left is exactly the people the school-shaped rollup
 * cannot see.
 *
 * Service-role only — call from server-mediated endpoints.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

export interface DirectMemberPracticeScope {
  /** every group node id in the subtree (the node itself + descendants) */
  subtreeGroupIds: string[]
  /** every school id in the subtree — used only to exclude already-counted people */
  subtreeSchoolIds: string[]
  /** every class id in the subtree — used only to exclude already-counted people */
  subtreeClassIds: string[]
}

/**
 * Seconds of practice by people attached directly to the subtree's group nodes
 * and NOT reachable through any of its schools or classes. Returns 0 when there
 * are no such people — the school-shaped org pays only one cheap tag lookup.
 */
export async function directMemberPracticeSeconds(
  svc: SupabaseClient,
  scope: DirectMemberPracticeScope,
): Promise<number> {
  const { subtreeGroupIds, subtreeSchoolIds, subtreeClassIds } = scope
  if (subtreeGroupIds.length === 0) return 0

  // 1. Everyone tagged onto a node in the subtree, any role — a leader's or a
  //    teacher's own practice counts towards the headline, per the 07-18 ruling.
  const groupTagged = new Set<string>()
  await Promise.all(
    chunk(subtreeGroupIds.map((id) => `GROUP:${id}`)).map(async (batch) => {
      const { data } = await svc
        .from('user_tags')
        .select('user_id')
        .eq('tag_type', 'group')
        .in('tag_value', batch)
        .is('removed_at', null)
      for (const r of data ?? []) if ((r as { user_id?: string }).user_id) groupTagged.add((r as { user_id: string }).user_id)
    }),
  )
  if (groupTagged.size === 0) return 0

  // 2. Drop anyone the school-shaped rollup already sees.
  const coveredValues = [
    ...subtreeSchoolIds.map((id) => `SCHOOL:${id}`),
    ...subtreeClassIds.map((id) => `CLASS:${id}`),
  ]
  if (coveredValues.length > 0) {
    await Promise.all(
      chunk(coveredValues).map(async (batch) => {
        const { data } = await svc
          .from('user_tags')
          .select('user_id')
          .in('tag_value', batch)
          .is('removed_at', null)
        for (const r of data ?? []) groupTagged.delete((r as { user_id: string }).user_id)
      }),
    )
  }
  if (groupTagged.size === 0) return 0

  // 3. auth uid → every learner account that uid owns.
  const learnerIds = new Set<string>()
  await Promise.all(
    chunk([...groupTagged]).map(async (batch) => {
      const { data } = await svc.from('learners').select('id').in('user_id', batch)
      for (const r of data ?? []) if ((r as { id?: string }).id) learnerIds.add((r as { id: string }).id)
    }),
  )
  if (learnerIds.size === 0) return 0

  // 4. Their logged practice.
  let seconds = 0
  await Promise.all(
    chunk([...learnerIds]).map(async (batch) => {
      const { data } = await svc.from('sessions').select('duration_seconds').in('learner_id', batch)
      for (const r of data ?? []) seconds += Number((r as { duration_seconds: number | null }).duration_seconds) || 0
    }),
  )
  return seconds
}
