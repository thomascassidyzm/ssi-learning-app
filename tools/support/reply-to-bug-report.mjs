#!/usr/bin/env node
/**
 * Reply to a learner's bug report, in the app (job #28). Tom, 2026-09-16 22:49Z:
 * "send a reply in the app".
 *
 * The reply goes out as an admin message to that one learner, so she meets it
 * as the quiet notice card on her Library and in /me/inbox — reading code that
 * has been in production since job #684. Her own report is quoted underneath.
 * Idempotent: the broadcast id is derived from the report id, so a re-run after
 * a timeout sends nothing twice.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node --experimental-strip-types --import ./tools/ts-extension-resolver.mjs \
 *     tools/support/reply-to-bug-report.mjs <report-id> --from <auth-uid> [--file reply.txt | --text "..."] [--resend] [--dry-run]
 *
 * --dry-run prints exactly what would land in her inbox and writes nothing.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { replyToBugReport, loadBugReport, composeReplyBody, replyBroadcastId, REPLY_TITLE } from '../../api/_utils/bugReportReply.ts'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? null : args[i + 1] }
const has = (name) => args.includes(`--${name}`)

const VALUE_FLAGS = new Set(['--from', '--file', '--text'])
let reportId = null
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { if (VALUE_FLAGS.has(args[i])) i++; continue }
  reportId = args[i]
  break
}
const senderUserId = flag('from')
const text = flag('file') ? readFileSync(flag('file'), 'utf8') : flag('text')

if (!reportId || !text || (!senderUserId && !has('dry-run'))) {
  console.error('usage: reply-to-bug-report.mjs <report-id> --from <auth-uid> --file reply.txt [--resend] [--dry-run]')
  process.exit(1)
}

const url = (process.env.SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const svc = createClient(url, key)

if (has('dry-run')) {
  const report = await loadBugReport(svc, reportId)
  if (!report) { console.error(`no bug report ${reportId}`); process.exit(1) }
  console.log(`to       ${report.auth_user_id || 'GUEST — cannot reply'}`)
  console.log(`course   ${report.course_code || '—'}`)
  console.log(`already  ${report.replied_at || 'unanswered'}`)
  console.log(`broadcast ${replyBroadcastId(report.id)}`)
  console.log(`\n── ${REPLY_TITLE} ──\n${composeReplyBody(text, report)}`)
  process.exit(0)
}

const out = await replyToBugReport(svc, { reportId, replyText: text, senderUserId, resend: has('resend') })
console.log(out.sent ? `sent — inbox row ${out.messageId} for ${out.recipientUserId}` : `nothing new sent — already in her inbox as ${out.messageId}`)
