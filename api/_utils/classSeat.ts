/**
 * classSeat — put a freshly minted CHILD into a class, server-side, from the
 * class code the parent arrived on.
 *
 * THE PARENT DOOR ON THE CLASS LINK (Tom, 2026-09-10). "Parents pay, but the
 * child is the learner." The child's own account is minted on the SSi Family
 * child shape (api/family/create-child.ts) and this writes the CLASS: student
 * tag and the course enrolment for it in the SAME request — the two rows
 * api/code/redeem.ts and api/teacher/paddle-webhook.ts already write for
 * every other pupil, in the same shape. Nothing new in the schema.
 *
 * The code is `classes.student_join_code`: the one string both class links
 * carry (/redeem/<code> and /with/<code>). It is read off the class row
 * rather than invite_codes because 12 of 167 live classes have never had
 * their invite_codes row registered (checked 2026-09-10), and a parent must
 * not be told "no such class" for a class that exists.
 *
 * It tags the CHILD only. The parent is not a learner: no tag, no enrolment,
 * no roster row — ever.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ClassSeatLink =
  | { classId: string; courseCode: string | null }
  | { error: string }

export async function tagChildIntoClassByCode(
  supabase: SupabaseClient,
  input: { classCode: string; childAuthUid: string; childLearnerId: string },
): Promise<ClassSeatLink> {
  const code = input.classCode.trim().toUpperCase()
  if (!code) return { error: 'No class code given' }

  const { data: cls } = await supabase
    .from('classes')
    .select('id, course_code, is_active, school_id, group_id')
    .eq('student_join_code', code)
    .maybeSingle()
  if (!cls) return { error: 'No class matches that code' }
  if ((cls as any).is_active === false) return { error: 'That class is closed' }

  const classId = (cls as any).id as string
  const courseCode = ((cls as any).course_code as string | null)?.trim() || null

  // Same tag shape and the same idempotent key as the webhook's own write.
  const { error: tagError } = await supabase.from('user_tags').upsert(
    {
      user_id: input.childAuthUid,
      tag_type: 'class',
      tag_value: `CLASS:${classId}`,
      role_in_context: 'student',
      added_by: input.childAuthUid,
      added_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,tag_type,tag_value' },
  )
  if (tagError) {
    console.error('[classSeat] Failed to tag child into class:', tagError)
    return { error: 'Could not add the child to the class' }
  }

  if (courseCode) {
    const { error: enrolError } = await supabase
      .from('course_enrollments')
      .upsert(
        { learner_id: input.childLearnerId, course_id: courseCode },
        { onConflict: 'learner_id,course_id', ignoreDuplicates: true },
      )
    if (enrolError) {
      // The tag is what puts the child on the roster and under class cover;
      // enrolment is the course landing. Best-effort, as redeem.ts treats it.
      console.error('[classSeat] Failed to enrol child on class course (non-fatal):', enrolError)
    }
  }

  return { classId, courseCode }
}
