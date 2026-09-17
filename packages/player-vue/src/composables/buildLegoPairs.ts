/**
 * The co-firing pairing rule, alone in a file with no imports.
 *
 * It lived inside `usePairingsTelemetry.ts` until job #59 needed to REPLAY it
 * over the class audio_play history — and a backfill that reimplements the
 * rule is a second rule, free to drift from the live one. This file is the
 * one rule: `usePairingsTelemetry` re-exports it, and the backfill script
 * imports it directly (no vue, no injection, nothing to stub). Behaviour is
 * unchanged, byte for byte.
 */

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

/**
 * The fired LEGO set for one completed cycle: the cycle's own LEGO first, then
 * the component A-LEGOs of an M-LEGO, minus any component that IS the cycle's
 * LEGO. Empties are dropped.
 *
 * Also lifted out of LearningPlayer.vue by job #59, for the same reason as
 * buildPairs: the history backfill has to expand exactly what the live path
 * expands, and two copies of a five-line rule are two rules.
 */
export function expandFiredLegoIds(legoId: string, componentLegoIds?: string[] | null): string[] {
  const fired: string[] = []
  if (legoId) fired.push(legoId)
  if (Array.isArray(componentLegoIds)) {
    for (const id of componentLegoIds) {
      if (id && id !== legoId) fired.push(id)
    }
  }
  return fired
}
