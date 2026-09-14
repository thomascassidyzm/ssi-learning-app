/**
 * Undo — POST /api/school/copy-teacher-play/undo
 *
 * The one tap at the end of the teacher's notice. The 2026-09-14 sweep copied
 * every unambiguous teacher's own-account play onto her class's Play as class
 * account without asking first; Tom's reasoning, accepted in the RBF room, was
 * that the copy is reversible and detectable by the teacher herself, so ship it
 * and let her edit in place. This is the reverse.
 *
 * Body: { audit_id }. Every copy wrote exactly one class_progress_copy_audit
 * row, and that row holds every id the copy created plus the class's own
 * cursor before it — so the undo needs nothing else and guesses nothing.
 *
 * WHO. The teacher whose play was copied, because it is her message and her
 * mistake to unmake; the school admin of that class; a platform admin. Notably
 * NOT any teacher of the class: a co-teacher deleting another's copy is not a
 * thing anyone asked for.
 *
 * VIEW-AS. Refused, like every other write: Tom checking staging as Angharad
 * is read-only by design.
 *
 * IDEMPOTENT. Undoing an already-undone copy deletes nothing and answers 200
 * saying so, because a teacher who taps twice on a slow connection must not
 * see an error.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../../_utils/auth'
import { applyCors } from '../../_utils/cors'
import { rejectIfViewAs } from '../../_utils/actAsGuard'
import { isPlatformAdmin, isSchoolAdminOfClass, fetchClassAuthRow } from '../../_utils/classTeacherAuth'
import { undoCopy, AUDIT_TABLE } from '../../_utils/classProgressCopy'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const viewAs = rejectIfViewAs(req)
  if (viewAs) { res.status(viewAs.status).json({ error: viewAs.error }); return }
  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) { res.status(401).json({ error: auth.error || 'Unauthorized' }); return }
  const auditId = typeof req.body?.audit_id === 'string' ? req.body.audit_id.trim() : ''
  if (!auditId) { res.status(400).json({ error: 'audit_id is required' }); return }
  if (!supabaseUrl || !supabaseServiceKey) { res.status(500).json({ error: 'Server configuration error' }); return }
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data, error } = await svc
      .from(AUDIT_TABLE)
      .select('id, class_id, source_learner_id')
      .eq('id', auditId)
      .maybeSingle()
    if (error) { res.status(500).json({ error: error.message }); return }
    const row = data as { id: string; class_id: string; source_learner_id: string } | null
    if (!row) { res.status(404).json({ error: 'No such copy' }); return }

    // The teacher whose play it was: her learner row carries her auth uid.
    const { data: srcLearner } = await svc
      .from('learners')
      .select('user_id')
      .eq('id', row.source_learner_id)
      .maybeSingle()
    const isSourceTeacher = String((srcLearner as { user_id?: string } | null)?.user_id || '') === auth.userId

    let allowed = isSourceTeacher
    if (!allowed) {
      const classRow = await fetchClassAuthRow(svc, String(row.class_id))
      allowed = (!!classRow && await isSchoolAdminOfClass(svc, auth.userId, classRow))
        || await isPlatformAdmin(svc, auth.userId)
    }
    if (!allowed) { res.status(403).json({ error: 'Not authorised to undo this copy' }); return }

    const result = await undoCopy(svc, auditId, { actorUserId: auth.userId })
    if (result.alreadyUndone) {
      res.status(200).json({ audit_id: auditId, undone: false, already_undone: true, message: 'That copy has already been put back' })
      return
    }
    if (!result.undone) { res.status(409).json({ error: result.error || 'Could not undo that copy' }); return }
    const body = {
      audit_id: auditId,
      undone: true,
      already_undone: false,
      undo_audit_id: result.undoAuditId ?? null,
      deleted: result.detail?.deleted ?? {},
      total_rows_deleted: Object.values(result.detail?.deleted ?? {}).reduce((a, b) => a + b, 0),
      cursor: result.detail?.cursor ?? 'unchanged',
      minutes_removed: result.detail?.minutesRemoved ?? 0,
    }
    // The rows are gone but the record of it is not; never a silent success.
    if (result.error) { res.status(500).json({ ...body, error: `Put back, but not recorded: ${result.error}` }); return }
    res.status(200).json(body)
  } catch (err) {
    console.error('[school/copy-teacher-play/undo]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
  }
}
