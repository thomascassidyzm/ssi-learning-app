/**
 * Current-user LEGOs-learnt API - GET /api/me/legos-learnt
 *
 * Auth required. Returns the count of DISTINCT LEGOs the learner has been
 * introduced to, summed ACROSS ALL of their courses — the number the Library
 * shows under "Phrases learnt".
 *
 * Why this exists (owner ruling, 2026-08-19): the tile previously showed
 * `completedSeeds`, which was the seed number parsed out of ONE course's
 * resume cursor (S0280L01 → 280) with the label "Words" under it. That is a
 * position readout, not a count of anything, and it ignored the other 57
 * courses a multi-course learner is enrolled in.
 *
 * The calculation, per enrolled course:
 *   cursor = course_enrollments.last_completed_lego_id  (e.g. "S0280L01")
 *   count  = course_legos WHERE course_code = <course>
 *              AND is_new = true
 *              AND (seed_number < 280 OR (seed_number = 280 AND lego_index <= 1))
 * then summed over every course with a cursor.
 *
 * `is_new = true` is what makes it DISTINCT. A LEGO can reappear in a later
 * seed as a non-introducing row (is_new = false); those are re-encounters of
 * something already taught, not new material. This is the same filter the
 * offline bundle uses to decide what the course actually introduces
 * (api/courses/[code]/bundle.ts).
 *
 * Scoped to the caller's own learner id — it can only ever return the
 * caller's own number.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** "S0280L01" → { seed: 280, index: 1 }. Anything else → null. */
export function parseLegoCursor(legoId: string | null | undefined): { seed: number; index: number } | null {
  if (!legoId) return null
  const match = /^S(\d{4})L(\d+)/.exec(legoId)
  if (!match) return null
  return { seed: parseInt(match[1], 10), index: parseInt(match[2], 10) }
}

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
      res.status(200).json({ legosLearnt: 0, courses: 0 })
      return
    }

    const { data: enrollments, error: enrErr } = await supabase
      .from('course_enrollments')
      .select('course_id, last_completed_lego_id')
      .eq('learner_id', learner.id)

    if (enrErr) {
      console.error('[me/legos-learnt] enrollments error:', enrErr)
      // Fail soft — null means "unknown", and the client hides the tile
      // rather than asserting a wrong number.
      res.status(200).json({ legosLearnt: null })
      return
    }

    const withCursor = (enrollments || [])
      .map((e: any) => ({ course: e.course_id as string, cursor: parseLegoCursor(e.last_completed_lego_id) }))
      .filter((e): e is { course: string; cursor: { seed: number; index: number } } => !!e.course && !!e.cursor)

    // One indexed head-count per course. Tom's account is the extreme case at
    // 53 cursored enrollments and returns in ~0.4s; a typical learner has 1-3.
    const counts = await Promise.all(
      withCursor.map(async ({ course, cursor }) => {
        const { count, error } = await supabase
          .from('course_legos')
          .select('lego_id', { count: 'exact', head: true })
          .eq('course_code', course)
          .eq('is_new', true)
          .or(
            `seed_number.lt.${cursor.seed},` +
              `and(seed_number.eq.${cursor.seed},lego_index.lte.${cursor.index})`
          )
        if (error) {
          console.warn(`[me/legos-learnt] count error for ${course}:`, error.message)
          return 0
        }
        return count ?? 0
      })
    )

    const legosLearnt = counts.reduce((sum, n) => sum + n, 0)
    res.status(200).json({ legosLearnt, courses: counts.filter((n) => n > 0).length })
  } catch (error: any) {
    console.error('[me/legos-learnt] Error:', error)
    res.status(200).json({ legosLearnt: null })
  }
}
