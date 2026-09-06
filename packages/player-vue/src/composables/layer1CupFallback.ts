/**
 * THE LAYER-1 CUP FALLBACK (Tom, 2026-09-06):
 *
 *   "cups play EITHER the SEED itself, or the longest phrase from the last
 *    LEGO in the SEED's BASKET of phrases"
 *
 * …superseded the same day, after reading the first version's numbers:
 *
 *   "we COULD be more sophisticated and find the phrase in the last LEGO's
 *    BASKET that contains the most LEGOS from the entire SEED?"
 *
 * and the frame that makes it the right ranking:
 *
 *   "the SEED itself is notionally the culminating practice phrase of a
 *    SEED's LEGO SET"
 *
 * So the candidate pool is unchanged — the last LEGO's basket — but the
 * winner is no longer the LONGEST phrase; it is the phrase that assembles the
 * MOST of the seed's own LEGO set. Duration was only ever a proxy for that
 * coverage, and a bad one: it picks a long phrase built from one LEGO over a
 * shorter one carrying four.
 *
 * Coverage is COUNTED as the number of DISTINCT LEGOs of the seed's own set
 * present in the phrase: the phrase's own LEGO plus its connected_lego_ids,
 * intersected with the seed's LEGO ids. Unweighted — the seed culminates a
 * SET, and set membership is binary; weighting by position, type or syllables
 * adds parameters with no evidence behind them. (A fraction of the seed's
 * LEGO count ranks identically within one seed — the denominator is constant
 * — so the plain count is the simpler equivalent.) connected_lego_ids holds
 * OTHER legos only (verified live 2026-09-06: 0 of 1,659 Welsh-North rows
 * include their own lego_id) and can point at legos of OTHER seeds, which is
 * why the intersection with the seed's own set is load-bearing.
 *
 * Coverage OUTRANKS role: Tom's instruction is "the most LEGOS from the
 * entire SEED", with no role qualifier, and his complaint about BUILD
 * fragments was that a fragment is a poor stand-in for the culmination —
 * coverage is that complaint made measurable, so a BUILD carrying three of
 * the seed's LEGOs beats a USE carrying one. At EQUAL coverage the first
 * version's ladder stands unchanged (USE over BUILD, then longest
 * target1_duration_ms, then text length, then text): with coverage tied, its
 * original reasons hold — USE rows are complete sentences, and duration is
 * the course's own top-of-the-practice-ladder measure.
 *
 * Courses without the coverage signal degrade honestly for free: an empty or
 * absent connected_lego_ids leaves every candidate covering exactly its own
 * LEGO, all candidates tie, and the old ladder decides — byte-identical to
 * the pre-coverage behaviour.
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
  /** OTHER lego ids appearing in this phrase (never the row's own — verified
   *  live 2026-09-06), possibly from other seeds. Optional so snapshots
   *  persisted before the coverage selector still type-check; absent ⇒ the
   *  phrase covers only its own LEGO. */
  connected_lego_ids?: string[] | null
}

/**
 * seedNum → the set of the seed's own lego ids, constructed deterministically
 * from the catalogue as `S{seed:04}L{index:02}` — the popty API's canonical
 * id format (verified live 2026-09-06 against course_legos.lego_id on both
 * Welsh dialects: 0 mismatches in 1,314 rows). Constructing rather than
 * fetching keeps the catalogue query and the offline snapshot's catalogue
 * shape unchanged.
 */
export function computeSeedLegoIdSets(
  catalogue: ReadonlyArray<{ seed_number: number; lego_index: number }>,
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>()
  for (const row of catalogue) {
    let set = out.get(row.seed_number)
    if (!set) {
      set = new Set()
      out.set(row.seed_number, set)
    }
    set.add(legoId(row.seed_number, row.lego_index))
  }
  return out
}

const legoId = (seedNumber: number, legoIndex: number): string =>
  `S${String(seedNumber).padStart(4, '0')}L${String(legoIndex).padStart(2, '0')}`

/** Distinct LEGOs of the seed's own set this phrase contains: its own LEGO
 *  plus connected_lego_ids, intersected with the seed's lego ids. */
function seedCoverage(
  row: L1FallbackPhraseRow,
  seedLegoIds: ReadonlyMap<number, ReadonlySet<string>>,
): number {
  const set = seedLegoIds.get(row.seed_number)
  if (!set) return 0
  const covered = new Set<string>()
  const own = legoId(row.seed_number, row.lego_index)
  if (set.has(own)) covered.add(own)
  for (const id of row.connected_lego_ids || []) {
    if (set.has(id)) covered.add(id)
  }
  return covered.size
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
 * and the winner is the phrase covering the MOST of the seed's own LEGO set
 * (see the header — the seed is the culminating phrase of its set, and the
 * best stand-in assembles the most of it). Candidate rules:
 *   • all three audio ids present (the basket reader's audio-completeness
 *     invariant — never compose a play whose clip might not resolve);
 *   • `component` rows excluded — literal tiling glosses, not sentences;
 *   • MOST distinct seed LEGOs covered first (own LEGO + connected_lego_ids
 *     ∩ the seed's set) — coverage outranks role;
 *   • at equal coverage: USE rows ('eternal_eligible'/'use') over BUILD
 *     ('practice'/'build') — USE phrases are complete natural sentences,
 *     BUILD phrases may be fragments;
 *   • then longest target1_duration_ms, null durations last (target_text
 *     length breaks the tie — and stands in entirely when every duration is
 *     null), then text for determinism.
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
  seedLegoIds: ReadonlyMap<number, ReadonlySet<string>>,
): Map<number, L1SeedAudio> {
  const best = new Map<number, { row: L1FallbackPhraseRow; isUse: boolean; coverage: number }>()
  const rank = (r: L1FallbackPhraseRow) =>
    [r.target1_duration_ms ?? -1, (r.target_text || '').length] as const
  for (const row of rows) {
    if (row.lego_index !== lastLegoIndex.get(row.seed_number)) continue
    if (row.phrase_role === 'component') continue
    if (!row.known_audio_id || !row.target1_audio_id || !row.target2_audio_id) continue
    const isUse = row.phrase_role === 'eternal_eligible' || row.phrase_role === 'use'
    const coverage = seedCoverage(row, seedLegoIds)
    const cur = best.get(row.seed_number)
    if (cur) {
      if (cur.coverage > coverage) continue
      if (cur.coverage === coverage) {
        if (cur.isUse && !isUse) continue
        if (cur.isUse === isUse) {
          const [curDur, curLen] = rank(cur.row)
          const [rowDur, rowLen] = rank(row)
          if (rowDur < curDur) continue
          if (rowDur === curDur && rowLen < curLen) continue
          if (rowDur === curDur && rowLen === curLen && row.target_text >= cur.row.target_text) continue
        }
      }
    }
    best.set(row.seed_number, { row, isUse, coverage })
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
  seedLegoIds: ReadonlyMap<number, ReadonlySet<string>>,
): L1FallbackPhraseRow[] {
  const winners = deriveSeedFallbackAudio(rows, lastLegoIndex, seedLegoIds)
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
