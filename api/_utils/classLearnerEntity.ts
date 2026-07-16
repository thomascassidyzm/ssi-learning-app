/**
 * classLearnerEntity — the class-as-first-class-learner primitive (owner
 * ruling 2026-07-16). Every class has its OWN learners row (flagged
 * is_class_entity, never signed in) enrolled in the class's course; all three
 * class-creation paths (client createClass, api/teacher/classes.ts,
 * api/onboarding/provision.ts) call `ensureClassLearnerEntity` right after
 * inserting the class row. Existing classes were backfilled by migration
 * 20260716b_class_learner_entity.sql.
 *
 * Idempotent: safe to call for a class that already has one (returns the
 * existing id, re-syncs the course_enrollments row to the class's current
 * course_code — the "keep in sync if the class course changes" hook, though
 * no UI currently changes a class's course post-creation).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function ensureClassLearnerEntity(
  svc: SupabaseClient,
  classId: string,
): Promise<{ learnerId: string } | { error: string }> {
  const { data: cls, error: clsErr } = await svc
    .from('classes')
    .select('id, class_name, course_code, class_learner_id')
    .eq('id', classId)
    .maybeSingle()

  if (clsErr) return { error: clsErr.message }
  if (!cls) return { error: 'Class not found' }

  let learnerId = (cls as any).class_learner_id as string | null

  if (!learnerId) {
    const { data: learner, error: learnerErr } = await svc
      .from('learners')
      .insert({
        user_id: `class-learner:${classId}`,
        display_name: (cls as any).class_name || 'Class',
        is_class_entity: true,
      })
      .select('id')
      .single()
    if (learnerErr || !learner) return { error: learnerErr?.message || 'Failed to create class learner' }
    learnerId = learner.id as string

    const { error: updateErr } = await svc
      .from('classes')
      .update({ class_learner_id: learnerId })
      .eq('id', classId)
    if (updateErr) return { error: updateErr.message }
  }

  const { error: enrollErr } = await svc
    .from('course_enrollments')
    .upsert(
      { learner_id: learnerId, course_id: (cls as any).course_code },
      { onConflict: 'learner_id,course_id', ignoreDuplicates: true },
    )
  if (enrollErr) return { error: enrollErr.message }

  return { learnerId }
}
