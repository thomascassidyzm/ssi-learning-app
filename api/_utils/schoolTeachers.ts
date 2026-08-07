/**
 * schoolTeachers — "who are this school's teachers?", resolved server-side.
 *
 * The BILLING-honest answer, and the reason this exists as its own primitive:
 * every other place that answers this question answers a slightly different
 * one, and none of them is safe to bill from.
 *
 *   • `school_summary.teacher_count` (the DB view) and api/school/roster.ts
 *     both derive staff from `user_tags` (∪ class_teachers in roster's case).
 *     Neither counts the FOUNDING ADMIN — `schools.admin_user_id` — who, on
 *     six real live schools as of 2026-08-07, holds NO school user_tag at all.
 *     That gap is being closed in its own lane (api/onboarding/provision.ts +
 *     api/admin/create-school.ts + a user_tags backfill); this resolver
 *     deliberately does NOT depend on that landing. It unions the admin in and
 *     de-duplicates, so the number is right today AND stays right (not
 *     double-counted) the moment the backfill lands.
 *
 * Sources unioned, all keyed on the AUTH uid (see CLAUDE.md's identity table —
 * `schools.admin_user_id`, `user_tags.user_id`, `class_teachers.teacher_user_id`
 * and `classes.teacher_user_id` are all TEXT auth uids, NOT learner ids):
 *   1. `schools.admin_user_id`              — the founding admin
 *   2. `user_tags` SCHOOL: tags, role_in_context 'teacher' OR 'admin', active
 *      — 'admin' included because an invite-born school_admin is staff holding
 *      a dashboard account, i.e. a seat, exactly like a teacher
 *   3. the school's active classes' teachers (`class_teachers` + the legacy
 *      `classes.teacher_user_id` lead pointer) — the supply/co-teacher who was
 *      added straight onto a class and holds no SCHOOL: tag (same union
 *      api/school/roster.ts makes for its staff list)
 *
 * Service-role only. Never call this with a client-supplied schoolId that
 * hasn't been resolved from the caller's own verified identity.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** The de-duplicated set of auth uids that count as this school's staff. */
export async function resolveSchoolTeacherUserIds(
  svc: SupabaseClient,
  schoolId: string,
): Promise<string[]> {
  if (!schoolId) return []

  const [{ data: school }, { data: staffTags }, { data: classes }] = await Promise.all([
    svc.from('schools').select('admin_user_id').eq('id', schoolId).maybeSingle(),
    svc
      .from('user_tags')
      .select('user_id, role_in_context')
      .eq('tag_type', 'school')
      .eq('tag_value', `SCHOOL:${schoolId}`)
      .in('role_in_context', ['teacher', 'admin'])
      .is('removed_at', null),
    svc.from('classes').select('id, teacher_user_id').eq('school_id', schoolId).eq('is_active', true),
  ])

  const ids = new Set<string>()

  const adminUid = (school as { admin_user_id?: string | null } | null)?.admin_user_id
  if (adminUid) ids.add(adminUid)

  for (const t of staffTags ?? []) {
    const uid = (t as { user_id?: string | null }).user_id
    if (uid) ids.add(uid)
  }

  const classIds: string[] = []
  for (const c of classes ?? []) {
    const row = c as { id?: string | null; teacher_user_id?: string | null }
    if (row.id) classIds.push(row.id)
    if (row.teacher_user_id) ids.add(row.teacher_user_id)
  }

  if (classIds.length) {
    // Chunked so a long .in() list can never blow the PostgREST URL cap.
    for (let i = 0; i < classIds.length; i += 150) {
      const { data: classTeachers } = await svc
        .from('class_teachers')
        .select('teacher_user_id')
        .in('class_id', classIds.slice(i, i + 150))
      for (const ct of classTeachers ?? []) {
        const uid = (ct as { teacher_user_id?: string | null }).teacher_user_id
        if (uid) ids.add(uid)
      }
    }
  }

  return [...ids]
}

/**
 * How many staff this school actually has — the honest number the Subscribe
 * page seeds its seat stepper from. Never throws: a read failure returns 0 and
 * the caller falls back to its own default rather than showing a wrong figure.
 */
export async function countSchoolTeachers(svc: SupabaseClient, schoolId: string): Promise<number> {
  try {
    return (await resolveSchoolTeacherUserIds(svc, schoolId)).length
  } catch {
    return 0
  }
}
