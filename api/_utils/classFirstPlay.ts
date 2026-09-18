/**
 * WHEN EACH CLASS FIRST PLAYED — the one fact the Class Insights cohort rule
 * turns on (Tom via Watson, 2026-09-16, job #989).
 *
 * The rule: the school average divides by every class on the course in the
 * compare-to subtree whose FIRST SESSION is on or before the end of the week
 * being drawn, the viewed class included. Two consequences, both deliberate:
 *
 *   · a class that has NEVER played is in no denominator anywhere. Averaging a
 *     school against classes that never started reads it as half as busy as it
 *     is — 67 of the 127 active classes on cym_s_for_eng have never played a
 *     single session (live count, 2026-09-16).
 *   · evaluating it PER WEEK is what stops history moving. A class that first
 *     plays in week 8 is ABSENT from weeks 1 to 7 rather than a zero in them,
 *     so a new class joining never rewrites the school's past bars.
 *
 * The denominator is therefore viewer-independent and only ever grows.
 *
 * `class_first_play(uuid[])` (migration 20260916a) does the reading: a
 * correlated min() per class over the diary and over class_sessions, an
 * index-only scan on idx_player_events_learner_time — 50ms for all 188 active
 * classes, against 10.7 SECONDS for the GROUP BY form.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Postgres arrays go in a POST body, so this is about planner sanity, not URL length. */
const RPC_CHUNK = 500

/**
 * A failed READ is not an absence of play (job #989 fix-up). Silently
 * returning null for a class whose first-play could not be read would drop it
 * from every denominator on the page and nobody would ever know — the average
 * would just be over fewer classes than it says. So the read is LOUD: the
 * error escapes as this, and the endpoint answers 500 with a plain reason
 * rather than a quietly-shrunken cohort.
 */
export class ClassFirstPlayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClassFirstPlayError'
  }
}

/**
 * class id → the ms of its first session, or null when it has never played.
 * Every requested id is present in the map. A NULL here means one thing only:
 * that class has never played. A failed read throws (see ClassFirstPlayError).
 */
export async function loadClassFirstPlay(
  svc: SupabaseClient,
  classIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  const ids = [...new Set(classIds.filter(Boolean))]
  for (const id of ids) out.set(id, null)
  if (ids.length === 0) return out

  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += RPC_CHUNK) batches.push(ids.slice(i, i + RPC_CHUNK))

  await Promise.all(batches.map(async (batch) => {
    const { data, error } = await svc.rpc('class_first_play', { p_class_ids: batch })
    if (error) {
      console.error('[classFirstPlay] rpc error:', error.message)
      throw new ClassFirstPlayError(error.message)
    }
    for (const r of (data ?? []) as { class_id: string; first_play: string | null }[]) {
      const t = r.first_play ? new Date(r.first_play).getTime() : NaN
      out.set(String(r.class_id), Number.isFinite(t) ? t : null)
    }
  }))
  return out
}
