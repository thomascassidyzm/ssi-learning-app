/**
 * Shared resolution for POST /api/school/copy-teacher-play/{preview,apply}.
 *
 * Both endpoints take { class_id, teacher_user_id } and need the same four
 * answers before anything else: may the caller do this to this class; is
 * that person actually a teacher of it; which learners.id is the teacher's
 * own account; which learners.id is the class's play-as-class account. One
 * function owns all four so the two endpoints cannot disagree.
 *
 * AUTH. `canTeachClass` (api/_utils/classTeacherAuth.ts): the school admin of
 * the class's school under either spelling, ssi_admin, or an active teacher
 * of the class. The teacher leg is deliberate and free: the commonest case is
 * a teacher fixing their OWN mistaken play, and a co-teacher's play on the
 * same class belongs to the class in exactly the same way. The UI shows the
 * control to school admins; the server accepts the wider set.
 *
 * VIEW-AS. Both endpoints call `rejectIfViewAs` first. Tom checks staging as
 * Angharad through View-as, which is read-only by design: preview WORKS under
 * it (it writes nothing), apply is refused with the standard 403. The preview
 * handler passes `allowViewAs: true`; apply does not.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../../_utils/auth'
import { rejectIfViewAs } from '../../_utils/actAsGuard'
import { canTeachClass, fetchClassAuthRow } from '../../_utils/classTeacherAuth'
import { ensureClassLearnerEntity } from '../../_utils/classLearnerEntity'
import { applyCors } from '../../_utils/cors'
import type { Position } from '../../_utils/classProgressCopy'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export interface CopyContext {
  svc: SupabaseClient
  callerUserId: string
  classId: string
  courseCode: string
  teacherUserId: string
  teacherName: string
  sourceLearnerId: string
  targetLearnerId: string
}

/**
 * Runs the whole preamble. Returns the context, or null after having already
 * written the error response.
 */
export async function resolveCopyContext(
  req: VercelRequest,
  res: VercelResponse,
  opts: { allowViewAs: boolean },
): Promise<CopyContext | null> {
  if (applyCors(req, res, { methods: 'POST' })) return null
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }
  if (!opts.allowViewAs) {
    const viewAs = rejectIfViewAs(req)
    if (viewAs) {
      res.status(viewAs.status).json({ error: viewAs.error })
      return null
    }
  }
  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return null
  }
  const classId = typeof req.body?.class_id === 'string' ? req.body.class_id.trim() : ''
  const teacherUserId = typeof req.body?.teacher_user_id === 'string' ? req.body.teacher_user_id.trim() : ''
  if (!classId) { res.status(400).json({ error: 'class_id is required' }); return null }
  if (!teacherUserId) { res.status(400).json({ error: 'teacher_user_id is required' }); return null }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return null
  }
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  const classRow = await fetchClassAuthRow(svc, classId)
  if (!classRow) { res.status(404).json({ error: 'Class not found' }); return null }
  if (!(await canTeachClass(svc, auth.userId, classRow))) {
    res.status(403).json({ error: 'Not authorised to copy play onto this class' })
    return null
  }

  // The teacher must actually teach this class: the lead pointer or an active
  // class tag. Anyone else's play has no business on this class account.
  const teaches = classRow.teacher_user_id === teacherUserId
    || await (async () => {
      const { data } = await svc
        .from('user_tags')
        .select('id')
        .eq('tag_type', 'class')
        .eq('tag_value', `CLASS:${classId}`)
        .eq('role_in_context', 'teacher')
        .eq('user_id', teacherUserId)
        .is('removed_at', null)
        .maybeSingle()
      return !!data
    })()
  if (!teaches) { res.status(400).json({ error: 'That person is not a teacher of this class' }); return null }

  const { data: cls, error: clsErr } = await svc
    .from('classes')
    .select('course_code')
    .eq('id', classId)
    .maybeSingle()
  const courseCode = (cls as { course_code?: string | null } | null)?.course_code ?? ''
  if (clsErr || !courseCode) { res.status(409).json({ error: 'This class has no course, so there is nothing to copy onto' }); return null }

  const { data: teacherLearner, error: tlErr } = await svc
    .from('learners')
    .select('id, display_name')
    .eq('user_id', teacherUserId)
    .maybeSingle()
  if (tlErr) { res.status(500).json({ error: tlErr.message }); return null }
  if (!teacherLearner) { res.status(404).json({ error: 'That teacher has no learner account, so there is nothing to copy' }); return null }

  const ensured = await ensureClassLearnerEntity(svc, classId)
  if ('error' in ensured) { res.status(500).json({ error: ensured.error }); return null }

  return {
    svc,
    callerUserId: auth.userId,
    classId,
    courseCode,
    teacherUserId,
    teacherName: String((teacherLearner as { display_name?: string | null }).display_name || ''),
    sourceLearnerId: String((teacherLearner as { id: string }).id),
    targetLearnerId: ensured.learnerId,
  }
}

export interface PositionWords {
  legoId: string | null
  known: string | null
  target: string | null
}

/**
 * The learner-facing form of a position: the last LEGO's own content in both
 * languages, never a number, never the words "seed" or "lego" (Tom's ruling,
 * "SEED position does not EXIST").
 */
export async function positionWords(svc: SupabaseClient, courseCode: string, pos: Position): Promise<PositionWords> {
  if (!pos.legoId) return { legoId: null, known: null, target: null }
  const { data } = await svc
    .from('course_legos')
    .select('known_text, target_text')
    .eq('course_code', courseCode)
    .eq('lego_id', pos.legoId)
    .maybeSingle()
  const row = data as { known_text?: string | null; target_text?: string | null } | null
  return { legoId: pos.legoId, known: row?.known_text ?? null, target: row?.target_text ?? null }
}
