/**
 * The schools note for the 2026-09-18 ship (job #202, drafted by job #195).
 *
 * Tom approved the words verbatim at 2026-09-18 12:00, to be sent AFTER the
 * promote is live on production. The words are read from the note file itself
 * (tools/release-train/notes/2026-09-18-schools.md, everything under "## The
 * note") so the thing sent and the thing approved cannot drift.
 *
 * AUDIENCE, exactly as the note defines it: every account holding an ACTIVE
 * teacher or school-leader tag ON A SCHOOL OR A CLASS — user_tags with
 * removed_at IS NULL and (tag_type,role_in_context) in school/admin,
 * school/teacher, class/teacher — minus demo, internal and class-entity
 * accounts (adminMessages.isSendable). Group-only roles are NOT in it: the
 * note says school or class, and that literal reading is the 124 Tom was told.
 *
 * NO ACTION BUTTON: it is a note, not a request.
 *
 * IDEMPOTENT ACROSS RUNS, unlike the #77 script: each recipient's broadcast id
 * is derived deterministically (uuid v5, fixed namespace) from RUN_KEY and the
 * recipient, so re-running this file sends nobody a second copy.
 *
 *   DRY=1 npx tsx tools/admin-messages/send-schools-whats-new-2026-09-18.mts
 *   npx tsx tools/admin-messages/send-schools-whats-new-2026-09-18.mts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { sendAdminMessage, isSendable } from '../../api/_utils/adminMessages'

const SB_URL = process.env.SB_URL
const SB_KEY = process.env.SB_KEY
if (!SB_URL || !SB_KEY) { console.error('Set SB_URL and SB_KEY (service role).'); process.exit(1) }
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
const DRY = process.env.DRY === '1'
const RUN_KEY = 'ssi-schools-whats-new-2026-09-18'

export const TITLE = "What's new in your school dashboard"
const NOTE = new URL('../release-train/notes/sources/2026-09-18-schools.md', import.meta.url).pathname
export const BODY = readFileSync(NOTE, 'utf8').split('## The note')[1].trim()

// Tom, platform_role ssi_admin — the sender the #77 send used.
const SENDER_USER_ID = 'ef65ea1f-57d0-4cf4-b744-33870c9449e8'

/** uuid v5-shaped id, stable for (RUN_KEY, recipient). */
function idFor(userId: string): string {
  const h = createHash('sha1').update(`${RUN_KEY}:${userId}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`
}

async function page<T>(table: string, select: string, tune?: (q: any) => any): Promise<T[]> {
  let out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q: any = db.from(table).select(select).range(from, from + 999)
    if (tune) q = tune(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out = out.concat(data || [])
    if (!data || data.length < 1000) return out
  }
}

const STAFF = new Set(['school/admin', 'school/teacher', 'class/teacher'])
const tags = await page<any>('user_tags', 'user_id, tag_type, role_in_context', (q) => q.is('removed_at', null))
const staffUids = new Set(
  tags.filter((t) => STAFF.has(`${t.tag_type}/${t.role_in_context}`)).map((t) => t.user_id).filter(Boolean))
const learners = await page<any>('learners', 'id, user_id, display_name, is_demo, is_internal, is_class_entity')
const byUid = new Map(learners.map((l) => [l.user_id, l]))
const recipients = [...staffUids]
  .map((uid) => byUid.get(uid))
  .filter((l) => l && isSendable(l))
  .map((l) => ({ userId: l.user_id as string, name: (l.display_name || '').trim() }))

console.log(`TITLE: ${TITLE}`)
console.log(`BODY: ${BODY.length} characters`)
console.log(`RECIPIENTS: ${recipients.length}`)
console.log(`SAMPLE: ${JSON.stringify(recipients.slice(0, 3))}`)
if (DRY) { console.log('DRY RUN — nothing sent.'); process.exit(0) }

let sent = 0, failed = 0
for (const r of recipients) {
  try {
    const result = await sendAdminMessage(db, {
      id: idFor(r.userId),
      senderUserId: SENDER_USER_ID,
      spec: { kind: 'one', userId: r.userId },
      title: TITLE,
      body: BODY,
    })
    sent += (result as any)?.sent ?? 0
  } catch (e: any) { failed++; console.log('FAILED', r.userId, e?.message) }
}
console.log(`SENT ROWS: ${sent}; failures: ${failed}; recipients: ${recipients.length}`)
