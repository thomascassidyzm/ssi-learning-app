/**
 * Settings "recover to furthest point" — catastrophe-recovery path for the
 * cursor (last_completed_lego_id). Reuses the existing ratcheted ceiling
 * (course_enrollments.highest_completed_lego_id / highest_completed_round_index)
 * as "furthest achieved position": the trigger `ratchet_highest_completed_round`
 * lifts it whenever the cursor advances, so it is monotonic, server-persisted
 * per learner+course, and survives an uninstall + fresh login (unlike the
 * cursor, which local failure/reset can lose).
 *
 * "Highest incomplete LEGO" (Tom's phrasing) = this ceiling: the furthest
 * LEGO whose cycle the learner has completed (VOICE 2 played — the cursor's
 * completion gate), which is the closest granularity the server tracks to
 * "furthest played". There is no separate server-side "played but not
 * completed" signal at LEGO grain, so the ceiling is the correct — and only
 * sound — source for this feature.
 */

/** Parse "S0044L03" -> { seed: 44, legoIndex: 3 }. Null on any non-match. */
export function parseLegoPosition(legoId: string | null): { seed: number; legoIndex: number } | null {
  if (!legoId) return null
  const match = legoId.match(/^S(\d{4})L(\d+)$/)
  if (!match) return null
  return { seed: parseInt(match[1], 10), legoIndex: parseInt(match[2], 10) }
}

/**
 * Quoted known-language sentence for the furthest-point-reached readout
 * (e.g. `"I want to speak Ukrainian with my friends"`), or null when there's
 * no valid lego id, or `seedText` (best-effort — a lookup that may not have
 * resolved yet) isn't available. Position is never expressed as "Seed N" —
 * learners never see raw seed/lego coordinates, only the sentence they reached.
 */
export function formatFurthestPoint(legoId: string | null, seedText?: string | null): string | null {
  if (!parseLegoPosition(legoId)) return null
  return seedText ? `"${seedText}"` : null
}

/**
 * Whether the recovery action would actually move the learner anywhere.
 * False when there's no ceiling, or the ceiling already matches the live
 * cursor (nothing to recover) — keeps the button from offering a no-op.
 */
export function canRecoverToFurthest(cursorLegoId: string | null, furthestLegoId: string | null): boolean {
  return !!furthestLegoId && furthestLegoId !== cursorLegoId
}
