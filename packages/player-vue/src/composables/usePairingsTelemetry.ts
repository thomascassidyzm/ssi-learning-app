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

import { inject } from 'vue'
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

/**
 * Build the unordered-pair array from a deduped LEGO id list. Returns a
 * 2D string array suitable for the `record_lego_pairings` RPC. Order
 * within each pair doesn't matter - the function canonicalises server-side.
 *
 * Exported for unit-test visibility.
 */
export function buildPairs(legoIds: string[]): string[][] {
  // Dedupe + filter empties. We rely on the RPC to dedupe further across
  // pairs that happen to canonicalise identically, but doing it here
  // first cuts payload size for the common case.
  const unique: string[] = []
  const seen = new Set<string>()
  for (const id of legoIds) {
    if (!id) continue
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }

  // Fewer than 2 unique LEGOs? No pairs to record.
  if (unique.length < 2) return []

  // Generate every unordered pair. The RPC will canonicalise (lego_a <
  // lego_b) and dedupe.
  const pairs: string[][] = []
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      pairs.push([unique[i], unique[j]])
    }
  }
  return pairs
}

export function usePairingsTelemetry() {
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
    // Guard guest/anonymous flows - the schema requires a real learners.id FK.
    if (!opts.learnerId || opts.learnerId.startsWith('guest-')) return
    const pairs = buildPairs(opts.legoIds)
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
    if (!supabase || tally.size === 0 || !pendingLearnerId || !pendingCourseCode) return
    const entries = [...tally.values()]
    const learnerId = pendingLearnerId
    const courseCode = pendingCourseCode
    tally.clear()
    const _pairs = entries.map(e => [e.a, e.b])
    const _counts = entries.map(e => e.count)
    try {
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
