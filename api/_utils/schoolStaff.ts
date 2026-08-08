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

/**
 * Is `userId` an ADMIN of this school — under EITHER spelling?
 *
 * There are two, and they are equally valid:
 *
 *   1. `schools.admin_user_id` — the FOUNDING admin pointer, set once at
 *      creation. Exactly one person per school can ever be this.
 *   2. an active `user_tags` SCHOOL: row with `role_in_context='admin'` —
 *      which is what the invite/claim path writes for EVERY admin after the
 *      first, and (since 2026-08-06) for the founder too.
 *
 * The bug this closes (Tom, staging, 2026-08-08, as "Harbour Leader" at
 * "Harbour View School, Visakhapatnam"): saving a teacher assignment failed
 * with "Only the class teacher or a leader above the class can manage its
 * teachers" for all three of her own school's classes. She holds the TAG;
 * the school's `admin_user_id` pointer is Suresh Rao, the founding admin. So
 * every authz predicate that asked only "are you the pointer?" said no to the
 * person who runs the school — and then fell through to a govt_admins lookup
 * she has no row in, and returned false.
 *
 * This is the SAME gap, one layer up, that migration 20260807c closed inside
 * the database for `is_school_admin_of()`. The DB learned the tag spelling on
 * 2026-08-07; the API's copy of the same question did not, so reads worked and
 * writes did not — which is the worst possible split, because the UI shows you
 * a verb the server then refuses.
 *
 * Deliberately ONE predicate, exported, so the two spellings can never again
 * be recognised in one place and missed in another.
 */
export async function isSchoolAdminOf(
  supabase: SupabaseClient,
  userId: string,
  schoolId: string,
): Promise<boolean> {
  if (!userId || !schoolId) return false

  // Spelling 1 — the founding pointer.
  const { data: school } = await supabase
    .from('schools')
    .select('admin_user_id')
    .eq('id', schoolId)
    .maybeSingle()
  if ((school as unknown as { admin_user_id?: string | null } | null)?.admin_user_id === userId) {
    return true
  }

  // Spelling 2 — the admin membership tag. `removed_at IS NULL` matters: a
  // revoked admin must not keep the rights the tag once granted.
  const { data: tag } = await supabase
    .from('user_tags')
    .select('id')
    .eq('user_id', userId)
    .eq('tag_type', 'school')
    .eq('tag_value', `SCHOOL:${schoolId}`)
    .eq('role_in_context', 'admin')
    .is('removed_at', null)
    .maybeSingle()
  return !!tag
}
