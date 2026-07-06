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

/** "Seed 44 / Lego 3" display string for the furthest-point-reached readout. Null when there's nothing to show. */
export function formatFurthestPoint(legoId: string | null): string | null {
  const pos = parseLegoPosition(legoId)
  if (!pos) return null
  return `Seed ${pos.seed} / Lego ${pos.legoIndex}`
}

/**
 * Whether the recovery action would actually move the learner anywhere.
 * False when there's no ceiling, or the ceiling already matches the live
 * cursor (nothing to recover) — keeps the button from offering a no-op.
 */
export function canRecoverToFurthest(cursorLegoId: string | null, furthestLegoId: string | null): boolean {
  return !!furthestLegoId && furthestLegoId !== cursorLegoId
}
