/**
 * Subscription-cancellation NOTE — GET/POST /api/org/enrolment-cancellation
 * =========================================================================
 *
 * THE LINE, and it is drawn here on purpose.
 *
 * When somebody who already pays for SaySomethingin enrols on a funded free
 * year, their paid subscription needs cancelling or they pay twice. Kai's
 * spec asked for the flow; Tom's instruction was that nothing may fire
 * against real billing without his own sign-off.
 *
 * So: this endpoint LISTS who needs cancelling, and RECORDS that a human did
 * it. It does not cancel anything. There is no Paddle client in this file, no
 * import that reaches one, and no feature flag that would turn one on — the
 * executor does not exist, which is a stronger guarantee than a flag set to
 * false. Turning this into an executor is a deliberate, reviewable change to
 * this file, not a config change.
 *
 * GET  ?groupId=…            → the queue: enrolments whose state is 'needed'.
 * POST { enrolmentId, state } → record 'learner_confirmed' or
 *                               'verified_cancelled'. A note, nothing more.
 *
 * Authz: ssi_admin or the org's leader, via the same pair every node endpoint
 * uses. Unlike the funder export, this queue DOES carry learner identity —
 * somebody has to know whose subscription to look at — so it is leader-only
 * and never leaves the building.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../_utils/groupTreeAuth'
import { fetchSubtree } from '../_utils/groupSubtree'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** The only two things a human may record. Neither of them cancels anything. */
export const RECORDABLE_STATES = ['learner_confirmed', 'verified_cancelled'] as const

/** One screenful, and a ceiling nobody can talk us past with a query string. */
const PAGE_SIZE = 100
const MAX_PAGE_SIZE = 500

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET,POST' })) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)
  const caller = await resolveGroupTreeCaller(req, res, supabase)
  if (!caller) return

  try {
    if (req.method === 'GET') {
      const groupId = String(req.query.groupId || '').trim()
      if (!groupId) {
        res.status(400).json({ error: 'groupId is required' })
        return
      }
      if (!(await callerCanSeeGroup(supabase, caller, groupId))) {
        res.status(403).json({ error: 'Not your group' })
        return
      }
      const subtree = await fetchSubtree(supabase, groupId)
      const groupIds = subtree.length ? subtree.map((g) => g.id) : [groupId]

      // PAGED, because a cohort is thousands of people and an unbounded read
      // of "everyone who needs chasing" is exactly the shape that started
      // timing out on the old system once its groups grew. One page at a time,
      // with the total so the caller knows how much is left.
      const limit = Math.min(Math.max(Number(req.query.limit ?? PAGE_SIZE) || PAGE_SIZE, 1), MAX_PAGE_SIZE)
      const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

      const { data: rows, count } = await supabase
        .from('org_enrolments')
        .select('id, learner_id, enrolled_at, free_access_until, prior_subscription_status, cancellation_state, cancellation_noted_at', { count: 'exact' })
        .in('group_id', groupIds)
        .in('cancellation_state', ['needed', 'learner_confirmed'])
        .order('enrolled_at', { ascending: true })
        .range(offset, offset + limit - 1)

      const enrolments = (rows ?? []) as any[]
      // Bounded by the page above, so this `.in()` is at most `limit` ids —
      // never "every learner in the org" on one URL.
      const learnerIds = [...new Set(enrolments.map((r) => r.learner_id))]
      const names = new Map<string, { display_name: string | null; user_id: string }>()
      if (learnerIds.length) {
        const { data: learners } = await supabase
          .from('learners')
          .select('id, display_name, user_id')
          .in('id', learnerIds)
        for (const l of (learners ?? []) as any[]) names.set(l.id, { display_name: l.display_name, user_id: l.user_id })
      }

      res.status(200).json({
        note: 'This is a queue for a human. Nothing in this repository cancels a subscription.',
        total: count ?? enrolments.length,
        limit,
        offset,
        nextOffset: enrolments.length === limit ? offset + limit : null,
        queue: enrolments.map((r) => ({
          enrolmentId: r.id,
          learnerId: r.learner_id,
          displayName: names.get(r.learner_id)?.display_name ?? null,
          enrolledAt: r.enrolled_at,
          freeAccessUntil: r.free_access_until,
          priorSubscriptionStatus: r.prior_subscription_status,
          state: r.cancellation_state,
          notedAt: r.cancellation_noted_at,
        })),
      })
      return
    }

    // POST — record a note
    const body = (req.body || {}) as Record<string, unknown>
    const enrolmentId = String(body.enrolmentId || '').trim()
    const state = String(body.state || '').trim()
    if (!enrolmentId || !(RECORDABLE_STATES as readonly string[]).includes(state)) {
      res.status(400).json({ error: `state must be one of ${RECORDABLE_STATES.join(', ')}` })
      return
    }

    const { data: row } = await supabase
      .from('org_enrolments')
      .select('id, group_id')
      .eq('id', enrolmentId)
      .maybeSingle()
    if (!row) {
      res.status(404).json({ error: 'No such enrolment' })
      return
    }
    if (!(await callerCanSeeGroup(supabase, caller, (row as any).group_id))) {
      res.status(403).json({ error: 'Not your group' })
      return
    }

    const { error: updErr } = await supabase
      .from('org_enrolments')
      .update({
        cancellation_state: state,
        cancellation_noted_at: new Date().toISOString(),
        cancellation_noted_by: caller.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrolmentId)
    if (updErr) {
      console.error('[org/enrolment-cancellation] update failed:', updErr)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    res.status(200).json({ success: true, state, billingActionTaken: false })
  } catch (error: any) {
    console.error('[org/enrolment-cancellation] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
