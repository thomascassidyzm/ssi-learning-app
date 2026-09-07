/**
 * Put a student into a class — GET/POST /api/teacher/class-students
 *
 * The missing half of the class page. A class's roster is a set of
 * `user_tags(tag_type='class', role_in_context='student')` rows, and the live
 * `user_tags_insert` policy only ever lets a signed-in user tag THEMSELVES —
 * so the only door into a class was the student-facing join link, which the
 * pupil has to walk through themselves. A teacher looking at a pupil who is
 * already in the school, in the wrong set, had nothing to press (owner
 * observation: "adding students to a class is not obvious"). This is the
 * service-role write that gives them something to press, and the read that
 * tells them who they may press it for.
 *
 *   GET  ?class_id=<uuid>        → { candidates: [...] }
 *        Students of the class's SCHOOL who are not already on this class,
 *        each with the class they are currently in so a move reads as a move.
 *        Names only — no progress, no aggregates. A class with no school (the
 *        tutor lane) has no pool to draw on and honestly returns none.
 *
 *   POST { class_id, target_user_id } → { ok: true }
 *        Adds (or reactivates) the class/student tag and enrols the learner in
 *        the class's course, exactly as api/code/redeem.ts does when the pupil
 *        walks through the join link. Idempotent.
 *
 * Authorisation is `canTeachClass` — the day-to-day teaching-verb predicate,
 * co-teachers included, the same set that may mint the class's student join
 * code and that the live user_tags UPDATE policy already lets take a student
 * OFF the roster. Adding is the inverse of a verb they already hold, so it
 * gets the same gate rather than a narrower one. Leaders above the class are
 * allowed too, matching who the class page shows the control to.
 *
 * What this deliberately does NOT touch: nothing in seed_progress,
 * lego_progress, sessions or any other record of what a learner has done. A
 * roster change moves a membership row and nothing else — a pupil added to a
 * class brings every minute they have already practised with them.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { canTeachClass, fetchClassAuthRow, isLeaderAboveClass } from '../_utils/classTeacherAuth'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET,POST' })) return

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // An admin browsing read-only as somebody else must never WRITE through
  // this route (actAsGuard.ts). The read stays open: it is the same names the
  // roster already shows them.
  if (req.method === 'POST') {
    const viewAsRejection = rejectIfViewAs(req)
    if (viewAsRejection) {
      res.status(viewAsRejection.status).json({ error: viewAsRejection.error })
      return
    }
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

  const classId = req.method === 'GET'
    ? (typeof req.query?.class_id === 'string' ? req.query.class_id.trim() : '')
    : ((req.body || {}) as { class_id?: string }).class_id
  if (!classId || typeof classId !== 'string') {
    res.status(400).json({ error: 'class_id is required' })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const cls = await fetchClassAuthRow(svc, classId)
    if (!cls) {
      res.status(404).json({ error: 'Class not found' })
      return
    }

    const authorized =
      (await canTeachClass(svc, auth.userId, cls)) ||
      (await isLeaderAboveClass(svc, auth.userId, cls))
    if (!authorized) {
      res.status(403).json({ error: 'Only a teacher of this class or a leader above it can change its roster' })
      return
    }

    if (req.method === 'GET') {
      const candidates = await addableStudents(svc, cls.id, cls.school_id)
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ class_id: cls.id, school_id: cls.school_id, candidates })
      return
    }

    const targetUserId = ((req.body || {}) as { target_user_id?: string }).target_user_id
    if (!targetUserId || typeof targetUserId !== 'string') {
      res.status(400).json({ error: 'target_user_id is required' })
      return
    }

    // The candidate pool IS the authorisation boundary for WHOM: without this,
    // a teacher of one school could add any user id on the platform to their
    // class by guessing it. Only somebody already inside this class's school
    // may be moved into it; anyone else arrives through the join link, which
    // is their own consent.
    const pool = await addableStudents(svc, cls.id, cls.school_id)
    if (!pool.some(c => c.user_id === targetUserId)) {
      res.status(403).json({ error: 'That learner is not in this class\'s school' })
      return
    }

    const added = await addStudentTag(svc, cls.id, targetUserId, auth.userId)
    if (added) {
      res.status(500).json({ error: 'Failed to add the student', detail: added })
      return
    }

    await enrolInClassCourse(svc, cls.id, targetUserId)

    res.status(200).json({ ok: true, class_id: cls.id, target_user_id: targetUserId })
  } catch (err) {
    console.error('[ClassStudents] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

export interface StudentCandidate {
  user_id: string
  learner_id: string
  display_name: string
  current_class_name: string | null
}

/**
 * Students of this class's school who are not already on this class.
 *
 * The school's pupils are the union of its active classes' student tags —
 * there is no school-wide student tag to read (api/code/redeem.ts writes only
 * the CLASS: tag for a pupil), which is exactly why the school's own roster
 * endpoint builds its student list the same way.
 */
async function addableStudents(
  svc: SupabaseClient,
  classId: string,
  schoolId: string | null,
): Promise<StudentCandidate[]> {
  if (!schoolId) return []

  const { data: schoolClasses } = await svc
    .from('classes')
    .select('id, class_name')
    .eq('school_id', schoolId)
    .eq('is_active', true)
  const classNames = new Map<string, string>()
  for (const c of schoolClasses ?? []) classNames.set((c as any).id, (c as any).class_name)
  const otherClassIds = [...classNames.keys()].filter(id => id !== classId)
  if (!otherClassIds.length) return []

  const [{ data: elsewhere }, { data: here }] = await Promise.all([
    svc.from('user_tags')
      .select('user_id, tag_value')
      .eq('tag_type', 'class')
      .eq('role_in_context', 'student')
      .is('removed_at', null)
      .in('tag_value', otherClassIds.map(id => `CLASS:${id}`)),
    svc.from('user_tags')
      .select('user_id')
      .eq('tag_type', 'class')
      .eq('role_in_context', 'student')
      .is('removed_at', null)
      .eq('tag_value', `CLASS:${classId}`),
  ])

  const alreadyHere = new Set((here ?? []).map((r: any) => r.user_id))
  const currentClass = new Map<string, string | null>()
  for (const row of elsewhere ?? []) {
    const uid = (row as any).user_id as string
    if (!uid || alreadyHere.has(uid) || currentClass.has(uid)) continue
    const otherId = String((row as any).tag_value || '').replace(/^CLASS:/, '')
    currentClass.set(uid, classNames.get(otherId) ?? null)
  }
  if (!currentClass.size) return []

  const { data: learners } = await svc
    .from('learners')
    .select('id, user_id, display_name')
    .in('user_id', [...currentClass.keys()])

  return (learners ?? [])
    .map((l: any) => ({
      user_id: l.user_id as string,
      learner_id: l.id as string,
      // Never invent a name, and never drop a real pupil for the want of one.
      display_name: (l.display_name as string) || 'Unnamed student',
      current_class_name: currentClass.get(l.user_id) ?? null,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
}

/**
 * Add or reactivate the class/student tag. Returns an error message, or null
 * on success — including the already-a-member case, which is a no-op.
 *
 * Reactivate-rather-than-insert respects the TOTAL unique key on
 * (user_id, tag_type, tag_value): a pupil who was removed from this class and
 * is being put back has a row already, and inserting a second one just fails.
 */
async function addStudentTag(
  svc: SupabaseClient,
  classId: string,
  targetUserId: string,
  callerUserId: string,
): Promise<string | null> {
  const tagValue = `CLASS:${classId}`
  const { data: existing } = await svc
    .from('user_tags')
    .select('id, removed_at')
    .eq('tag_type', 'class')
    .eq('tag_value', tagValue)
    .eq('role_in_context', 'student')
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (existing && (existing as any).removed_at) {
    const { error } = await svc
      .from('user_tags')
      .update({ removed_at: null, added_at: new Date().toISOString(), added_by: callerUserId })
      .eq('id', (existing as any).id)
    return error ? error.message : null
  }
  if (!existing) {
    const { error } = await svc.from('user_tags').insert({
      user_id: targetUserId,
      tag_type: 'class',
      tag_value: tagValue,
      role_in_context: 'student',
      added_by: callerUserId,
    })
    return error ? error.message : null
  }
  return null
}

/**
 * Enrol the pupil in the class's course, the same idempotent upsert the join
 * link performs — "in the class" and "able to play the class's course" have to
 * be the same act, or the pupil lands in the app on the wrong course.
 * Best-effort, exactly as in redeem.ts: the membership is the write that
 * matters, and `ignoreDuplicates` means an existing enrolment is never edited.
 */
async function enrolInClassCourse(
  svc: SupabaseClient,
  classId: string,
  targetUserId: string,
): Promise<void> {
  const { data: cls } = await svc.from('classes').select('course_code').eq('id', classId).maybeSingle()
  const courseCode = (cls as any)?.course_code as string | undefined
  if (!courseCode) return

  const { data: learner } = await svc.from('learners').select('id').eq('user_id', targetUserId).maybeSingle()
  const learnerId = (learner as any)?.id as string | undefined
  if (!learnerId) return

  const { error } = await svc
    .from('course_enrollments')
    .upsert({ learner_id: learnerId, course_id: courseCode }, { onConflict: 'learner_id,course_id', ignoreDuplicates: true })
  if (error) console.error('[ClassStudents] Failed to enrol student in class course (non-fatal):', error)
}
