/**
 * audioRevisions — server side of the in-place audio repair flow.
 *
 * THE PROBLEM
 * -----------
 * Repaired audio is swapped in place at the SAME `course_audio.id` — a new
 * id would CASCADE into `lego_introductions` and destroy authored intro
 * scripts. But `/api/audio/:id` is served `immutable, max-age=31536000` and
 * the service worker runs CacheFirst over it, so a device that already
 * played the damaged clip holds those bytes for a year.
 *
 * The fix is to make the URL carry the revision: `/api/audio/<id>?v=<rev>`.
 * `course_audio.audio_revision` (integer, DEFAULT 1) is bumped by 1 each
 * time a clip's bytes are replaced. So every route that hands audio ids to
 * the player must also hand out the revisions.
 *
 * WHY A SEPARATE LOOKUP RATHER THAN WIDENED SELECTS
 * ------------------------------------------------
 * The obvious move — widen each route's SELECT — doesn't actually work.
 * `cycles.ts` gets its audio ids from the `get_course_cycles_window` RPC,
 * not a SELECT at all; and the routes that do SELECT read the denormalised
 * `*_audio_id` columns on `course_legos` / `course_practice_phrases`, which
 * carry the id but not the revision. The revision lives on `course_audio`.
 * So every route needs a lookup against `course_audio` regardless of shape.
 *
 * WHY IT IS CHEAP ANYWAY
 * ----------------------
 * We only ever query clips that have actually been REPAIRED
 * (`audio_revision > 1`). Revision 1 is the implicit default for every clip
 * and produces a bare URL, so recording it would be pure payload weight.
 * Repairs are rare and remedial, so this query returns a handful of rows at
 * most — usually zero. It is then memoised per course in module scope for
 * TTL_MS, which on a warm lambda takes it off the critical path entirely.
 *
 * WIRE SHAPE
 * ----------
 * Routes attach ONE top-level field to their payload:
 *
 *     audioRevisions: { "<audio-uuid>": 2, ... }   // repaired clips only
 *
 * rather than a `*AudioRev` sibling for each of the ~8 audio id fields per
 * row. Same information, one field instead of eight per row, no per-row
 * assembly changes, and it stays a near-empty object in the normal case.
 * The client publishes it into the shared `@ssi/core` revision registry,
 * which every URL builder reads through.
 *
 * BACKWARD COMPATIBILITY
 * ----------------------
 * The field is additive and may be absent or empty. An id the client has no
 * revision for emits the bare `/api/audio/<id>` exactly as today — which is
 * correct, not a fallback: an unrepaired clip's bare URL is what every
 * existing cache already holds.
 *
 * FAILURE POSTURE
 * ---------------
 * A failed lookup is logged and returns an empty map rather than failing the
 * request. Losing revisions degrades to today's behaviour (repairs reach the
 * device on the next payload); failing the request would take playback down
 * for everyone to fix clipped audio for a few. Never trade the fast path for
 * the repair path.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** audio id -> revision, for repaired clips only (revision > 1). */
export type AudioRevisionMap = Record<string, number>

/** Memoise per course. Repairs are rare; playback requests are not. */
const TTL_MS = 60_000

const cache = new Map<string, { at: number; map: AudioRevisionMap }>()

/** Test seam — module scope survives between vitest cases otherwise. */
export function __clearAudioRevisionCache(): void {
  cache.clear()
}

/**
 * Every repaired clip for a course, as `{ id: revision }`.
 *
 * Returns `{}` when nothing has been repaired, when the query fails, and
 * when `audio_revision` doesn't exist yet (the column is landed separately
 * by the dashboard repo — until then this is a no-op and the app serves
 * bare URLs, i.e. exactly today's behaviour).
 *
 * `now` is injectable so tests can drive the TTL without faking timers.
 */
export async function getAudioRevisions(
  supabase: SupabaseClient,
  courseCode: string,
  now: number = Date.now()
): Promise<AudioRevisionMap> {
  const hit = cache.get(courseCode)
  if (hit && now - hit.at < TTL_MS) return hit.map

  try {
    const { data, error } = await supabase
      .from('course_audio')
      .select('id, audio_revision')
      .eq('course_code', courseCode)
      .gt('audio_revision', 1)

    if (error) {
      // Most likely cause during rollout: the column doesn't exist yet.
      // Log once per TTL rather than per request, and cache the empty map so
      // a missing column doesn't put a failing query on every playback call.
      console.warn(
        '[AudioRevisions] lookup failed for %s (serving bare URLs): %s',
        courseCode,
        error.message
      )
      cache.set(courseCode, { at: now, map: {} })
      return {}
    }

    const map: AudioRevisionMap = {}
    for (const row of (data || []) as Array<{ id: string; audio_revision: number | null }>) {
      const rev = row.audio_revision
      if (typeof rev === 'number' && Number.isFinite(rev) && rev > 1) map[row.id] = rev
    }
    cache.set(courseCode, { at: now, map })
    return map
  } catch (err) {
    console.warn('[AudioRevisions] unexpected error for %s:', courseCode, err)
    cache.set(courseCode, { at: now, map: {} })
    return {}
  }
}
