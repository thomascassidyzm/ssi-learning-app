/**
 * Authored gloss segments — the intro's word mapping, shared by every server
 * path that ships one.
 *
 * Extracted from `api/courses/[code]/cycles.ts` on 2026-08-29 when the bundle
 * endpoint needed the same rule (bundle-cutover step 5b). One validator, two
 * callers: `/cycles` (the JIT path being retired) and `/bundle` (the
 * destination). A second copy would have been the exact drift the cutover
 * exists to end.
 */
/**
 * The intro's AUTHORED word mapping, ready for the tile assembler — PURE.
 *
 * Tom, 2026-08-13: the mapping is "the breakdown that feeds into the LEGO TILE
 * ASSEMBLER function... to show the literal builds in the known language that
 * 'map' to the correct order in the target language". Each chunk covers `span`
 * consecutive TARGET words and carries the literal known-language text that
 * sits under them. Target order is never touched — the known side reading wrong
 * when the orders differ is the whole point (`hitz bat` reads `word` `a`).
 *
 * Returned only when the segmentation still covers the target text exactly. A
 * mapping authored against an older wording no longer describes this sentence,
 * and rendering it would put the wrong English under the right Basque — so a
 * stale mapping is dropped and componentisation stays the fallback, which is
 * exactly what it did before anyone authored anything.
 *
 * Native vs roman: the spans are counted against the NATIVE target words, the
 * side the author segmented in Popty. Callers pairing this onto a romanised
 * tiling must check the word counts agree.
 */
export function authoredGlossSegments(
  lego: { type?: string | null; target_text: string | null; known_gloss_segments: unknown },
): Array<{ span: number; known: string }> | undefined {
  // An A-LEGO is one word in at least one language, so it cannot be split and
  // mapped (Tom, 2026-08-13) — it renders as a single unsplit tile, and that is
  // correct, not a gap. Popty no longer lets one be authored; this refuses any
  // that were authored before that rule landed, so no learner sees an A-LEGO
  // cut into pieces.
  if (lego?.type !== 'M') return undefined
  const stored = lego.known_gloss_segments
  if (!Array.isArray(stored) || stored.length === 0) return undefined
  const wordCount = String(lego.target_text ?? '').trim().split(/\s+/).filter(Boolean).length
  if (wordCount < 1) return undefined
  let total = 0
  const out: Array<{ span: number; known: string }> = []
  for (const seg of stored) {
    if (!seg || typeof seg !== 'object') return undefined
    const span = (seg as { span?: unknown }).span
    const known = (seg as { known?: unknown }).known
    if (!Number.isInteger(span) || (span as number) < 1) return undefined
    if (typeof known !== 'string') return undefined
    total += span as number
    out.push({ span: span as number, known })
  }
  return total === wordCount ? out : undefined
}

