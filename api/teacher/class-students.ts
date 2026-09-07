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
 *        each with the classes they are currently in so the teacher can see
 *        what a tap will and will not change. Names only — no progress, no
 *        aggregates. A class with no school (the tutor lane) has no pool to
 *        draw on and honestly returns none. A lookup that FAILS is never
 *        flattened into an empty list: it raises, and the caller gets a 500,
 *        because "there is nobody" and "I could not find out" are different
 *        answers and only one of them is reassuring.
 *
 *   POST { class_id, target_user_id } → { ok: true, still_in: [...] }
 *        Enrols the learner in the class's course and adds (or reactivates)
 *        the class/student tag, exactly as api/code/redeem.ts does when the
 *        pupil walks through the join link.
 *
 * IDEMPOTENT, AND THAT IS LOAD-BEARING. Two tables are written and PostgREST
 * gives us no transaction across them, so the guarantee is built out of order
 * and repeatability rather than a transaction:
 *   1. the ENROLMENT goes first. If it fails we have written nothing and say
 *      so with a 500 — where the old order wrote the membership, logged the
 *      enrolment failure as non-fatal and returned success, leaving a pupil in
 *      the class who could not play its course.
 *   2. the MEMBERSHIP goes second. If it fails, the enrolment left behind is
 *      inert — a course the learner may play and no class claiming them.
 *   3. an EXISTING member is a legal target, not a 403. So the retry that
 *      follows any failure re-runs both writes and repairs whatever half is
 *      missing — including rows left half-written by the previous version of
 *      this route. The pool still HIDES existing members from the picker; it
 *      is only the write that lets them through.
 * Chosen over a stored procedure because it needs no new database object, no
 * migration and no second place for this rule to live: the repair is the same
 * code path as the first attempt.
 *
 * MULTIPLE CLASS MEMBERSHIPS ARE INTENDED and this route does not change that.
 * A pupil doing Welsh in one class and Spanish in another is two memberships;
 * `api/code/redeem.ts` adds a class tag without touching the others, and
 * `api/school/roster.ts` reports a `class_count` per pupil. So an add is an
 * ADD, never a silent move — and the response carries `still_in`, the other
 * classes the pupil remains in, so the page can say so rather than let the
 * teacher assume a transfer happened. Taking them out of the old class is the
 * Remove button on that class's own roster, which the page links straight to.
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
 * class brings every minute they have already practised with them, and the
 * enrolment upsert carries `ignoreDuplicates` so an enrolment that already
 * exists is not rewritten either.
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
      // Existing members are hidden from the PICKER — they are already on the
      // roster right above it — but they stay in the pool the write consults.
      const candidates = (await schoolStudents(svc, cls.id, cls.school_id)).filter(c => !c.already_here)
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
    const pool = await schoolStudents(svc, cls.id, cls.school_id)
    const target = pool.find(c => c.user_id === targetUserId)
    if (!target) {
      res.status(403).json({ error: 'That learner is not in this class\'s school' })
      return
    }

    // Enrolment first, membership second, both idempotent — see the ordering
    // note in the file header. Neither failure is swallowed: a half-written
    // add reports 500 and the retry finishes it.
    const enrolFailure = await enrolInClassCourse(svc, cls.id, targetUserId)
    if (enrolFailure) {
      res.status(500).json({ error: 'Could not give this student the class\'s course. Nothing was changed — try again.', detail: enrolFailure })
      return
    }

    const added = await addStudentTag(svc, cls.id, targetUserId, auth.userId)
    if (added) {
      res.status(500).json({ error: 'Failed to add the student', detail: added })
      return
    }

    res.status(200).json({
      ok: true,
      class_id: cls.id,
      target_user_id: targetUserId,
      already_member: target.already_here,
      // The classes this pupil is STILL in. An add is an add; the page says so.
      still_in: target.current_classes,
    })
  } catch (err) {
    if (err instanceof LookupFailure) {
      console.error('[ClassStudents] Lookup failed:', err.message)
      res.status(500).json({ error: `Could not read the school's student list (${err.message}).` })
      return
    }
    console.error('[ClassStudents] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * A read that did not answer. Distinct from an empty answer on purpose: the
 * whole point of the type is that it cannot be mistaken for "nobody".
 */
export class LookupFailure extends Error {
  constructor(what: string, detail: string) {
    super(`${what}: ${detail}`)
    this.name = 'LookupFailure'
  }
}

export interface StudentCandidate {
  user_id: string
  learner_id: string
  display_name: string
  /** Every OTHER class of this school the pupil is in right now. Drawn, not summarised. */
  current_classes: Array<{ id: string; name: string }>
  /** Already on this class's roster. Hidden from the picker; allowed by the write. */
  already_here: boolean
}

/**
 * Every pupil of this class's school, with the classes each is in now.
 *
 * The school's pupils are the union of its active classes' student tags —
 * there is no school-wide student tag to read (api/code/redeem.ts writes only
 * the CLASS: tag for a pupil), which is exactly why the school's own roster
 * endpoint builds its student list the same way.
 *
 * REMOVED tags count towards belonging to the school, and that is the fix for
 * a pupil disappearing altogether: taking somebody out of the only class they
 * were in used to delete them from this list, so the one action a teacher
 * needed — putting them back — was the one action that had become impossible.
 * A removed tag still says "this was a pupil of this school"; it just stops
 * saying which class they are in.
 *
 * Every query raises on error rather than degrading to an empty array. An
 * empty array reaching the page reads as "everyone in your school is already
 * in this class", and a false all-clear that nobody can detect is the worst
 * thing this file could return.
 */
async function schoolStudents(
  svc: SupabaseClient,
  classId: string,
  schoolId: string | null,
): Promise<StudentCandidate[]> {
  if (!schoolId) return []

  const { data: schoolClasses, error: classesErr } = await svc
    .from('classes')
    .select('id, class_name')
    .eq('school_id', schoolId)
    .eq('is_active', true)
  if (classesErr) throw new LookupFailure("the school's classes", classesErr.message)

  const classNames = new Map<string, string>()
  for (const c of schoolClasses ?? []) classNames.set((c as any).id, (c as any).class_name)
  if (!classNames.size) return []

  const { data: tags, error: tagsErr } = await svc
    .from('user_tags')
    .select('user_id, tag_value, removed_at')
    .eq('tag_type', 'class')
    .eq('role_in_context', 'student')
    .in('tag_value', [...classNames.keys()].map(id => `CLASS:${id}`))
  if (tagsErr) throw new LookupFailure("the school's class memberships", tagsErr.message)

  const everyone = new Set<string>()
  const alreadyHere = new Set<string>()
  const elsewhere = new Map<string, Array<{ id: string; name: string }>>()
  for (const row of tags ?? []) {
    const uid = (row as any).user_id as string
    if (!uid) continue
    everyone.add(uid)
    if ((row as any).removed_at) continue
    const otherId = String((row as any).tag_value || '').replace(/^CLASS:/, '')
    if (otherId === classId) { alreadyHere.add(uid); continue }
    const list = elsewhere.get(uid) ?? []
    list.push({ id: otherId, name: classNames.get(otherId) ?? 'Another class' })
    elsewhere.set(uid, list)
  }
  if (!everyone.size) return []

  const { data: learners, error: learnersErr } = await svc
    .from('learners')
    .select('id, user_id, display_name')
    .in('user_id', [...everyone])
  if (learnersErr) throw new LookupFailure("the school's students", learnersErr.message)

  return (learners ?? [])
    .map((l: any) => ({
      user_id: l.user_id as string,
      learner_id: l.id as string,
      // Never invent a name, and never drop a real pupil for the want of one.
      display_name: (l.display_name as string) || 'Unnamed student',
      current_classes: (elsewhere.get(l.user_id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      already_here: alreadyHere.has(l.user_id),
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
 *
 * Returns an error message, or null when there is nothing left to do. NOT
 * best-effort any more: it runs BEFORE the membership and a failure aborts the
 * whole add, because a success that quietly skipped this step put a pupil in a
 * class with no course and no way to repair it from the page.
 *
 * `ignoreDuplicates` is the promise that a pupil brings their progress with
 * them: an enrolment that already exists is left exactly as it stands, so
 * nothing that records what the learner has done is rewritten.
 */
async function enrolInClassCourse(
  svc: SupabaseClient,
  classId: string,
  targetUserId: string,
): Promise<string | null> {
  const { data: cls, error: clsErr } = await svc.from('classes').select('course_code').eq('id', classId).maybeSingle()
  if (clsErr) return clsErr.message
  const courseCode = (cls as any)?.course_code as string | undefined
  // A class with no course has nothing to enrol into. Not a failure.
  if (!courseCode) return null

  const { data: learner, error: learnerErr } = await svc.from('learners').select('id').eq('user_id', targetUserId).maybeSingle()
  if (learnerErr) return learnerErr.message
  const learnerId = (learner as any)?.id as string | undefined
  if (!learnerId) return 'that student has no learner record'

  const { error } = await svc
    .from('course_enrollments')
    .upsert({ learner_id: learnerId, course_id: courseCode }, { onConflict: 'learner_id,course_id', ignoreDuplicates: true })
  return error ? error.message : null
}
