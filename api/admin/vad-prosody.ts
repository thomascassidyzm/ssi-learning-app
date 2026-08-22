/**
 * VAD prosody aggregates — GET /api/admin/vad-prosody
 *
 * HIERARCHY-SCOPED since 2026-08-20 (founder ruling: "the VAD data should
 * follow the same hierarchy of visibility that all data follows — students <
 * teachers < school leaders < group leaders"). It was ssi_admin-only; it is now
 * the same door for everyone, scoped:
 *   - ssi_admin   → every learner with prosody (unchanged, byte for byte)
 *   - group/school leader, teacher → the learners inside their own scope
 *   - a learner   → themselves
 * A caller who can see nobody gets an empty result, not a 403: "nobody below
 * you has prosody" is a true answer, and a 403 would make an empty scope
 * indistinguishable from a broken one.
 *
 * The URL keeps its /admin/ path deliberately — the admin board (VadBoard) and
 * the per-learner admin pages already call it, and moving it would have been a
 * rename with no reader. The gate lives in the handler, not the path.
 *
 * WHY A SERVER ENDPOINT, when the rest of the Voice & pause board reads
 * Supabase straight from the browser: player_events is own-row under RLS for
 * EVERYONE, admins included. Verified live 2026-08-12 with a real ssi_admin
 * JWT — learner_lego_metrics returns another learner's 65 rows, player_events
 * returns 0 of their 321 cycle_prosody rows. So a client-side prosody read can
 * only ever render dashes. (That same block, not the analytics exclusion, is
 * why "Recent activity" reads 0 for demo learners on the admin user page.)
 *
 * The RLS posture is deliberate and untouched: this endpoint is the
 * server-mediated door the RLS doctrine calls for — own-row in the policy,
 * cross-user authz in an endpoint with a test.
 *
 * AGGREGATES ONLY. Nothing per-event and no envelope contour ever leaves here —
 * counts and means per learner, so the caller can roll up to any scope and
 * still state its own denominator. The read and the fold live in
 * api/_utils/vadProsody.ts, shared with GET /api/org/vad so there is exactly
 * one implementation and one place aggregates-only could ever be broken.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveVadCaller } from '../_utils/vadVisibility'
import { fetchProsodyAggs } from '../_utils/vadProsody'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Re-exported for the existing tests and for any caller that folds its own
// rows — the implementation MOVED to _utils/vadProsody.ts, it did not fork.
export { foldProsody, type ProsodyAgg } from '../_utils/vadProsody'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const caller = await resolveVadCaller(req, res, supabase)
    if (!caller) return                                  // 401 already written

    // null = no filter, and ONLY for ssi_admin. Everyone else gets the learner
    // set resolved from their own verified identity — their scope's students
    // plus themselves. An empty array means "nobody", never "everybody".
    let scopeIds: string[] | null = null
    if (!caller.isAdmin) {
      const ids = new Set(caller.scope.learnerIds)
      if (caller.learnerId) ids.add(caller.learnerId)
      scopeIds = [...ids]
    }

    const result = await fetchProsodyAggs(supabase, scopeIds)
    res.status(200).json({
      events: result.events,
      learners: result.learners,
      truncated: result.truncated,                       // never a silent cap
      byLearner: result.byLearner,
    })
  } catch (e: unknown) {
    console.error('[admin/vad-prosody]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to aggregate prosody' })
  }
}
