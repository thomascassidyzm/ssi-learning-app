/**
 * Current-user phrases-spoken API - GET /api/me/phrases-spoken
 *
 * Auth required. Returns the LIFETIME count of cycles in which the VAD
 * actually heard the learner speak, summed ACROSS ALL of their courses — the
 * number the Library shows under "Phrases spoken".
 *
 * Why this exists (owner ruling, 2026-08-19, Activity-tiles diagnosis rec 3):
 * the tile is hidden unless mic/adaptation consent is on, and WHEN IT IS ON it
 * needs a server-side home, because localStorage + a 30-day window + one
 * course cannot carry a lifetime stat. Before this, the count lived only in
 * `ssi-session-history-<courseCode>` in the browser, was filtered to the last
 * 30 days, was per-course, and was banked only when endSession() ran — so a
 * session ended by closing the tab lost its count entirely.
 *
 * The source is learner_speaking_opportunities.phrases_spoken: one row per
 * (learner, course, UTC day), written by the bump_phrases_spoken RPC off the
 * same delta/watermark flush that already fires on visibilitychange and
 * beforeunload. No window, no course filter — every row the learner owns.
 *
 * Rows are read with `phrases_spoken > 0`, which is what keeps this cheap:
 * only days on which speech was actually detected come back. A learner who
 * has never run the mic reads zero rows and the endpoint answers 0.
 *
 * Scoped to the caller's own learner id — it can only ever return the
 * caller's own number.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Page size for the ledger read. Only speech-bearing days come back. */
const PAGE = 1000
/** Backstop so a pathological account can never spin here. */
const MAX_PAGES = 25

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (!learner) {
      res.status(200).json({ phrasesSpoken: 0, courses: 0 })
      return
    }

    let phrasesSpoken = 0
    const courses = new Set<string>()
    let truncated = false

    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('learner_speaking_opportunities')
        .select('course_code, phrases_spoken')
        .eq('learner_id', learner.id)
        .gt('phrases_spoken', 0)
        .range(page * PAGE, page * PAGE + PAGE - 1)

      if (error) {
        console.error('[me/phrases-spoken] ledger error:', error)
        // Fail soft — null means "unknown", so the client keeps showing
        // nothing rather than asserting a wrong number.
        res.status(200).json({ phrasesSpoken: null })
        return
      }

      for (const row of data || []) {
        phrasesSpoken += Number(row.phrases_spoken) || 0
        if (row.course_code) courses.add(row.course_code)
      }

      if (!data || data.length < PAGE) break
      // A full last page means there may be more; if we run out of pages,
      // say so rather than quietly reporting a short number.
      if (page === MAX_PAGES - 1) truncated = true
    }

    if (truncated) {
      console.warn(
        `[me/phrases-spoken] hit the ${MAX_PAGES}-page cap for learner ${learner.id} — count is a floor, not a total`
      )
    }

    res.status(200).json({ phrasesSpoken, courses: courses.size, ...(truncated ? { truncated: true } : {}) })
  } catch (error: any) {
    console.error('[me/phrases-spoken] Error:', error)
    res.status(200).json({ phrasesSpoken: null })
  }
}
