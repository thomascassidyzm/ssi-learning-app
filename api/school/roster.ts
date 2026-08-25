/**
 * Own-school rollup for school_admin/teacher — GET /api/school/roster
 *
 * Root cause of the "three truths" bug: `school_summary` (totals) and the
 * teacher/student LISTS the dashboard/Teachers/Students views build client-side
 * are all derived from `user_tags` (school_summary's LATERAL joins, plus direct
 * reads of user_tags/class_teachers/class_student_progress by useTeachersData
 * and useStudentsData). `user_tags`'s RLS SELECT policy grants a row's owner,
 * an ssi_admin, a SCHOOL's own admin (`schools.admin_user_id = auth.uid()`), or
 * a CLASS's own teacher — but a school_admin invite-born via the newer
 * school_admin_join redemption path (see School.has_admin's docstring) never
 * sets `schools.admin_user_id`, only a user_tags row. That admin's own SELECT
 * then only ever matches their OWN row — every OTHER teacher/student row in
 * their school silently vanishes — while a teacher (whose classes they
 * actually teach match the "class's own teacher" branch) sees the real
 * numbers. Same failure class as the govt_admin "group dashboard shows
 * zeros" bug (group-summary.ts) — same fix: resolve the caller's own school
 * server-side (resolveVisibleScope) and read under the SERVICE ROLE, so
 * authorization is enforced HERE (caller's own school only), not by RLS.
 *
 * TWO MODES:
 *
 *   GET /api/school/roster
 *     The school rollup above. A school_admin gets their whole school. A
 *     TEACHER gets the school's staff list, but only the students of classes
 *     THEY teach — founder ruling 2026-07-30: a teacher's scope is their own
 *     classes, never the whole school. (Their staff list stays school-wide:
 *     it carries no pupil data and it is what the co-teacher picker needs.)
 *
 *   GET /api/school/roster?class_id=<uuid>
 *     Teacher-lookup mode for the co-teacher panel (ClassDetail.vue). Returns
 *     the NAMES of the teachers who could be added to that class — nothing
 *     else: no pupil rows, no per-teacher aggregates. Authorised by
 *     MEMBERSHIP of that class (the same rule api/teacher/class-teachers.ts
 *     uses for the write), not by school-admin status, so the supply teacher
 *     who holds only a CLASS: tag — no SCHOOL: tag, therefore no resolvable
 *     home school — can still pick a colleague.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope, schoolIdForAdmin, chunk } from '../_utils/schoolScope'
import { SCHOOL_STAFF_ROLES } from '../_utils/schoolStaff'
import { canTeachClass } from '../_utils/classTeacherAuth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const classIdParam = typeof req.query?.class_id === 'string' ? req.query.class_id.trim() : ''
    if (classIdParam) {
      await handleClassTeacherLookup(svc, auth.userId, classIdParam, res)
      return
    }

    const scope = await resolveVisibleScope(svc, auth.userId)
    if (scope.role !== 'school_admin' && scope.role !== 'teacher') {
      res.status(403).json({ error: 'Not school staff' })
      return
    }

    // resolveVisibleScope already resolves schoolIds for school_admin; a
    // teacher's is deliberately left empty there (see schoolIdForAdmin's
    // docstring) — resolve their own "home school" the same way here.
    const schoolId = scope.role === 'school_admin'
      ? (scope.schoolIds[0] ?? null)
      : await schoolIdForAdmin(svc, auth.userId)

    if (!schoolId) {
      res.status(200).json({ school: null, teachers: [], students: [] })
      return
    }

    const [{ data: school, error: schoolErr }, { data: classes, error: classesErr }] = await Promise.all([
      svc.from('school_summary').select('*').eq('school_id', schoolId).maybeSingle(),
      svc.from('classes').select('id').eq('school_id', schoolId).eq('is_active', true),
    ])
    if (schoolErr) throw schoolErr
    if (classesErr) throw classesErr

    const classIds = (classes ?? []).map((c: any) => c.id).filter(Boolean)

    const [{ data: teacherTags, error: teacherTagsErr }, { data: classTeachers, error: classTeachersErr }] = await Promise.all([
      // STAFF = teacher OR admin (SCHOOL_STAFF_ROLES). This used to be
      // 'teacher' strictly, which silently excluded the school's own ADMIN
      // from her own Teachers list — and, for a FOUNDING admin, from every
      // staff number in the school (Chepstow, 2026-08-06). It matches the
      // definition school_summary.staff_practice_hours already used.
      svc.from('user_tags')
        .select('user_id, added_at, role_in_context')
        .eq('tag_value', `SCHOOL:${schoolId}`)
        .eq('tag_type', 'school')
        .in('role_in_context', SCHOOL_STAFF_ROLES)
        .is('removed_at', null),
      classIds.length
        ? svc.from('class_teachers').select('class_id, teacher_user_id').in('class_id', classIds)
        : Promise.resolve({ data: [], error: null } as any),
    ])
    if (teacherTagsErr) throw teacherTagsErr
    if (classTeachersErr) throw classTeachersErr

    // A school's staff = SCHOOL: tag holders UNION anyone who actually teaches
    // one of its classes. The tag alone misses the supply/co-teacher who was
    // added straight onto a class (a CLASS: tag, no SCHOOL: tag) — they taught
    // real lessons and were invisible on their own school's roster.
    const joinDates = new Map((teacherTags ?? []).map((t: any) => [t.user_id, t.added_at]))
    const teacherIdSet = new Set<string>((teacherTags ?? []).map((t: any) => t.user_id).filter(Boolean))
    for (const ct of classTeachers ?? []) {
      const uid = (ct as any).teacher_user_id as string
      if (uid) teacherIdSet.add(uid)
    }
    const teacherUserIds = [...teacherIdSet]
    // Carried through to the UI so the admin is shown as the ADMIN she is,
    // never mislabelled a teacher (and so the Remove control, which only ever
    // acts on teacher tags, can hide itself for her). A class-teacher with no
    // SCHOOL: tag has no entry here and falls back to 'teacher' at the read.
    const staffRoles = new Map((teacherTags ?? []).map((t: any) => [t.user_id, t.role_in_context]))

    const students: any[] = []
    for (const batch of chunk(classIds)) {
      const { data, error } = await svc.from('class_student_progress').select('*').in('class_id', batch)
      if (error) throw error
      students.push(...(data ?? []))
    }

    const perClass = new Map<string, { students: number; seconds: number }>()
    for (const p of students) {
      const e = perClass.get(p.class_id) || { students: 0, seconds: 0 }
      e.students++
      e.seconds += p.total_practice_seconds || 0
      perClass.set(p.class_id, e)
    }

    const teacherClasses = new Map<string, Set<string>>()
    for (const ct of classTeachers ?? []) {
      const uid = (ct as any).teacher_user_id as string
      const cid = (ct as any).class_id as string
      if (!uid || !cid || !teacherIdSet.has(uid)) continue
      const set = teacherClasses.get(uid) ?? new Set<string>()
      set.add(cid)
      teacherClasses.set(uid, set)
    }

    let teachers: any[] = []
    if (teacherUserIds.length) {
      const { data: learners, error: learnersErr } = await svc
        .from('learners')
        .select('id, user_id, display_name')
        .in('user_id', teacherUserIds)
      if (learnersErr) throw learnersErr

      // A teacher's OWN practice lives on their own learner's sessions and is
      // counted by no class/student aggregate (class_student_progress only sees
      // role_in_context='student' tags). In a trial school the staff's own
      // practice is usually the ONLY activity — without this every number on
      // the dashboard reads 0 despite real use (Chepstow, 2026-07-17).
      const teacherLearnerIds = (learners ?? []).map((l: any) => l.id).filter(Boolean)
      const ownSeconds = new Map<string, number>()
      for (const batch of chunk(teacherLearnerIds)) {
        const { data: sess, error: sessErr } = await svc
          .from('sessions')
          .select('learner_id, duration_seconds')
          .in('learner_id', batch)
        if (sessErr) throw sessErr
        for (const s of sess ?? []) {
          ownSeconds.set(s.learner_id, (ownSeconds.get(s.learner_id) || 0) + (s.duration_seconds || 0))
        }
      }

      teachers = (learners ?? []).map((l: any) => {
        const classSet = teacherClasses.get(l.user_id) ?? new Set<string>()
        let studentCount = 0
        let seconds = 0
        for (const cid of classSet) {
          const cls = perClass.get(cid)
          if (cls) { studentCount += cls.students; seconds += cls.seconds }
        }
        return {
          user_id: l.user_id,
          learner_id: l.id,
          display_name: l.display_name,
          class_count: classSet.size,
          student_count: studentCount,
          total_practice_hours: Math.round((seconds / 3600) * 10) / 10,
          own_practice_minutes: Math.round((ownSeconds.get(l.id) || 0) / 60),
          role_in_context: staffRoles.get(l.user_id) || 'teacher',
          joined_at: joinDates.get(l.user_id) || '',
        }
      }).sort((a: any, b: any) => a.display_name.localeCompare(b.display_name))
    }

    // Founder ruling 2026-07-30: a teacher's scope is their OWN classes, never
    // the whole school. The per-teacher aggregates above stay school-wide (they
    // are counts, not identities — that's what a staff list is for), but the
    // pupil ROWS a teacher gets back are only ever their own classes'.
    const visibleStudents = scope.role === 'teacher'
      ? students.filter((p: any) => scope.classIds.includes(p.class_id))
      : students

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      school: school ?? null,
      teachers,
      students: visibleStudents.map((p: any) => ({
        user_id: p.student_user_id,
        learner_id: p.learner_id,
        display_name: p.student_name,
        class_id: p.class_id,
        class_name: p.class_name,
        course_code: p.course_code,
        seeds_completed: p.seeds_completed,
        legos_mastered: p.legos_mastered,
        total_practice_minutes: Math.round((p.total_practice_seconds || 0) / 60),
        last_active_at: p.last_active_at,
        joined_class_at: p.joined_class_at,
      })).sort((a: any, b: any) => a.display_name.localeCompare(b.display_name)),
    })
  } catch (err) {
    console.error('[roster] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * `?class_id=` mode — the candidate teachers for a class's co-teacher picker.
 *
 * Deliberately NARROW: names only, no pupil rows, no aggregates. The candidate
 * set is the staff of the class's school (SCHOOL: tag holders UNION anyone
 * teaching one of that school's classes — the same union the rollup uses); for
 * a class with no school (the tutor lane) it degrades to the class's own
 * teachers, which is honest rather than empty.
 */
async function handleClassTeacherLookup(
  svc: SupabaseClient,
  callerUserId: string,
  classId: string,
  res: VercelResponse,
): Promise<void> {
  const { data: cls } = await svc
    .from('classes')
    .select('id, teacher_user_id, school_id, group_id')
    .eq('id', classId)
    .maybeSingle()

  if (!cls) {
    res.status(404).json({ error: 'Class not found' })
    return
  }

  // Membership authz: a caller who may not teach this class may not enumerate
  // its co-teacher candidates either.
  //
  // TENANCY-08 (fixed 2026-08-25): this hand-rolled the four legs of
  // canTeachClass(), but its school-admin leg read the schools.admin_user_id
  // founding pointer ALONE — so a tag-admin of the class's own school was denied
  // the roster. The shared predicate owns both admin spellings, making this a
  // strict superset of the old ladder.
  const authorized = await canTeachClass(svc, callerUserId, {
    id: (cls as any).id,
    teacher_user_id: (cls as any).teacher_user_id ?? null,
    school_id: (cls as any).school_id ?? null,
    group_id: (cls as any).group_id ?? null,
  })

  if (!authorized) {
    res.status(403).json({ error: 'Not a teacher of this class' })
    return
  }

  const schoolId = (cls as any).school_id as string | null
  const candidateIds = new Set<string>()

  if (schoolId) {
    const { data: schoolClasses } = await svc
      .from('classes')
      .select('id')
      .eq('school_id', schoolId)
      .eq('is_active', true)
    const schoolClassIds = (schoolClasses ?? []).map((c: any) => c.id).filter(Boolean)

    const [{ data: schoolTags }, { data: rels }] = await Promise.all([
      svc.from('user_tags')
        .select('user_id')
        .eq('tag_value', `SCHOOL:${schoolId}`)
        .eq('tag_type', 'school')
        .eq('role_in_context', 'teacher')
        .is('removed_at', null),
      schoolClassIds.length
        ? svc.from('class_teachers').select('teacher_user_id').in('class_id', schoolClassIds)
        : Promise.resolve({ data: [] as any[] } as any),
    ])
    for (const t of schoolTags ?? []) if ((t as any).user_id) candidateIds.add((t as any).user_id)
    for (const r of rels ?? []) if ((r as any).teacher_user_id) candidateIds.add((r as any).teacher_user_id)
  } else {
    const { data: rels } = await svc
      .from('class_teachers')
      .select('teacher_user_id')
      .eq('class_id', classId)
    for (const r of rels ?? []) if ((r as any).teacher_user_id) candidateIds.add((r as any).teacher_user_id)
  }

  let teachers: any[] = []
  if (candidateIds.size) {
    const { data: learners } = await svc
      .from('learners')
      .select('id, user_id, display_name')
      .in('user_id', [...candidateIds])
    teachers = (learners ?? [])
      .map((l: any) => ({ user_id: l.user_id, learner_id: l.id, display_name: l.display_name || 'Unnamed teacher' }))
      .sort((a: any, b: any) => a.display_name.localeCompare(b.display_name))
  }

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({ class_id: classId, school_id: schoolId, teachers })
}
