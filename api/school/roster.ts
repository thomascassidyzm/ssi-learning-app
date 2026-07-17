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
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope, schoolIdForAdmin, chunk } from '../_utils/schoolScope'

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
      svc.from('user_tags')
        .select('user_id, added_at')
        .eq('tag_value', `SCHOOL:${schoolId}`)
        .eq('tag_type', 'school')
        .eq('role_in_context', 'teacher')
        .is('removed_at', null),
      classIds.length
        ? svc.from('class_teachers').select('class_id, teacher_user_id').in('class_id', classIds)
        : Promise.resolve({ data: [], error: null } as any),
    ])
    if (teacherTagsErr) throw teacherTagsErr
    if (classTeachersErr) throw classTeachersErr

    const teacherUserIds = (teacherTags ?? []).map((t: any) => t.user_id).filter(Boolean)
    const joinDates = new Map((teacherTags ?? []).map((t: any) => [t.user_id, t.added_at]))

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
      if (!uid || !cid || !teacherUserIds.includes(uid)) continue
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
          joined_at: joinDates.get(l.user_id) || '',
        }
      }).sort((a: any, b: any) => a.display_name.localeCompare(b.display_name))
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      school: school ?? null,
      teachers,
      students: students.map((p: any) => ({
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
