/**
 * The intro's AUTHORED word mapping, and the tiles it makes — PURE.
 *
 * Tom, 2026-08-13: the mapping is "the breakdown that feeds into the LEGO TILE
 * ASSEMBLER function", and its point is "to show the literal builds in the
 * known language that 'map' to the correct order in the target language".
 *
 * The model, unchanged from the Popty editor that produces it: the TARGET's own
 * words are fixed columns in the target's own order, and the known-language
 * gloss is cut into chunks that sit underneath them. A chunk may span several
 * target words; a chunk may be empty beside a wide neighbour. Nothing is ever
 * reordered to make the known side read naturally — Basque `hitz bat` reads
 * `word` `a`, and reading wrong is the point.
 *
 * WHY THIS EXISTS AT ALL. The assembler is keyed on COMPONENTISATION, and that
 * is not a bug: an M-LEGO with components tiles into them, an A-LEGO with none
 * shows one tile with the whole known sentence under it. What was missing is a
 * better SOURCE. So this is a re-sourcing, not a special case:
 *
 *   - authored mapping WHEREVER one exists — the primary feed;
 *   - componentisation everywhere else — unchanged, unbypassed, the fallback.
 *
 * (Tom: "work with the existing mechanism, not around it or in place of it.")
 */

export interface GlossSegment {
  /** How many consecutive TARGET-word columns this chunk sits under. */
  span: number
  /** The literal known-language text for those columns. May be empty. */
  known: string
}

/** Target words are the columns. Split on whitespace; nothing else is a word. */
export function targetWordsOf(targetText: string | null | undefined): string[] {
  return String(targetText ?? '').trim().split(/\s+/).filter(Boolean)
}

/**
 * Read a stored `known_gloss_segments` value, or `undefined` if it cannot be
 * trusted for this row.
 *
 * The coverage check is the load-bearing one. A mapping authored against an
 * earlier wording no longer describes this sentence, and rendering it anyway
 * would put the wrong English under the right target words — worse than no
 * gloss at all. A stale mapping is therefore dropped and the row falls back to
 * componentisation, which is exactly what it did before anyone authored it.
 */
export function authoredGlossSegments(lego: {
  target_text?: string | null
  known_gloss_segments?: unknown
}): GlossSegment[] | undefined {
  const stored = lego?.known_gloss_segments
  if (!Array.isArray(stored) || stored.length === 0) return undefined
  const wordCount = targetWordsOf(lego.target_text).length
  if (wordCount < 1) return undefined
  const out: GlossSegment[] = []
  let total = 0
  for (const seg of stored) {
    if (!seg || typeof seg !== 'object') return undefined
    const { span, known } = seg as { span?: unknown; known?: unknown }
    if (!Number.isInteger(span) || (span as number) < 1) return undefined
    if (typeof known !== 'string') return undefined
    total += span as number
    out.push({ span: span as number, known })
  }
  return total === wordCount ? out : undefined
}

/**
 * Cut a target sentence into assembler tiles along an authored mapping.
 *
 * One tile per TARGET WORD — the columns the author segmented against — with a
 * `glossGroup` id shared by every tile in a chunk, so LegoAssembly centres that
 * chunk's known text under the whole run. This is the same tile+glossGroup
 * shape the componentisation path already produces, which is why nothing in the
 * assembler has to change to render it.
 *
 * Returns null when the mapping does not fit the text being displayed — most
 * often a romanised course, where the roman word count can differ from the
 * native one the author segmented. Falling back beats mis-pairing.
 */
export function tilesFromGlossSegments<T extends Record<string, unknown>>(
  targetText: string | null | undefined,
  segments: GlossSegment[] | undefined,
  make: (args: { text: string; index: number; glossGroup: number; known: string }) => T,
): T[] | null {
  if (!segments || segments.length === 0) return null
  const words = targetWordsOf(targetText)
  if (words.length === 0) return null
  if (segments.reduce((n, s) => n + s.span, 0) !== words.length) return null

  const tiles: T[] = []
  let col = 0
  segments.forEach((seg, gi) => {
    for (let k = 0; k < seg.span; k++) {
      tiles.push(make({
        text: words[col],
        index: col,
        glossGroup: gi,
        // The gloss rides on the run's FIRST tile; LegoAssembly reads it from
        // there and centres it across the run.
        known: k === 0 ? seg.known : '',
      }))
      col++
    }
  })
  return tiles
}
