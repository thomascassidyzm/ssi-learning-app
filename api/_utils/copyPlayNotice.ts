/**
 * copyPlayNotice — the first specimen of the inbox (job #684): "your own play
 * is now on your class account", with one-tap undo.
 *
 * Passes the bar (userMessages.ts): a teacher who did not mean their play to
 * move can undo it; one who did can stop wondering why Play as class jumped.
 *
 * ONE builder, two callers: applyCopy sends it the moment a copy lands, and
 * the backfill (POST /api/messages/backfill-copy-notices) sends it for every
 * audit row that has no message yet — so the teacher-play sweep's rows get
 * their notice whether the sweep ran before or after this shipped. The dedupe
 * key class_play_copied:<audit_id> makes the two callers unable to double-send.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { AUDIT_TABLE, isUndoRow, isClaimRow, type AuditRow, type CopyRecord, type UndoRecord } from './classProgressCopy'
import { sendUserMessage, USER_MESSAGES_TABLE, type SendUserMessageResult } from './userMessages'

export function copyNoticeDedupeKey(auditId: string): string {
  return `class_play_copied:${auditId}`
}

/** True when the run actually moved something: rows landed or the cursor moved. */
export function copyDidSomething(record: CopyRecord): boolean {
  const rows = Object.values(record.copied ?? {}).reduce((n, m) => n + Object.keys(m).length, 0)
  return rows > 0 || !!record.cursorTakenFromSource
}

export interface CopyNoticeWords {
  title: string
  body: string
  undoLabel: string
}

/** Plain teacher English. Second person, no exclamation marks, no jargon. */
export function copyNoticeWords(courseName: string, className: string): CopyNoticeWords {
  return {
    title: `Your own practice on ${courseName} is now on ${className}'s account`,
    body:
      `Your practice on ${courseName} from your own account has been copied onto the ${className} class account, ` +
      `so Play as class now starts where you got to. Your own account keeps everything. ` +
      `If that is not what you wanted, undo it and the class account goes back to where it was.`,
    undoLabel: 'Undo',
  }
}

/**
 * Send the notice for one audit row to the teacher whose play was copied.
 * Idempotent by audit id. Never throws; the outcome says what happened.
 */
export async function sendClassPlayCopiedNotice(svc: SupabaseClient, auditId: string): Promise<SendUserMessageResult & { skipped?: string }> {
  const { data, error } = await svc.from(AUDIT_TABLE).select('*').eq('id', auditId).maybeSingle()
  if (error) return { sent: false, id: null, error: error.message }
  const audit = (data as AuditRow | null) ?? null
  if (!audit) return { sent: false, id: null, skipped: 'audit row not found' }
  if (isUndoRow(audit.record)) return { sent: false, id: null, skipped: 'an undo record, not a copy' }
  if (isClaimRow(audit.record)) return { sent: false, id: null, skipped: 'a copy still running, or abandoned, not a copy' }
  if (!copyDidSomething(audit.record as CopyRecord)) return { sent: false, id: null, skipped: 'the copy moved nothing' }

  const [{ data: teacher }, { data: cls }] = await Promise.all([
    svc.from('learners').select('user_id').eq('id', audit.source_learner_id).maybeSingle(),
    svc.from('classes').select('class_name').eq('id', audit.class_id).maybeSingle(),
  ])
  const recipientUserId = (teacher as { user_id?: string } | null)?.user_id
  if (!recipientUserId) return { sent: false, id: null, skipped: 'the source learner has no auth uid' }
  const { data: course } = await svc
    .from('courses')
    .select('learner_display_name, display_name')
    .eq('course_code', audit.course_code)
    .maybeSingle()
  const c = course as { learner_display_name?: string | null; display_name?: string | null } | null
  const courseName = c?.learner_display_name || c?.display_name || audit.course_code
  const className = (cls as { class_name?: string } | null)?.class_name || 'your class'
  const words = copyNoticeWords(courseName, className)
  return sendUserMessage(svc, {
    recipientUserId,
    source: 'class_play_copied',
    title: words.title,
    body: words.body,
    action: { kind: 'undo_class_play_copy', label: words.undoLabel, payload: { audit_id: audit.id, class_id: audit.class_id } },
    dedupeKey: copyNoticeDedupeKey(audit.id),
  })
}

export interface BackfillOutcome {
  considered: number
  sent: number
  already: number
  skipped: number
  failed: number
  details: Array<{ audit_id: string; result: string }>
}

/**
 * Every copy audit row with no notice yet gets one. Idempotent: run it as
 * often as you like. Command: POST /api/messages/backfill-copy-notices with an
 * ssi_admin bearer token; or call this from a script with the service client.
 */
export async function backfillCopyNotices(svc: SupabaseClient): Promise<BackfillOutcome> {
  const out: BackfillOutcome = { considered: 0, sent: 0, already: 0, skipped: 0, failed: 0, details: [] }
  const { data: audits, error } = await svc.from(AUDIT_TABLE).select('id, record').order('created_at', { ascending: true }).limit(1000)
  if (error) throw new Error(`${AUDIT_TABLE} read failed: ${error.message}`)
  const rows = (audits ?? []) as Array<{ id: string; record: CopyRecord | UndoRecord }>
  const copies = rows.filter((r) => !isUndoRow(r.record) && !isClaimRow(r.record))
  const keys = copies.map((r) => copyNoticeDedupeKey(String(r.id)))
  const existing = new Set<string>()
  for (let i = 0; i < keys.length; i += 200) {
    const { data: have } = await svc.from(USER_MESSAGES_TABLE).select('dedupe_key').in('dedupe_key', keys.slice(i, i + 200))
    for (const h of (have ?? []) as Array<{ dedupe_key: string }>) existing.add(h.dedupe_key)
  }
  for (const r of copies) {
    out.considered += 1
    if (existing.has(copyNoticeDedupeKey(String(r.id)))) { out.already += 1; continue }
    const result = await sendClassPlayCopiedNotice(svc, String(r.id))
    if (result.sent) out.sent += 1
    else if (result.error) { out.failed += 1; out.details.push({ audit_id: String(r.id), result: result.error }) }
    else if (result.skipped) { out.skipped += 1; out.details.push({ audit_id: String(r.id), result: result.skipped }) }
    else out.already += 1
  }
  return out
}
