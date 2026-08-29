/**
 * Reset the caller's own progress for one course — POST /api/account/reset-progress
 *
 * Server-mediated replacement for SettingsScreen.vue's confirmReset, which
 * ran client-side `.delete()` calls against response_metrics, spike_events,
 * lego_progress, seed_progress and sessions — the SAME missing-DELETE-grant
 * gap as the old client-side delete-account path (`api/account/delete.ts`).
 * Those deletes fail permission-denied and are only console.warn'd, never
 * surfaced, so historical rows for the course silently survive a "reset"
 * while course_enrollments (which the client DOES have UPDATE-grant for)
 * gets zeroed — the displayed cursor resets but the analytics history
 * underneath doesn't.
 *
 * Deliberately a server endpoint rather than a DELETE grant+policy on these
 * five tables: a live grant change needs the canary process (CLAUDE.md RLS
 * doctrine) and widens self-serve delete to every caller everywhere,
 * forever — for a reset flow used from exactly one Settings button, a
 * reviewed endpoint scoped to learner_id+course_id is the smaller, safer
 * surface. `course_enrollments` is folded in here too (was a separate
 * client UPDATE) so the whole reset is one atomic-from-the-client-side call
 * instead of two, removing the partial-reset window between them.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const RESET_SCOPED_TABLES = ['response_metrics', 'spike_events', 'lego_progress', 'seed_progress', 'sessions'] as const

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[account/reset-progress] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const courseCode = typeof req.body?.course_code === 'string' ? req.body.course_code.trim() : ''
  if (!courseCode) {
    res.status(400).json({ error: 'course_code is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Resolve the caller's OWN learner id from their verified auth id —
    // never from the request body.
    const { data: learner, error: learnerLookupErr } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (learnerLookupErr) {
      console.error('[account/reset-progress] Learner lookup failed:', learnerLookupErr)
      res.status(500).json({ error: 'Failed to look up account', detail: learnerLookupErr.message })
      return
    }
    if (!learner) {
      res.status(404).json({ error: 'No account found for this session' })
      return
    }

    for (const table of RESET_SCOPED_TABLES) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('learner_id', learner.id)
        .eq('course_id', courseCode)

      if (error) {
        // AUTH-CORE-10: the table name is ours and safe to name; the Postgres
        // message is not — it carries constraint and relation detail. Log it,
        // don't ship it.
        console.error(`[account/reset-progress] Failed clearing ${table}:`, error)
        res.status(500).json({ error: `Failed to reset progress (${table})` })
        return
      }
    }

    // Same reset payload the client used to write directly — cursor and
    // legacy ratcheted fields both nulled (2026-07-04 cursor-only decision;
    // legacy fields retired but still read by stale PWAs). last_practiced_at
    // is stamped to now, not nulled, so the reset always wins the
    // device-vs-server freshness comparison on next resume.
    const { error: enrollErr } = await supabase
      .from('course_enrollments')
      .update({
        total_practice_minutes: 0,
        last_practiced_at: new Date().toISOString(),
        highest_completed_seed: 0,
        last_completed_lego_id: null,
        highest_completed_lego_id: null,
        last_completed_round_index: null,
        highest_completed_round_index: null,
        completed_pod_rounds: 0,
        pod_activation_round: null,
        infplay_round_index: 0,
        current_mode: 'main',
      })
      .eq('learner_id', learner.id)
      .eq('course_id', courseCode)

    if (enrollErr) {
      console.error('[account/reset-progress] course_enrollments reset failed:', enrollErr)
      res.status(500).json({ error: 'Failed to reset course progress', detail: enrollErr.message })
      return
    }

    res.status(200).json({ ok: true })
  } catch (err: any) {
    console.error('[account/reset-progress] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
