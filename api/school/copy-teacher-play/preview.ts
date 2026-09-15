/**
 * Preview — POST /api/school/copy-teacher-play/preview
 *
 * The dry run. Given { class_id, teacher_user_id }, answers "what would move
 * if I copied this teacher's own play onto the class account?": per-table row
 * counts, what is already there from an earlier run, the in-app time the
 * diary rows carry, the teacher's position and the class's position in the
 * course, and where the class will end up. Writes NOTHING, so it works under
 * View-as as well (see _shared.ts).
 *
 * The payload is built by `previewBody` in _shared.ts, the same builder the
 * school-wide candidates list uses (job #662).
 *
 * Model, scope and idempotency: api/_utils/classProgressCopy.ts.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveCopyContext, previewBody } from './_shared'
import { planCopy } from '../../_utils/classProgressCopy'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = await resolveCopyContext(req, res, { allowViewAs: true })
  if (!ctx) return
  try {
    const plan = await planCopy(ctx.svc, {
      sourceLearnerId: ctx.sourceLearnerId,
      targetLearnerId: ctx.targetLearnerId,
      courseCode: ctx.courseCode,
    })
    const body = await previewBody(ctx.svc, {
      classId: ctx.classId,
      courseCode: ctx.courseCode,
      teacher: { user_id: ctx.teacherUserId, name: ctx.teacherName, learner_id: ctx.sourceLearnerId },
      classLearnerId: ctx.targetLearnerId,
    }, plan)
    res.status(200).json(body)
  } catch (err) {
    console.error('[school/copy-teacher-play/preview]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
  }
}
