/**
 * usePairingsTelemetry — writes co-firing rows during play.
 *
 * Called from LearningPlayer.vue every time a cycle completes. We bump
 * fire_count for every unordered pair in the cycle's LEGO set: atoms +
 * any M-LEGO's component A-LEGOs (Agent C expands these before calling).
 *
 * IMPLEMENTATION CHOICE: single RPC call via supabase.rpc.
 *
 *   Supabase-JS .upsert() can express "insert or do-nothing" / "insert
 *   or replace", but not "insert or increment". Doing the increment
 *   client-side would require a SELECT-then-UPDATE round trip per row,
 *   which is O(N pairs * 2) round trips per cycle. With ~10 LEGOs per
 *   cycle that's 45 pairs = 90 round trips, every ~11 seconds.
 *
 *   Instead, the supporting migration ships a `record_lego_pairings`
 *   Postgres function that takes a 2D text array and does a single
 *   INSERT ... ON CONFLICT DO UPDATE for all pairs at once. One round
 *   trip per cycle. The function also canonicalises pair order
 *   (lego_a < lego_b) and dedupes within the call, so the client just
 *   passes the raw cycle's LEGO set.
 *
 * This composable is a thin wrapper around that RPC: dedupe lego ids,
 * build the unordered-pair array, call the function. No state — every
 * call is independent and fire-and-forget. Errors are logged but never
 * thrown back to the cycle loop (telemetry must NEVER block play).
 */

import { inject } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RecordCyclePlayOptions {
  learnerId: string
  courseCode: string
  /**
   * All LEGOs that fired in this cycle. M-LEGOs must be pre-expanded to
   * include their component A-LEGOs (the caller — LearningPlayer.vue
   * via Agent C — handles that expansion). Duplicates here are tolerated
   * and deduped before pairing.
   */
  legoIds: string[]
}

/**
 * Build the unordered-pair array from a deduped LEGO id list. Returns a
 * 2D string array suitable for the `record_lego_pairings` RPC. Order
 * within each pair doesn't matter — the function canonicalises server-side.
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

  // We need fewer than 2 unique LEGOs? No pairs to record.
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

  async function recordCyclePlay(opts: RecordCyclePlayOptions): Promise<void> {
    const supabase = supabaseRef?.value
    if (!supabase) {
      // No client yet (still wiring up) — silently skip; play continues.
      return
    }

    // Guard against guest/anonymous flows. The schema requires a real
    // learners.id (FK) — fake or guest ids would cause a constraint
    // violation, and we don't want telemetry to noisy-error in that case.
    if (!opts.learnerId || opts.learnerId.startsWith('guest-')) {
      return
    }

    const pairs = buildPairs(opts.legoIds)
    if (pairs.length === 0) return

    try {
      const { error } = await supabase.rpc('record_lego_pairings', {
        _learner_id: opts.learnerId,
        _course_code: opts.courseCode,
        _pairs: pairs,
      })
      if (error) {
        // Log but do not rethrow — telemetry never blocks play.
        console.warn('[usePairingsTelemetry] record_lego_pairings failed:', error.message)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[usePairingsTelemetry] unexpected error:', msg)
    }
  }

  return { recordCyclePlay }
}
