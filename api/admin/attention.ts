/**
 * Admin Attention API - GET /api/admin/attention
 *
 * ssi_admin only. Returns subscribers who need attention, computed server-side
 * from subscription state + practice activity. This is both the "users needing
 * attention" surface and a live robustness signal: a subscribed user with zero
 * activity is exactly the entitlement-bug class we shipped a fix for.
 *
 * v1 population = everyone with a subscription row (subscriber health). Free-user
 * attention (e.g. stuck at a friction seed) is a later pass.
 *
 * Note: subscriptions.status maps Paddle `trialing`→`active`, so "subscribed"
 * here covers both trial and paid — we can't cleanly split them from this table.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Tunable thresholds — the definition of "needs attention".
const INACTIVE_DAYS = 7      // subscribed + no practice in this long → high priority
const ENDING_SOON_DAYS = 3   // period ends within this → "renewing soon"
const LOW_USE_MINUTES = 30   // total practice below this → "barely used"
const SUB_FETCH_CAP = 5000   // v1 safety cap; paginate when subscriber base grows

const CHUNK = 200
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const DAY_MS = 86_400_000
function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / DAY_MS
}
function daysUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / DAY_MS
}
function fmtDate(iso: string | null): string {
  if (!iso) return 'soon'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface SubRow {
  learner_id: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  signup_course_code: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }
  if (!supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. All subscribers (v1 population).
    const { data: subs, error: subErr } = await supabase
      .from('subscriptions')
      .select('learner_id, status, current_period_end, cancel_at_period_end, signup_course_code')
      .limit(SUB_FETCH_CAP)
    if (subErr) throw subErr

    const rows = (subs || []) as SubRow[]
    const learnerIds = Array.from(new Set(rows.map(r => r.learner_id).filter(Boolean)))
    if (learnerIds.length === 0) {
      res.status(200).json({ flagged: [], healthy: 0, totalSubscribers: 0 })
      return
    }

    // 2. Practice activity per learner (max last_practiced, sum minutes).
    const activity = new Map<string, { lastPracticed: string | null; minutes: number }>()
    const enrollResults = await Promise.all(
      chunk(learnerIds, CHUNK).map(ids =>
        supabase
          .from('course_enrollments')
          .select('learner_id, last_practiced_at, total_practice_minutes')
          .in('learner_id', ids),
      ),
    )
    for (const { data, error } of enrollResults) {
      if (error) throw error
      for (const e of data || []) {
        const cur = activity.get(e.learner_id) || { lastPracticed: null, minutes: 0 }
        cur.minutes += e.total_practice_minutes || 0
        if (e.last_practiced_at && (!cur.lastPracticed || e.last_practiced_at > cur.lastPracticed)) {
          cur.lastPracticed = e.last_practiced_at
        }
        activity.set(e.learner_id, cur)
      }
    }

    // 3. Names + primary email.
    const names = new Map<string, string | null>()
    const emails = new Map<string, string | null>()
    const learnerResults = await Promise.all(
      chunk(learnerIds, CHUNK).map(ids =>
        supabase.from('learners').select('id, display_name').in('id', ids),
      ),
    )
    for (const { data } of learnerResults) {
      for (const l of data || []) names.set(l.id, l.display_name)
    }
    const emailResults = await Promise.all(
      chunk(learnerIds, CHUNK).map(ids =>
        supabase
          .from('learner_emails')
          .select('learner_id, email, is_primary')
          .in('learner_id', ids)
          .order('is_primary', { ascending: false }),
      ),
    )
    for (const { data } of emailResults) {
      for (const r of data || []) {
        if (!emails.has(r.learner_id)) emails.set(r.learner_id, r.email)
      }
    }

    // 4. Apply rules.
    const flagged: any[] = []
    let healthy = 0
    for (const s of rows) {
      const act = activity.get(s.learner_id) || { lastPracticed: null, minutes: 0 }
      const dSince = act.lastPracticed ? daysSince(act.lastPracticed) : Infinity
      const endsIn = s.current_period_end ? daysUntil(s.current_period_end) : null

      let level: 'high' | 'medium' | null = null
      let reason = ''
      if (s.status === 'active' && dSince > INACTIVE_DAYS) {
        level = 'high'
        reason = act.lastPracticed
          ? `Subscribed · last seen ${Math.floor(dSince)}d ago · ${Math.round(act.minutes)}m total`
          : `Subscribed · never practised`
      } else if (s.cancel_at_period_end) {
        level = 'medium'
        reason = `Cancelling · ends ${fmtDate(s.current_period_end)}`
      } else if (endsIn !== null && endsIn <= ENDING_SOON_DAYS && act.minutes < LOW_USE_MINUTES) {
        level = 'medium'
        reason = `Renewing in ${Math.max(0, Math.ceil(endsIn))}d · only ${Math.round(act.minutes)}m used`
      }

      if (!level) { healthy++; continue }
      flagged.push({
        learner_id: s.learner_id,
        name: names.get(s.learner_id) || null,
        email: emails.get(s.learner_id) || null,
        level,
        reason,
        course: s.signup_course_code || null,
        last_practiced_at: act.lastPracticed,
      })
    }

    // High priority first, then most-recently-active within a level.
    flagged.sort((a, b) => {
      if (a.level !== b.level) return a.level === 'high' ? -1 : 1
      return (b.last_practiced_at || '').localeCompare(a.last_practiced_at || '')
    })

    res.status(200).json({ flagged, healthy, totalSubscribers: rows.length })
  } catch (error) {
    console.error('[AdminAttention] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
