/**
 * THE LAYER-1 CUP FALLBACK (Tom, 2026-09-06):
 *
 *   "cups play EITHER the SEED itself, or the longest phrase from the last
 *    LEGO in the SEED's BASKET of phrases"
 *
 * Pure derivation only — no Vue, no Supabase — shared by useLayer1Scheduler
 * (live composition) and listeningMetaCache (the offline snapshot persists the
 * derived winners so a downloaded course pours the same cups offline). Every
 * input is DERIVED from the catalogue and the phrase table at runtime; there
 * is deliberately no hand-maintained seed → phrase mapping anywhere.
 */

/** The audio a single seed exposes for its Layer-1 sandwich. */
export interface L1SeedAudio {
  seedNumber: number
  target1Id: string
  target2Id: string | null
  knownId: string | null
  targetText: string
  knownText: string
}

/** One course_practice_phrases row, as the cup fallback reads it. */
export interface L1FallbackPhraseRow {
  seed_number: number
  lego_index: number
  phrase_role: string | null
  known_text: string
  target_text: string
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
  target1_duration_ms: number | null
}

/**
 * seedNum → highest lego_index in the catalogue — "the last LEGO in the SEED's
 * basket" of the ruling. Derived from the same course_legos catalogue the
 * scheduler already loads for its ordinals.
 */
export function computeSeedLastLegoIndex(
  catalogue: ReadonlyArray<{ seed_number: number; lego_index: number }>,
): Map<number, number> {
  const out = new Map<number, number>()
  for (const row of catalogue) {
    const prev = out.get(row.seed_number)
    if (prev === undefined || row.lego_index > prev) out.set(row.seed_number, row.lego_index)
  }
  return out
}

/**
 * A seed's OWN sandwich audio, when it has any target clip at all. The seed
 * plays itself whenever it can: target1 preferred, and a seed holding only a
 * voice-2 take still plays THE SEED with that clip in every target slot
 * (mirror of buildSeedPlays' t2→t1 fallback — mid-changeover Welsh North has
 * 83 such seeds, verified live 2026-09-06). Null only when the seed has no
 * target audio in either voice — that is when the phrase fallback engages.
 */
export function seedOwnAudio(
  seed:
    | {
        seed_number: number
        known_text: string
        target_text: string
        target_text_roman: string | null
        known_audio_id: string | null
        target1_audio_id: string | null
        target2_audio_id: string | null
      }
    | undefined,
): L1SeedAudio | null {
  if (!seed) return null
  const t1 = seed.target1_audio_id || seed.target2_audio_id
  if (!t1) return null
  return {
    seedNumber: seed.seed_number,
    target1Id: t1,
    target2Id: seed.target2_audio_id,
    knownId: seed.known_audio_id,
    targetText: seed.target_text_roman || seed.target_text,
    knownText: seed.known_text,
  }
}

/**
 * Derive, per seed, the substitute sandwich audio — DERIVED, never
 * hand-mapped: the last LEGO is the highest lego_index in the catalogue, its
 * basket is the course_practice_phrases rows at that (seed_number, lego_index),
 * and "longest" is by target1_duration_ms — the course's own cognitive-load
 * measure (CourseDataProvider orders every basket by it). Candidate rules:
 *   • all three audio ids present (the basket reader's audio-completeness
 *     invariant — never compose a play whose clip might not resolve);
 *   • `component` rows excluded — literal tiling glosses, not sentences;
 *   • USE rows ('eternal_eligible'/'use') preferred over BUILD
 *     ('practice'/'build') — USE phrases are complete natural sentences,
 *     BUILD phrases may be fragments;
 *   • within the preferred role: longest target1_duration_ms first, null
 *     durations last (target_text length breaks the tie — and stands in
 *     entirely when every duration is null), then text for determinism.
 * A seed with no surviving candidate simply stays absent — its cup skips it
 * exactly as it did before the fallback existed.
 *
 * Idempotent over its own winners: deriving again from just the winning rows
 * returns the same map, which is what lets the offline snapshot persist only
 * one row per seed.
 */
export function deriveSeedFallbackAudio(
  rows: ReadonlyArray<L1FallbackPhraseRow>,
  lastLegoIndex: ReadonlyMap<number, number>,
): Map<number, L1SeedAudio> {
  const best = new Map<number, { row: L1FallbackPhraseRow; isUse: boolean }>()
  const rank = (r: L1FallbackPhraseRow) =>
    [r.target1_duration_ms ?? -1, (r.target_text || '').length] as const
  for (const row of rows) {
    if (row.lego_index !== lastLegoIndex.get(row.seed_number)) continue
    if (row.phrase_role === 'component') continue
    if (!row.known_audio_id || !row.target1_audio_id || !row.target2_audio_id) continue
    const isUse = row.phrase_role === 'eternal_eligible' || row.phrase_role === 'use'
    const cur = best.get(row.seed_number)
    if (cur) {
      if (cur.isUse && !isUse) continue
      if (cur.isUse === isUse) {
        const [curDur, curLen] = rank(cur.row)
        const [rowDur, rowLen] = rank(row)
        if (rowDur < curDur) continue
        if (rowDur === curDur && rowLen < curLen) continue
        if (rowDur === curDur && rowLen === curLen && row.target_text >= cur.row.target_text) continue
      }
    }
    best.set(row.seed_number, { row, isUse })
  }
  const out = new Map<number, L1SeedAudio>()
  for (const [seedNumber, { row }] of best) {
    out.set(seedNumber, {
      seedNumber,
      target1Id: row.target1_audio_id!,
      target2Id: row.target2_audio_id,
      knownId: row.known_audio_id,
      targetText: row.target_text,
      knownText: row.known_text,
    })
  }
  return out
}

/**
 * The winning row per seed — what the offline snapshot persists. Same
 * selection as deriveSeedFallbackAudio (it IS that selection), returned as
 * raw rows so the scheduler's derivation over the snapshot is byte-identical
 * to the live one.
 */
export function selectFallbackWinnerRows(
  rows: ReadonlyArray<L1FallbackPhraseRow>,
  lastLegoIndex: ReadonlyMap<number, number>,
): L1FallbackPhraseRow[] {
  const winners = deriveSeedFallbackAudio(rows, lastLegoIndex)
  const byKey = new Map<string, L1FallbackPhraseRow>()
  for (const row of rows) {
    const w = winners.get(row.seed_number)
    if (!w) continue
    if (
      row.lego_index === lastLegoIndex.get(row.seed_number) &&
      row.target1_audio_id === w.target1Id &&
      row.target2_audio_id === w.target2Id &&
      row.known_audio_id === w.knownId &&
      row.target_text === w.targetText
    ) {
      byKey.set(`${row.seed_number}`, row)
    }
  }
  return [...byKey.values()]
}
