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
 * Model, scope and idempotency: api/_utils/classProgressCopy.ts.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveCopyContext, positionWords } from './_shared'
import { planCopy, cursorPosition } from '../../_utils/classProgressCopy'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = await resolveCopyContext(req, res, { allowViewAs: true })
  if (!ctx) return
  try {
    const plan = await planCopy(ctx.svc, {
      sourceLearnerId: ctx.sourceLearnerId,
      targetLearnerId: ctx.targetLearnerId,
      courseCode: ctx.courseCode,
    })
    const [teacherAt, classAt, resultingAt] = await Promise.all([
      positionWords(ctx.svc, ctx.courseCode, cursorPosition(plan.cursor.source)),
      positionWords(ctx.svc, ctx.courseCode, cursorPosition(plan.cursor.target)),
      positionWords(ctx.svc, ctx.courseCode, plan.resulting),
    ])
    const totalRows = Object.values(plan.toCopy).reduce((a, b) => a + b, 0)
    res.status(200).json({
      class_id: ctx.classId,
      course_code: ctx.courseCode,
      teacher: { user_id: ctx.teacherUserId, name: ctx.teacherName, learner_id: ctx.sourceLearnerId },
      class_learner_id: ctx.targetLearnerId,
      to_copy: plan.toCopy,
      already_present: plan.alreadyPresent,
      total_rows: totalRows,
      skipped: plan.skipped,
      in_app_seconds: plan.inAppSecondsToCopy,
      minutes_to_add: plan.minutesToAdd,
      prior_runs: plan.priorRuns,
      position: {
        teacher: teacherAt,
        class: classAt,
        resulting: { ...resultingAt, taken_from_teacher: plan.resulting.takenFromSource },
      },
      nothing_to_copy: totalRows === 0 && !plan.resulting.takenFromSource,
    })
  } catch (err) {
    console.error('[school/copy-teacher-play/preview]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
  }
}
