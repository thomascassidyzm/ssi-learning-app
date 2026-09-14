/**
 * Candidates — POST /api/school/copy-teacher-play/candidates
 *
 * THE SCHOOL-ADMIN SWEEP, read side (job #662, Chepstow 2026-09-14). Tom:
 * "Angharad Jones as school admin SHOULD have a tool to copy any individual
 * teacher account stats over to the play as class stats, including progress,
 * else the teacher will need to continue playing as herself." The copy tool
 * exists one class at a time (preview/apply beside this file); what #651
 * found was thirteen teachers it had never been run for. This route lists,
 * for ONE school, every (class, teacher) pair where the teacher has play on
 * their own account for the class's course and the class account is behind
 * it — each pair with the SAME figures the single-pair preview returns, from
 * the same planner and the same body builder.
 *
 * Body: { school_id? }. Without it, the caller's own school as its admin. With
 * it, the caller must be an admin of THAT school under either spelling
 * (isSchoolAdminOf) or a platform admin — which is how View-as reaches it:
 * Tom checking staging as Angharad runs every fetch as the ssi_admin, whose
 * own school is none, and the client sends the persona's school_id.
 *
 * WRITES NOTHING, so it is allowed under View-as. It does not create a class
 * learner entity for a class that has none; such a class simply has nothing
 * on its side yet, and the apply creates the entity when it runs.
 *
 * There is deliberately NO bulk apply. Apply stays one pair at a time through
 * the existing route, which refuses View-as and writes the audit row.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../../_utils/auth'
import { applyCors } from '../../_utils/cors'
import { isSchoolAdminOf, adminSchoolIdFor } from '../../_utils/schoolStaff'
import { isPlatformAdmin } from '../../_utils/classTeacherAuth'
import { chunk } from '../../_utils/schoolScope'
import { planCopy } from '../../_utils/classProgressCopy'
import { previewBody } from './_shared'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** A class with no learner entity yet has nothing on its side: plan against a learner id that matches no row. */
const NO_CLASS_LEARNER = '00000000-0000-0000-0000-000000000000'
/** planCopy reads a dozen tables per pair; a school's worth runs a few at a time. */
const CONCURRENCY = 4

interface ClassRow { id: string; class_name: string; course_code: string | null; teacher_user_id: string | null; class_learner_id: string | null; is_active: boolean | null }

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) { res.status(401).json({ error: auth.error || 'Unauthorized' }); return }
  if (!supabaseUrl || !supabaseServiceKey) { res.status(500).json({ error: 'Server configuration error' }); return }
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const requested = typeof req.body?.school_id === 'string' ? req.body.school_id.trim() : ''
    let schoolId = ''
    if (requested) {
      const allowed = (await isSchoolAdminOf(svc, auth.userId, requested)) || (await isPlatformAdmin(svc, auth.userId))
      if (!allowed) { res.status(403).json({ error: 'Not an admin of that school' }); return }
      schoolId = requested
    } else {
      schoolId = (await adminSchoolIdFor(svc, auth.userId)) ?? ''
      if (!schoolId) { res.status(403).json({ error: 'You are not the admin of a school' }); return }
    }

    const { data: classData, error: classErr } = await svc
      .from('classes')
      .select('id, class_name, course_code, teacher_user_id, class_learner_id, is_active')
      .eq('school_id', schoolId)
    if (classErr) { res.status(500).json({ error: classErr.message }); return }
    const classes = ((classData ?? []) as ClassRow[]).filter((c) => c.is_active !== false && c.course_code)
    const classIds = classes.map((c) => c.id)

    // Every teacher of every class: the lead pointer and the active class tags.
    const teachersByClass = new Map<string, Set<string>>()
    for (const c of classes) if (c.teacher_user_id) teachersByClass.set(c.id, new Set([c.teacher_user_id]))
    for (const batch of chunk(classIds)) {
      const { data } = await svc
        .from('user_tags')
        .select('user_id, tag_value')
        .eq('tag_type', 'class')
        .eq('role_in_context', 'teacher')
        .is('removed_at', null)
        .in('tag_value', batch.map((id) => `CLASS:${id}`))
      for (const r of (data ?? []) as Array<{ user_id: string; tag_value: string }>) {
        const classId = String(r.tag_value).replace('CLASS:', '')
        if (!teachersByClass.has(classId)) teachersByClass.set(classId, new Set())
        teachersByClass.get(classId)!.add(String(r.user_id))
      }
    }
    const teacherUids = [...new Set([...teachersByClass.values()].flatMap((s) => [...s]))]

    const learnerByUid = new Map<string, { id: string; name: string }>()
    for (const batch of chunk(teacherUids)) {
      const { data } = await svc.from('learners').select('id, user_id, display_name').in('user_id', batch)
      for (const r of (data ?? []) as Array<{ id: string; user_id: string; display_name: string | null }>) {
        learnerByUid.set(String(r.user_id), { id: String(r.id), name: String(r.display_name || '') })
      }
    }

    // Cheap pre-filter before the planner: a teacher with no enrollment on the
    // class's course has no own-account play there to copy.
    const courses = [...new Set(classes.map((c) => String(c.course_code)))]
    const enrolled = new Set<string>()
    const learnerIds = [...learnerByUid.values()].map((l) => l.id)
    for (const batch of chunk(learnerIds)) {
      const { data } = await svc.from('course_enrollments').select('learner_id, course_id').in('learner_id', batch).in('course_id', courses)
      for (const r of (data ?? []) as Array<{ learner_id: string; course_id: string }>) enrolled.add(`${r.learner_id}|${r.course_id}`)
    }

    const pairs: Array<{ cls: ClassRow; uid: string; learner: { id: string; name: string } }> = []
    for (const cls of classes) {
      for (const uid of teachersByClass.get(cls.id) ?? []) {
        const learner = learnerByUid.get(uid)
        if (!learner) continue
        if (!enrolled.has(`${learner.id}|${cls.course_code}`)) continue
        pairs.push({ cls, uid, learner })
      }
    }

    const candidates: Array<Record<string, unknown>> = []
    const plans = await mapLimit(pairs, CONCURRENCY, async ({ cls, uid, learner }) => {
      const plan = await planCopy(svc, {
        sourceLearnerId: learner.id,
        targetLearnerId: cls.class_learner_id || NO_CLASS_LEARNER,
        courseCode: String(cls.course_code),
      })
      const body = await previewBody(svc, {
        classId: cls.id,
        courseCode: String(cls.course_code),
        teacher: { user_id: uid, name: learner.name, learner_id: learner.id },
        classLearnerId: cls.class_learner_id,
      }, plan)
      return { ...body, class_name: cls.class_name } as Record<string, unknown>
    })
    for (const body of plans) if (!body.nothing_to_copy) candidates.push(body)
    candidates.sort((a, b) => String(a.class_name).localeCompare(String(b.class_name)) || String((a.teacher as { name: string }).name).localeCompare(String((b.teacher as { name: string }).name)))

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ school_id: schoolId, classes_checked: classes.length, pairs_checked: pairs.length, candidates })
  } catch (err) {
    console.error('[school/copy-teacher-play/candidates]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

