/**
 * GET /api/cron/support-doorbell — the email doorbell (spec §14 item 17).
 *
 * A reply on a school's support thread that has sat unopened for a few hours
 * gets ONE email, through the existing Resend path from
 * contact.saysomethingin.app, carrying the reply and a link straight into the
 * thread. Not a new email loop: a doorbell for the one in the app. Sent once
 * per reply (doorbell_sent_at), to the admin who asked the question the reply
 * answers, in the thread's language.
 *
 * Auth: Vercel cron's `Authorization: Bearer <CRON_SECRET>`; fails closed on
 * every deployed environment. Hourly in vercel.json.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkCronAuth } from '../_utils/cronAuth'
import { postResendEmail } from '../_utils/resendMail'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const cronSecret = (process.env.CRON_SECRET || '').trim()
const resendKey = (process.env.RESEND_API_KEY || '').trim()
const FROM = (process.env.INVITE_EMAIL_FROM || 'SaySomethingin <noreply@contact.saysomethingin.app>').trim()
const APP_ORIGIN = (process.env.APP_ORIGIN || 'https://saysomethingin.app').trim()

/** How long a reply may sit unopened before the doorbell rings. */
export const DOORBELL_AFTER_HOURS = 3

const COPY = {
  eng: {
    subject: (from: string) => `${from} replied on your school's Support thread`,
    lead: (from: string) => `${from} has replied to your message on the Support thread in your school's dashboard.`,
    open: 'Open the thread',
    foot: 'You are getting this because a reply was waiting in the app. Replies always appear there first.',
  },
  cym: {
    subject: (from: string) => `Mae ${from} wedi ateb ar sgwrs Gymorth eich ysgol`,
    lead: (from: string) => `Mae ${from} wedi ateb eich neges ar y sgwrs Gymorth yn nangosfwrdd eich ysgol.`,
    open: 'Agor y sgwrs',
    foot: 'Rydych chi\'n cael hwn am fod ateb yn aros yn yr ap. Mae atebion bob amser yn ymddangos yno yn gyntaf.',
  },
}

export interface DoorbellReply {
  id: string
  thread_id: string
  body: string
  author_source: string
  author_name: string | null
  in_reply_to: string | null
  created_at: string
}

/** Replies old enough, unopened since, and not yet rung for. Pure, so the selection is testable. */
export function repliesDue(
  replies: DoorbellReply[],
  threads: Record<string, { last_read_at: string | null; language: string | null }>,
  now = Date.now(),
): DoorbellReply[] {
  const cutoff = now - DOORBELL_AFTER_HOURS * 3600_000
  return replies.filter((r) => {
    const t = threads[r.thread_id]
    if (!t) return false
    const created = Date.parse(r.created_at)
    if (created > cutoff) return false
    const read = t.last_read_at ? Date.parse(t.last_read_at) : 0
    return read < created
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function doorbellMessage(reply: DoorbellReply, language: string | null, to: string): { subject: string; html: string; text: string; to: string; from: string } {
  const c = language === 'cym' ? COPY.cym : COPY.eng
  const from = reply.author_source === 'human' ? (reply.author_name || 'Tom') : 'SSi'
  const link = `${APP_ORIGIN}/schools/support`
  const text = `${c.lead(from)}\n\n"${reply.body}"\n\n${c.open}: ${link}\n\n${c.foot}\n`
  const html = `<p>${escapeHtml(c.lead(from))}</p><blockquote style="border-left:3px solid #ddd;margin:16px 0;padding:8px 14px;white-space:pre-wrap">${escapeHtml(reply.body)}</blockquote><p><a href="${link}">${escapeHtml(c.open)}</a></p><p style="color:#777;font-size:13px">${escapeHtml(c.foot)}</p>`
  return { subject: c.subject(from), html, text, to, from: FROM }
}

async function askerEmail(svc: SupabaseClient, reply: DoorbellReply): Promise<string | null> {
  if (!reply.in_reply_to) return null
  const { data: q } = await svc.from('support_messages').select('author_user_id').eq('id', reply.in_reply_to).maybeSingle()
  const uid = (q as { author_user_id?: string | null } | null)?.author_user_id
  if (!uid) return null
  const { data } = await svc.auth.admin.getUserById(uid)
  return data?.user?.email ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const cronAuth = checkCronAuth((req.headers.authorization || '').trim(), cronSecret)
  if (!cronAuth.ok) {
    console.error(`[cron/support-doorbell] ${cronAuth.error} — refusing to run`)
    res.status(cronAuth.status || 401).json({ error: cronAuth.error })
    return
  }
  if (cronAuth.warning) console.warn(`[cron/support-doorbell] ${cronAuth.warning}`)
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }
  if (!resendKey) {
    res.status(200).json({ rang: 0, skipped: 'RESEND_API_KEY not configured' })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  try {
    const { data: replies } = await svc
      .from('support_messages')
      .select('id, thread_id, body, author_source, author_name, in_reply_to, created_at')
      .eq('direction', 'out')
      .is('doorbell_sent_at', null)
      .lte('created_at', new Date(Date.now() - DOORBELL_AFTER_HOURS * 3600_000).toISOString())
      .order('created_at', { ascending: true })
      .limit(50)
    const rows = (replies ?? []) as DoorbellReply[]
    const threadIds = [...new Set(rows.map((r) => r.thread_id))]
    const threads: Record<string, { last_read_at: string | null; language: string | null }> = {}
    if (threadIds.length) {
      const { data: ts } = await svc.from('support_threads').select('id, last_read_at, language').in('id', threadIds)
      for (const t of (ts ?? []) as Array<{ id: string; last_read_at: string | null; language: string | null }>) threads[t.id] = { last_read_at: t.last_read_at, language: t.language }
    }

    let rang = 0
    let noAddress = 0
    for (const reply of repliesDue(rows, threads)) {
      const to = await askerEmail(svc, reply)
      if (!to) {
        noAddress += 1
        // No address to ring: mark it so the row is not retried every hour forever.
        await svc.from('support_messages').update({ doorbell_sent_at: new Date().toISOString() }).eq('id', reply.id)
        continue
      }
      const message = doorbellMessage(reply, threads[reply.thread_id]?.language ?? null, to)
      const result = await postResendEmail(resendKey, message)
      if (result.sent) {
        rang += 1
        await svc.from('support_messages').update({ doorbell_sent_at: new Date().toISOString() }).eq('id', reply.id)
      } else {
        console.error(`[cron/support-doorbell] send failed for ${reply.id}: ${result.error}`)
      }
    }
    res.status(200).json({ rang, noAddress, considered: rows.length })
  } catch (err) {
    console.error('[cron/support-doorbell]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
