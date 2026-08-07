/**
 * School STAFF membership — one definition, one writer.
 *
 * The bug this closes (Chepstow, 2026-08-06): a school's FOUNDING admin — the
 * person recorded in `schools.admin_user_id` at creation — never got a
 * `user_tags` SCHOOL: row. Only `api/code/redeem.ts`'s school_admin_join branch
 * (an admin CLAIMING a vacant seat) ever wrote one. Every staff-keyed number is
 * derived from `user_tags`, so the founding admin was invisible in her own
 * school: Angharad had 76 minutes of practice across 19 sessions and her
 * dashboard headline showed 7m (the two invited teachers only), and she was
 * absent from her own Teachers list.
 *
 * Two halves, both here:
 *
 *  1. WRITE — `ensureSchoolAdminTag()` is the single writer of an admin's
 *     SCHOOL: membership. Called by every path that creates a school with an
 *     `admin_user_id` (api/onboarding/provision.ts self-serve,
 *     api/admin/create-school.ts) and by the claim path (api/code/redeem.ts).
 *     `api/govt/create-school.ts` deliberately leaves `admin_user_id` NULL — a
 *     vacant seat claimed later via redemption — so it correctly tags nobody.
 *
 *  2. READ — `SCHOOL_STAFF_ROLES` is the ONE definition of "staff at this
 *     school": teacher OR admin. It already was the definition used by
 *     `school_summary.staff_practice_hours` (migration 20260718), but the
 *     staff LISTS and COUNTS filtered `role_in_context='teacher'` strictly —
 *     so an 'admin' tag alone fixed the minutes and still left her off the
 *     roster. Every staff-list read now imports this constant.
 *
 * Role convention (founder ruling, 2026-08-06): the founding admin's tag
 * carries `role_in_context='admin'` — truthful, and identical to what the
 * school_admin_join claim path has always written. There is deliberately NO
 * second convention (never write a school's admin as a 'teacher'); the reads
 * widen instead, and the UI shows her as the Admin she is.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * "Staff at this school" = teacher OR admin. Use for every staff LIST or COUNT
 * keyed on a `tag_type='school'` tag. Do NOT use it for a genuinely
 * teacher-only operation (e.g. api/school/remove-staff.ts's target lookup,
 * which must not let an admin be removed as though they were a teacher).
 */
export const SCHOOL_STAFF_ROLES = ['teacher', 'admin'] as const

/**
 * Give a school's admin their `user_tags` SCHOOL: membership row.
 *
 * Idempotent: 23505 (unique_violation on the `user_tags_active_natural_key`
 * partial unique index over (user_id, tag_type, tag_value) WHERE removed_at IS
 * NULL) means an active tag for this user+school already exists, which grants
 * exactly what this call asked for — a no-op, not an error. Same handling as
 * api/code/redeem.ts. So re-provisioning a school never duplicates the row.
 *
 * Returns an error message on a real failure, or null on success/no-op. Callers
 * on a school-CREATION path treat a failure as non-fatal (the school itself is
 * created; the tag is healed by the next provision or by
 * tools/backfill-founding-admin-tags.mjs) — losing the whole signup over a
 * membership row would be a worse outcome than a temporarily untagged admin.
 */
export async function ensureSchoolAdminTag(
  supabase: SupabaseClient,
  params: { userId: string; schoolId: string; addedBy?: string },
): Promise<string | null> {
  const { error } = await supabase.from('user_tags').insert({
    user_id: params.userId,
    tag_type: 'school',
    tag_value: `SCHOOL:${params.schoolId}`,
    role_in_context: 'admin',
    added_by: params.addedBy ?? params.userId,
  })
  if (error && error.code !== '23505') return error.message || 'user_tags insert failed'
  return null
}
