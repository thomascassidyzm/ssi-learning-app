/**
 * Free-year expiry warnings — /api/cron/org-free-year-warnings
 * ============================================================
 *
 * "Warn users a few weeks before their free year ends, not on the day."
 * (Kai, 2026-09-08.) How many weeks is org_enrolment_policies.warn_days_before
 * — 21 days by default, a row not a constant.
 *
 * Daily. Finds enrolments whose free_access_until falls inside the warning
 * window and which have never been warned, sends one mail, and stamps
 * expiry_warned_at. The stamp is what makes it once-only: the index
 * idx_org_enrolments_warning_due is partial on `expiry_warned_at IS NULL`, so
 * a stamped row is not merely filtered out, it is not looked at.
 *
 * Stamped BEFORE the send. A double-send is a worse failure than a missed
 * one here: the learner reads two identical "your free year is ending" mails
 * and stops trusting them. A send that fails after stamping is visible in the
 * run's `failed` count and in the log.
 *
 * Auth: the same CRON_SECRET bearer as every other cron in this directory,
 * failing closed on every deployed environment.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { checkCronAuth } from '../_utils/cronAuth'
import { postResendEmail } from '../_utils/resendMail'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const cronSecret = (process.env.CRON_SECRET || '').trim()
const resendKey = (process.env.RESEND_API_KEY || '').trim()
const FROM = (process.env.SIGNIN_EMAIL_FROM || 'SaySomethingin <hello@contact.saysomethingin.app>').trim()

/** Plain words, a real date, and what to do about it. No jargon, no countdown drama. */
export function warningCopy(orgName: string, endsOn: string): { subject: string; text: string; html: string } {
  const subject = `Your free year with SaySomethingin ends on ${endsOn}`
  const text = [
    `Your free year of SaySomethingin — the one that came with your ${orgName} course — ends on ${endsOn}.`,
    '',
    'Nothing happens before then, and nothing is taken away without warning. If you would like to carry on afterwards you can subscribe any time, and everything you have learned stays exactly where it is.',
    '',
    'Diolch am ddysgu gyda ni.',
    '',
    'https://saysomethingin.app',
  ].join('\n')
  const html = text
    .split('\n')
    .map((line) => (line ? `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : ''))
    .join('')
  return { subject, text, html }
}

/** Everything due for a warning today, given each org's own lead time. */
export function isDue(freeAccessUntil: string, warnDaysBefore: number, now: Date): boolean {
  const ends = new Date(freeAccessUntil).getTime()
  const leadMs = warnDaysBefore * 86400000
  // Inside the window, and not already past — a year that has already ended
  // gets no "it is about to end" mail.
  return ends > now.getTime() && ends - now.getTime() <= leadMs
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const cronAuth = checkCronAuth((req.headers.authorization || '').trim(), cronSecret)
  if (!cronAuth.ok) {
    console.error(`[cron/org-free-year-warnings] ${cronAuth.error} — refusing to run`)
    res.status(cronAuth.status || 401).json({ error: cronAuth.error })
    return
  }
  if (cronAuth.warning) console.warn(`[cron/org-free-year-warnings] ${cronAuth.warning}`)
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const now = new Date()

  try {
    const { data: policies } = await supabase
      .from('org_enrolment_policies')
      .select('group_id, org_display_name, warn_days_before')
    const policyByGroup = new Map(
      ((policies ?? []) as any[]).map((p) => [p.group_id, p]),
    )
    if (!policyByGroup.size) {
      res.status(200).json({ warned: 0, failed: 0, considered: 0 })
      return
    }

    const maxLeadDays = Math.max(...[...policyByGroup.values()].map((p) => p.warn_days_before || 21))
    const horizon = new Date(now.getTime() + maxLeadDays * 86400000).toISOString()

    const { data: due } = await supabase
      .from('org_enrolments')
      .select('id, learner_id, group_id, free_access_until')
      .is('expiry_warned_at', null)
      .gt('free_access_until', now.toISOString())
      .lte('free_access_until', horizon)
      .limit(500)

    const rows = ((due ?? []) as any[]).filter((r) => {
      const p = policyByGroup.get(r.group_id)
      return p ? isDue(r.free_access_until, p.warn_days_before || 21, now) : false
    })

    let warned = 0
    let failed = 0
    for (const row of rows) {
      const policy = policyByGroup.get(row.group_id)
      const { data: learner } = await supabase
        .from('learners')
        .select('verified_emails')
        .eq('id', row.learner_id)
        .maybeSingle()
      const to = ((learner as any)?.verified_emails ?? [])[0] as string | undefined

      // Stamped first, deliberately — see the header on why a double-send is
      // the worse failure.
      await supabase
        .from('org_enrolments')
        .update({ expiry_warned_at: now.toISOString() })
        .eq('id', row.id)

      if (!to || !resendKey) {
        failed++
        continue
      }
      const endsOn = new Date(row.free_access_until).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
      })
      const copy = warningCopy(policy.org_display_name, endsOn)
      const sent = await postResendEmail(resendKey, { from: FROM, to, ...copy })
      if (sent.sent) warned++
      else {
        failed++
        console.warn('[cron/org-free-year-warnings] send failed for enrolment', row.id, sent.error)
      }
    }

    console.log(`[cron/org-free-year-warnings] considered ${rows.length}, warned ${warned}, failed ${failed}`)
    res.status(200).json({ warned, failed, considered: rows.length })
  } catch (error: any) {
    console.error('[cron/org-free-year-warnings] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
