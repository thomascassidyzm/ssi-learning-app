/**
 * usePairingsTelemetry - accumulates LEGO co-firing during play, flushed in
 * batches on lifecycle boundaries (pause / background / unmount).
 *
 * Called from LearningPlayer.vue every time a cycle completes. We bump
 * fire_count for every unordered pair in the cycle's LEGO set: atoms +
 * any M-LEGO's component A-LEGOs (Agent C expands these before calling).
 *
 * BATCHING (2026-06): previously this fired one `record_lego_pairings` RPC
 * PER CYCLE (~150 RPCs / 30-min session, each an O(pairs) upsert). The
 * `learner_lego_pairings` table has no live reader - it's substrate for a
 * future brain-view / adaptive-selection feature - so per-cycle freshness is
 * irrelevant. We now tally co-fire counts locally (canonicalised pair -> count)
 * and `flush()` once per pause/background/session-end: ~150 RPCs -> ~1-3, with
 * the counts preserved (the RPC takes a parallel `_counts` array - see
 * 20260602_lego_pairings_batched_counts.sql). Same accumulate-and-flush shape
 * as useLearningSession's speaking_opportunities.
 */

import { inject, type Ref } from 'vue'
import { buildPairs } from './buildLegoPairs'
import { useUserRole } from '@/composables/useUserRole'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RecordCyclePlayOptions {
  learnerId: string
  courseCode: string
  /**
   * All LEGOs that fired in this cycle. M-LEGOs must be pre-expanded to
   * include their component A-LEGOs (the caller - LearningPlayer.vue
   * via Agent C - handles that expansion). Duplicates here are tolerated
   * and deduped before pairing.
   */
  legoIds: string[]
}

// The pairing rule itself lives in `buildLegoPairs.ts`, with no imports, so
// the job #59 history backfill can replay the EXACT function rather than a
// second copy of it. Re-exported here: every existing importer is unaffected.
export { buildPairs } from './buildLegoPairs'

/**
 * The class route (job #52). While playing AS A CLASS the tally belongs to the
 * class's own learner id, and `record_lego_pairings` can never write it: the
 * function is SECURITY INVOKER and `learner_lego_pairings` carries own-row RLS,
 * so the class insert is refused ("new row violates row-level security policy")
 * and was only ever console.warned — the table held one row for every class in
 * every school. Class mode flushes through the teacher-authorised
 * /api/school/class-progress endpoint instead, exactly like every other
 * class-entity write. Returns false outside class mode, so own accounts keep
 * using the RPC untouched.
 */
export interface PairingsClassRoute {
  recordLegoPairings?: (
    learnerId: string, courseId: string, pairs: string[][], counts: number[],
  ) => Promise<boolean>
}

export function usePairingsTelemetry(classRoute?: Ref<PairingsClassRoute | null | undefined>) {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  // Local co-fire tally, keyed by canonicalised pair (lego_a < lego_b). Value
  // is the number of cycles the pair fired together since the last flush.
  let pendingLearnerId: string | null = null
  let pendingCourseCode: string | null = null
  const tally = new Map<string, { a: string; b: string; count: number }>()

  /**
   * Accumulate one cycle's co-firings. Synchronous and fast - no network.
   * Safe to call from the cycle loop; never throws.
   */
  function recordCyclePlay(opts: RecordCyclePlayOptions): void {
    // eslint-disable-next-line no-console
    console.warn('[DEBUG-155] recordCyclePlay', JSON.stringify(opts))
    // Guard guest/anonymous flows - the schema requires a real learners.id FK.
    if (!opts.learnerId || opts.learnerId.startsWith('guest-')) return
    // Refused at creation too: a pair fired while viewing-as must not sit in
    // the tally waiting for a flush that happens after the admin has exited.
    if (useUserRole().isViewingAs.value) return
    const pairs = buildPairs(opts.legoIds)
    // eslint-disable-next-line no-console
    console.warn('[DEBUG-155] pairs', JSON.stringify(pairs), 'tallySizeBefore', tally.size)
    if (pairs.length === 0) return
    pendingLearnerId = opts.learnerId
    pendingCourseCode = opts.courseCode
    for (const [x, y] of pairs) {
      const a = x < y ? x : y
      const b = x < y ? y : x
      const key = `${a}|${b}`
      const existing = tally.get(key)
      if (existing) existing.count++
      else tally.set(key, { a, b, count: 1 })
    }
  }

  /**
   * Flush the accumulated tally in one RPC. Clears the tally BEFORE awaiting,
   * so cycles that fire during the in-flight call accumulate fresh for the
   * next flush. Fire-and-forget - telemetry must never block or break play.
   * Safe to call repeatedly; an empty tally no-ops.
   */
  async function flush(): Promise<void> {
    const supabase = supabaseRef?.value
    // eslint-disable-next-line no-console
    console.warn('[DEBUG-155] flush called', { hasSupabase: !!supabase, tallySize: tally.size, pendingLearnerId, pendingCourseCode, hasClassRoute: !!classRoute?.value, hasRecordLegoPairings: typeof classRoute?.value?.recordLegoPairings })
    if (!supabase || tally.size === 0 || !pendingLearnerId || !pendingCourseCode) return
    // View-as: record_lego_pairings is a WRITE that travels as an RPC, and the
    // view-as fetch guard lets every RPC through as "the read path". A tally
    // built while an ssi_admin is viewing-as is not a learner's tally — drop
    // it, never send it (job #615, alongside the cursor-queue fix).
    if (useUserRole().isViewingAs.value) { tally.clear(); return }
    const entries = [...tally.values()]
    const learnerId = pendingLearnerId
    const courseCode = pendingCourseCode
    tally.clear()
    const _pairs = entries.map(e => [e.a, e.b])
    const _counts = entries.map(e => e.count)
    try {
      const viaClass = classRoute?.value?.recordLegoPairings
      if (viaClass && (await viaClass(learnerId, courseCode, _pairs, _counts))) return
      const { error } = await supabase.rpc('record_lego_pairings', {
        _learner_id: learnerId,
        _course_code: courseCode,
        _pairs,
        _counts,
      })
      if (error) {
        console.warn('[usePairingsTelemetry] record_lego_pairings failed:', error.message)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[usePairingsTelemetry] unexpected error:', msg)
    }
  }

  return { recordCyclePlay, flush }
}
