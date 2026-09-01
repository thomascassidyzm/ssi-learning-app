/**
 * Does a loaded/cached script carry native-script text?
 *
 * On a romanised course (Chinese, Japanese, Korean, Arabic, Greek, Hindi,
 * Yiddish…) `generateLearningScript` emits the roman text as the item's
 * `targetText` and carries the native glyphs alongside; `toSimpleRounds` lands
 * those on `cycle.target.textNative` and `round.legoTargetTextNative`. Those
 * fields ride into the IndexedDB script cache untouched (setCachedScript JSON
 * round-trips the whole rounds blob), so the rounds in hand answer "does this
 * course have romanisation?" with no network call — which is the whole point:
 * offline, the DB probe that used to be the only answer cannot run, and the
 * player fell back to hiding the pronunciation-guide toggle and rendering
 * roman-only text (Tom, on a flight, 2026-09-01).
 *
 * Scans rounds in order and stops at the first native glyph it finds.
 */
export function roundsCarryNativeScript(rounds: unknown[]): boolean {
  for (const round of (rounds || []) as any[]) {
    if (round?.legoTargetTextNative) return true
    for (const cycle of (round?.cycles || []) as any[]) {
      if (cycle?.target?.textNative) return true
    }
  }
  return false
}
