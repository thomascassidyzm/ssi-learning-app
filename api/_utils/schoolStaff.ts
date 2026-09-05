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

/** One school a user is staff at, under whichever spelling recorded it. */
export interface SchoolMembership {
  schoolId: string
  role: 'admin' | 'teacher'
}

/**
 * One school an account REACHES, in any capacity at all — staff or pupil.
 *
 * Deliberately a wider type than `SchoolMembership`: a containment check asks
 * "does this account touch anywhere else?", and a pupil seat is a touch.
 */
export interface SchoolReach {
  schoolId: string
  role: 'admin' | 'teacher' | 'student'
}

/**
 * EVERY school this user is staff at — under BOTH spellings, in one answer.
 *
 * The bug this closes (found 2026-09-05, and it is the Chepstow bug of
 * 2026-08-06 wearing a different hat): api/school/staff-signin-link.ts resolved
 * the CALLER's school through both spellings — `schools.admin_user_id` OR a
 * SCHOOL: tag — but asked whether the TARGET reaches beyond that school using
 * `user_tags` ALONE. A founding admin of another school has the pointer and, if
 * nothing ever tagged them, no tag at all. So they read as "belongs to nowhere
 * else", and a school admin at school A could mint a live session as the person
 * who runs school B.
 *
 * Two spellings of one identity, recognised in one place and missed in another,
 * is the estate's recurring auth failure. So the answer is not another lookup
 * next to the first: it is ONE function, used for the caller and the target
 * alike, so the two can never again be asked different questions.
 *
 * Note what identity each spelling is keyed on — CLAUDE.md's identity
 * rationalisation: `schools.admin_user_id` and `user_tags.user_id` BOTH hold the
 * AUTH UID (text), not the learner PK. `authUid` here is `auth.uid()`, straight
 * from verifyAuthToken.
 */
export async function schoolMembershipsOf(
  supabase: SupabaseClient,
  authUid: string,
): Promise<SchoolMembership[]> {
  if (!authUid) return []
  const byId = new Map<string, SchoolMembership>()

  // Spelling 1 — the founding-admin pointer. A person can found more than one.
  const { data: owned } = await supabase.from('schools').select('id').eq('admin_user_id', authUid)
  for (const row of (owned || []) as Array<{ id: string }>) {
    if (row?.id) byId.set(String(row.id), { schoolId: String(row.id), role: 'admin' })
  }

  // Spelling 2 — active SCHOOL: membership tags. `removed_at IS NULL` matters:
  // a revoked member must not keep the reach the tag once granted.
  const { data: tags } = await supabase
    .from('user_tags')
    .select('tag_value, role_in_context')
    .eq('user_id', authUid)
    .eq('tag_type', 'school')
    .in('role_in_context', SCHOOL_STAFF_ROLES as unknown as string[])
    .is('removed_at', null)
  for (const row of (tags || []) as Array<{ tag_value: string; role_in_context: string }>) {
    const schoolId = String(row?.tag_value || '').replace('SCHOOL:', '')
    if (!schoolId) continue
    // 'admin' wins over 'teacher' when both spellings describe the same school.
    const existing = byId.get(schoolId)
    if (existing?.role === 'admin') continue
    byId.set(schoolId, { schoolId, role: row.role_in_context === 'admin' ? 'admin' : 'teacher' })
  }

  return [...byId.values()]
}

/**
 * EVERY school this account reaches, in ANY capacity — staff OR pupil.
 *
 * The gap this closes (2026-09-05, sibling of the one above): a containment
 * check must ask "does this account reach anywhere else AT ALL", but
 * `schoolMembershipsOf` deliberately answers a narrower question — "is this
 * person STAFF here" — and filters to teacher/admin. Its other callers want
 * exactly that. api/school/staff-signin-link.ts does not: it mints a live
 * session as the target, so a pupil seat at a second school is reach the same
 * way a teaching post is, and the staff-only view could not see it. A person
 * who teaches at school A and studies at school B is a real, supported state
 * (api/code/redeem.ts writes both), so school A's admin could mint a session
 * that opened that person's private pupil account at school B.
 *
 * Three spellings of reach, all unioned here so no caller has to remember them:
 *   1. `schools.admin_user_id` — the founding-admin pointer.
 *   2. an active `user_tags` SCHOOL: tag, of ANY role (student included).
 *   3. an active `user_tags` CLASS: tag, resolved to that class's school —
 *      because the pupil path (redeem.ts) writes a CLASS tag and NO school tag,
 *      so school-tags-only would still miss the commonest pupil of all.
 *
 * Highest capacity wins when several spellings describe one school, so the
 * returned role never understates what the account can do there.
 */
export async function schoolReachOf(
  supabase: SupabaseClient,
  authUid: string,
): Promise<SchoolReach[]> {
  if (!authUid) return []
  const rank = { student: 0, teacher: 1, admin: 2 } as const
  const byId = new Map<string, SchoolReach>()
  const note = (schoolId: string, role: SchoolReach['role']) => {
    if (!schoolId) return
    const existing = byId.get(schoolId)
    if (existing && rank[existing.role] >= rank[role]) return
    byId.set(schoolId, { schoolId, role })
  }

  // Spellings 1 + 2 — staff reach, from the one staff resolver, so the two can
  // never drift apart.
  for (const m of await schoolMembershipsOf(supabase, authUid)) note(m.schoolId, m.role)

  // Spelling 2 (widened) — school tags carrying a NON-staff role.
  const { data: tags } = await supabase
    .from('user_tags')
    .select('tag_value, role_in_context')
    .eq('user_id', authUid)
    .eq('tag_type', 'school')
    .is('removed_at', null)
  for (const row of (tags || []) as Array<{ tag_value: string; role_in_context: string }>) {
    const schoolId = String(row?.tag_value || '').replace('SCHOOL:', '')
    const role = row?.role_in_context === 'admin' ? 'admin' : row?.role_in_context === 'teacher' ? 'teacher' : 'student'
    note(schoolId, role)
  }

  // Spelling 3 — class tags, resolved to their school.
  const { data: classTags } = await supabase
    .from('user_tags')
    .select('tag_value, role_in_context')
    .eq('user_id', authUid)
    .eq('tag_type', 'class')
    .is('removed_at', null)
  const classIds = [
    ...new Set(
      ((classTags || []) as Array<{ tag_value: string; role_in_context: string }>)
        .map((row) => String(row?.tag_value || '').replace('CLASS:', ''))
        .filter(Boolean),
    ),
  ]
  if (classIds.length) {
    const roleByClass = new Map<string, SchoolReach['role']>()
    for (const row of (classTags || []) as Array<{ tag_value: string; role_in_context: string }>) {
      const classId = String(row?.tag_value || '').replace('CLASS:', '')
      const role = row?.role_in_context === 'admin' ? 'admin' : row?.role_in_context === 'teacher' ? 'teacher' : 'student'
      const existing = roleByClass.get(classId)
      if (!existing || rank[existing] < rank[role]) roleByClass.set(classId, role)
    }
    const { data: classes } = await supabase.from('classes').select('id, school_id').in('id', classIds)
    for (const row of (classes || []) as Array<{ id: string; school_id: string | null }>) {
      if (!row?.school_id) continue
      note(String(row.school_id), roleByClass.get(String(row.id)) ?? 'student')
    }
  }

  return [...byId.values()]
}
