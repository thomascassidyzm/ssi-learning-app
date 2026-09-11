/**
 * Apply — POST /api/school/copy-teacher-play/apply
 *
 * Copies a teacher's own-account play for the class's course onto the class's
 * play-as-class learner, merges the cursor to the further position, and
 * writes one append-only class_progress_copy_audit record. Re-plans from the
 * database at the moment of the call (never trusts a client-held preview),
 * so a preview shown minutes ago cannot double anything.
 *
 * Refused under View-as with the standard 403 (Tom browsing staging as
 * Angharad is read-only by design): the preview works there, the apply does
 * not. That is not a bug.
 *
 * A partial write is reported as an error naming the table that failed; the
 * rows that DID land are in the audit record, so the next preview reads them
 * as already present. Never a false "Copied".
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveCopyContext, positionWords } from './_shared'
import { planCopy, applyCopy, cursorPosition } from '../../_utils/classProgressCopy'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = await resolveCopyContext(req, res, { allowViewAs: false })
  if (!ctx) return
  try {
    const plan = await planCopy(ctx.svc, {
      sourceLearnerId: ctx.sourceLearnerId,
      targetLearnerId: ctx.targetLearnerId,
      courseCode: ctx.courseCode,
    })
    const { record, auditId, error } = await applyCopy(ctx.svc, plan, {
      actorUserId: ctx.callerUserId,
      classId: ctx.classId,
    })
    const copiedCounts = Object.fromEntries(Object.entries(record.copied).map(([t, m]) => [t, Object.keys(m).length]))
    const totalRows = Object.values(copiedCounts).reduce((a, b) => a + b, 0)
    const classNow = await positionWords(ctx.svc, ctx.courseCode, cursorPosition(record.cursorAfter.target))
    const body = {
      audit_id: auditId,
      class_id: ctx.classId,
      course_code: ctx.courseCode,
      teacher: { user_id: ctx.teacherUserId, name: ctx.teacherName },
      copied: copiedCounts,
      total_rows: totalRows,
      already_present: record.alreadyPresent,
      skipped: record.skipped,
      in_app_seconds: record.inAppSecondsCopied,
      minutes_added: record.minutesAdded,
      cursor_taken_from_teacher: record.cursorTakenFromSource,
      position: { class: classNow },
    }
    if (error) {
      res.status(500).json({ ...body, error: `Copy stopped part-way: ${error}` })
      return
    }
    res.status(200).json(body)
  } catch (err) {
    console.error('[school/copy-teacher-play/apply]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' })
  }
}
