export interface ResumeAnchor {
  legoId: string | null
  viaCeiling: boolean
  /** True when the cursor's own LEGO is gone and we landed on its seed instead. */
  viaSeed?: boolean
}

/**
 * The seed a LEGO id belongs to. Ids are the zero-padded SNNNNLNN format, so
 * the seed is the leading SNNNN. Anything else returns null and the seed
 * fallback simply doesn't apply.
 */
export function seedOfLegoId(legoId: string | null): number | null {
  if (!legoId) return null
  const m = /^S(\d{4})L\d{2}/.exec(legoId)
  return m ? Number(m[1]) : null
}

/**
 * Resolve the LEGO id a resume should land on: the cursor
 * (last_completed_lego_id) is primary; the legacy ceiling
 * (highest_completed_lego_id) is a read-only fallback used ONLY when the
 * cursor is null or unresolvable against the round set (stale/schema-
 * drifted). Never write the ceiling back as a cursor value from a caller
 * of this function — that would reintroduce ratcheting. Neither resolving
 * means a genuinely fresh learner, who starts at round 1.
 *
 * SEED FALLBACK (Tom's ruling, 2026-08-31). Progress is stored by LEGO ID,
 * so it is unrelated to the content: "if the LEGO is still there, it will
 * find it. If the LEGO is NO LONGER there, it goes to the first LEGO in the
 * SEED that the previous LEGO was keyed to." That second half did not exist
 * — a cursor orphaned by a content change fell through the ceiling to round
 * 1, silently restarting the learner's course. It exists now, and it sits
 * BEFORE the ceiling: the seed the learner was actually in is a better
 * answer than a high-water mark from somewhere else entirely.
 *
 * `findFirstLegoOfSeed` is optional so existing callers keep compiling; a
 * caller that can't supply it gets exactly today's behaviour.
 */
export function resolveResumeAnchor(
  cursorLegoId: string | null,
  ceilingLegoId: string | null,
  findIndex: (legoId: string) => number,
  findFirstLegoOfSeed?: (seedNumber: number) => string | null,
): ResumeAnchor {
  if (cursorLegoId && findIndex(cursorLegoId) !== -1) {
    return { legoId: cursorLegoId, viaCeiling: false }
  }

  // The cursor names a LEGO the course no longer has. Land on the first LEGO
  // of the seed it was keyed to — the learner stays where they were working,
  // and re-meets the seed from its opening rather than losing the course.
  if (cursorLegoId && findFirstLegoOfSeed) {
    const seed = seedOfLegoId(cursorLegoId)
    if (seed !== null) {
      const seedAnchor = findFirstLegoOfSeed(seed)
      if (seedAnchor && findIndex(seedAnchor) !== -1) {
        return { legoId: seedAnchor, viaCeiling: false, viaSeed: true }
      }
    }
  }

  if (ceilingLegoId && findIndex(ceilingLegoId) !== -1) {
    return { legoId: ceilingLegoId, viaCeiling: true }
  }
  return { legoId: null, viaCeiling: false }
}
