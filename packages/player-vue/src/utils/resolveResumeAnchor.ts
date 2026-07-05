export interface ResumeAnchor {
  legoId: string | null
  viaCeiling: boolean
}

/**
 * Resolve the LEGO id a resume should land on: the cursor
 * (last_completed_lego_id) is primary; the legacy ceiling
 * (highest_completed_lego_id) is a read-only fallback used ONLY when the
 * cursor is null or unresolvable against the round set (stale/schema-
 * drifted). Never write the ceiling back as a cursor value from a caller
 * of this function — that would reintroduce ratcheting. Neither resolving
 * means a genuinely fresh learner, who starts at round 1.
 */
export function resolveResumeAnchor(
  cursorLegoId: string | null,
  ceilingLegoId: string | null,
  findIndex: (legoId: string) => number,
): ResumeAnchor {
  if (cursorLegoId && findIndex(cursorLegoId) !== -1) {
    return { legoId: cursorLegoId, viaCeiling: false }
  }
  if (ceilingLegoId && findIndex(ceilingLegoId) !== -1) {
    return { legoId: ceilingLegoId, viaCeiling: true }
  }
  return { legoId: null, viaCeiling: false }
}
