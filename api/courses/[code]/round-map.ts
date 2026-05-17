/**
 * Round Map API — GET /api/courses/:code/round-map
 *
 * Instant-playback critical path. Returns the R -> LEGO map for a course
 * plus the courses.version stamp. Tiny payload, aggressively cacheable.
 *
 * The frontend keys its local cache off `version`. This URL itself is NOT
 * version-stamped — clients read `version` from the body and bust their own
 * cache when it changes. Edge cache (s-maxage) is long because content for
 * a given course is functionally immutable between version bumps; the
 * frontend will re-fetch when stale by treating its cache miss key as
 * (course_code + version).
 *
 * Source:
 *   - course_round_index (materialised view, refreshed by the dashboard
 *     pipeline on course_legos mutations)
 *   - courses.version (auto-bumped by trigger in 20260518_courses_version_stamp.sql)
 *
 * Response shape:
 *   {
 *     course_code: string,
 *     version: number,
 *     rounds: Array<{ r: number, legoId: string, seed: number }>
 *   }
 *
 * Errors:
 *   - 404: course_code not found in `courses`
 *   - 503: course exists but course_round_index has no rows for it — view
 *          needs REFRESH MATERIALIZED VIEW course_round_index. Distinct
 *          from 404 because the fix is operator action, not "wrong URL".
 *
 * See: ssi-dashboard-v7-clean/new_vision/INSTANT_PLAYBACK_SPEC.md (Critical
 * path section).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Mirror the env-var pattern from api/audio/[audioId].ts: VITE_ fallback,
// .trim() for trailing-newline tolerance on copy-pasted dashboard secrets.
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

// course_code is a learner-supplied path segment. Restrict to the format
// the dashboard actually emits (lower-snake with digits) — this is a cheap
// pre-filter that keeps malformed input out of the DB query.
const COURSE_CODE_RE = /^[a-z0-9_]+$/

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const code = req.query.code
  if (!code || typeof code !== 'string' || !COURSE_CODE_RE.test(code)) {
    res.status(400).json({ error: 'Invalid course code' })
    return
  }

  try {
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey ||
        (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
    )

    // 1. Fetch course version (and confirm course exists). Two columns only —
    //    we don't need any of the heavy JSON config blobs.
    const { data: courseRow, error: courseErr } = await supabase
      .from('courses')
      .select('course_code, version')
      .eq('course_code', code)
      .maybeSingle()

    if (courseErr) {
      console.error('[RoundMap] courses query error:', courseErr.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load course metadata' })
      return
    }
    if (!courseRow) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(404).json({ error: 'Course not found' })
      return
    }

    // 2. Fetch the round map from the materialised view. Order by round_index
    //    so the client doesn't need to sort. Project only what the response
    //    shape exposes.
    const { data: rows, error: roundsErr } = await supabase
      .from('course_round_index')
      .select('round_index, lego_id, seed_number')
      .eq('course_code', code)
      .order('round_index', { ascending: true })

    if (roundsErr) {
      console.error('[RoundMap] course_round_index query error:', roundsErr.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load round map' })
      return
    }

    if (!rows || rows.length === 0) {
      // Course exists in `courses` but no rows in the view — operator hasn't
      // refreshed it yet. Distinct from 404 so the frontend doesn't cache a
      // "this course doesn't exist" response that would survive the refresh.
      res.setHeader('Cache-Control', 'no-store')
      res.status(503).json({
        error: 'round map not yet materialised, run REFRESH MATERIALIZED VIEW course_round_index',
      })
      return
    }

    // Edge-cache aggressively. The URL is not version-stamped, so a refresh of
    // the materialised view + a courses.version bump will be picked up by the
    // frontend on its next round-trip — but stale-while-revalidate keeps the
    // critical path warm even during the refresh window.
    res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate=86400')
    res.status(200).json({
      course_code: code,
      version: (courseRow as { version: number }).version,
      rounds: rows.map((r: { round_index: number; lego_id: string; seed_number: number }) => ({
        r: r.round_index,
        legoId: r.lego_id,
        seed: r.seed_number,
      })),
    })
  } catch (error) {
    console.error('[RoundMap] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
