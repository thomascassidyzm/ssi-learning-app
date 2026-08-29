/**
 * phraseSelection — THE selection algorithm. One implementation, two callers.
 *
 * "Selection is pedagogy; bundling is plumbing" (Tom, 2026-08-29). The rules
 * for WHICH phrase fills a slot are a property of the method, not of whichever
 * pipeline happens to be assembling the round. Before this module they lived
 * twice: once in `player-vue/src/providers/generateLearningScript.ts` (the
 * walk, via `useAlgorithmConfig`'s cap/filter helpers) and once, differently,
 * in `@ssi/core`'s `generateScript.ts` (the bundle path, which ordered pools by
 * DB position). Two implementations of one pedagogy is a drift generator; this
 * file removes the second one rather than policing a parity test between them.
 *
 * Everything here is PURE and framework-agnostic — no Vue, no Supabase, no
 * fetch — so `@ssi/core`'s generator, `player-vue`'s walk, and (later, by a
 * separate decision) `/cycles` can all call exactly this code.
 *
 * The rules, in the order they apply to a LEGO's basket:
 *   1. ELIGIBILITY — a phrase without all three audio ids is not in the pool at
 *      all. It must not merely fail to render: it must never consume a slot.
 *   2. SHORTEST-FIRST by TARGET SYLLABLES (`capPhrasesByLength`) — stable, so
 *      equal-syllable phrases keep their DB position order.
 *   3. LENGTH CAP in CHARACTERS of target text, with the per-LEGO phrase-floor
 *      starvation guard (Easy only; Fast passes Infinity, which short-circuits
 *      to the plain historic sort).
 *   4. KNOWN-side pull filter on REVIEW and CONSOLIDATE slots
 *      (`filterReviewPool`, Easy only).
 *   5. REVIEW DRAW — a per-LEGO monotonic round-robin cursor over the sorted
 *      USE pool (`reviewCursorStart`), so a LEGO's reviews walk its basket
 *      exhaustively with no repeat before a full cycle.
 */

// ---------------------------------------------------------------------------
// SYLLABLES AND LENGTH
// ---------------------------------------------------------------------------

/**
 * Target-side syllable estimate — the SORT key. Moved verbatim from the walk's
 * in-function `countTargetSyllables` closure so both callers count identically;
 * `generateLearningScript.ts` now imports this rather than defining its own.
 *
 * Deliberately crude: CJK/Kana/Hangul characters count one apiece, everything
 * else falls back to Latin vowel clusters and floors at 1. It is a RANKING
 * device, not a linguistic claim — the canonical per-language counters in
 * `@ssi/core/text` are used for the KNOWN side, where a wrong count changes
 * which phrases a learner meets rather than only their order. Replacing this
 * with those counters would reorder every existing course's debut, so it is a
 * deliberate non-change.
 */
export function countTargetSyllables(targetText: string | null | undefined): number {
  if (!targetText) return 0
  const cjkRegex = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/g
  const cjkChars = targetText.match(cjkRegex)
  if (cjkChars && cjkChars.length > 0) return cjkChars.length
  const vowelClusters = targetText.toLowerCase().match(/[aeiouyáéíóúàèìòùâêîôûäëïöü]+/gi)
  return vowelClusters ? vowelClusters.length : 1
}

/**
 * How the CAP measures phrase length: CHARACTERS of target text.
 *
 * Not syllables, and this is measured rather than assumed. On real data
 * (ara_for_eng, 11,340 phrases): `target_syllable_count` is NULL for every row,
 * and `countTargetSyllables` above is a Latin vowel-cluster heuristic that
 * returns 1 for every Arabic phrase — it special-cases CJK but not Arabic. A
 * syllable-based ceiling therefore computed to 0.5 and the cap silently did
 * nothing. Character length is always present and works in every script.
 *
 * The shortest-first SORT still uses syllables, exactly as it always has. Only
 * the cap's measure is characters. Mirrors `phraseLengthOf` in Popty's
 * services/learning-modes.cjs.
 */
export function phraseTextLength(text: string | null | undefined): number {
  return (text || '').length
}

/**
 * The longest phrase in the COURSE — the "longest possible phrase" the cap
 * fraction is a fraction OF.
 *
 * Course-wide, deliberately, NOT per-LEGO. A per-LEGO pool max was implemented
 * first and is useless on real data: BUILD pools average 3.2 phrases
 * (ara_for_eng, 1,384 pools), so half-the-pool-max left under one eligible
 * phrase and the starvation guard fired on 100% of LEGOs — the cap never bit at
 * all. Mirrors `courseMaxPhraseLength` in Popty's learning-modes.cjs.
 */
export function courseMaxPhraseLength<T>(
  phraseLists: Iterable<readonly T[] | null | undefined>,
  lengthOf: (phrase: T) => number,
): number {
  let max = 0
  for (const list of phraseLists) {
    if (!list) continue
    for (const p of list) {
      const n = lengthOf(p)
      if (n > max) max = n
    }
  }
  return max
}

/**
 * The methodology's per-LEGO phrase floors (Tom, 2026-06-16: "more frames is
 * good, but FEWER PHRASES IS A FAIL"). Used as `minKeep` — the length cap
 * yields to phrase volume, never the reverse.
 */
export const MIN_BUILD_PHRASES_AFTER_CAP = 4
export const MIN_USE_PHRASES_AFTER_CAP = 5

/**
 * Sort a LEGO's candidate phrase pool shortest-first and cap it at an ABSOLUTE
 * length ceiling computed once per run from the whole course.
 *
 * THE single place the phrase-length cap lives (Aran, 2026-08-06: Easy halves
 * the longest possible phrase). The rules, in order:
 *   1. sort shortest-first by SYLLABLES — unchanged, historic, and what makes
 *      an uncapped run byte-identical to the pre-2026-08-06 behaviour. The sort
 *      is STABLE, so ties keep the caller's input order (DB position);
 *   2. drop phrases whose target text is longer than `limit` CHARACTERS;
 *   3. STARVATION GUARD — if that leaves fewer than `minKeep`, return the
 *      shortest `minKeep` instead. `minKeep` is the per-LEGO phrase floor
 *      (4 BUILD / 5 USE), deliberately NOT the round's ceiling: passing the
 *      ceiling makes the guard swallow the cap on every LEGO smaller than it,
 *      which is most of them;
 *   4. `limit` of Infinity (fraction 1.0 — Fast) short-circuits to the plain
 *      historic sort.
 */
export function capPhrasesByLength<T>(
  phrases: readonly T[],
  syllablesOf: (phrase: T) => number,
  lengthOf: (phrase: T) => number,
  limit: number,
  minKeep: number,
): T[] {
  const sorted = [...phrases].sort((a, b) => syllablesOf(a) - syllablesOf(b))

  if (!Number.isFinite(limit) || limit <= 0 || sorted.length === 0) return sorted

  const capped = sorted.filter((phrase) => lengthOf(phrase) <= limit)

  return capped.length >= Math.min(minKeep, sorted.length) ? capped : sorted.slice(0, minKeep)
}

// ---------------------------------------------------------------------------
// KNOWN-SIDE PULL FILTER (review + consolidate)
// ---------------------------------------------------------------------------

/**
 * The KNOWN-side pull filter for REVIEW and CONSOLIDATE slots (Tom,
 * 2026-08-07). THE one place this rule lives.
 *
 * Given a LEGO's basket of use phrases and the round being generated, return
 * the sub-basket the pull is allowed to draw from:
 *
 *   1. filter off, or past `maxRound` ⇒ the whole basket, untouched. Nothing is
 *      backlogged when it lifts and nothing cascades — the LEGO is what is
 *      being practised, so a phrase the learner has never met is fine;
 *   2. otherwise keep phrases of at most `limit` KNOWN-language syllables. A
 *      phrase whose known side cannot be counted (no counter for this course's
 *      known language) passes — that is the inert path, per phrase;
 *   3. SHORTEST-IN-BASKET FALLBACK — if that leaves nothing, return the single
 *      shortest phrase in the basket. A LEGO is never skipped and a review slot
 *      is never left empty because the basket happens to be long.
 */
export interface ReviewPullFilter<T> {
  /** Max known-language syllables, inclusive. Infinity ⇒ filter off. */
  limit: number
  /** Last round on which the filter applies. */
  maxRound: number
  /** Known-side syllables of a phrase, or null when uncountable. */
  syllablesOf: (phrase: T) => number | null
}

export function filterReviewPool<T>(
  pool: readonly T[],
  roundNumber: number,
  filter: ReviewPullFilter<T> | null | undefined,
): readonly T[] {
  if (!filter || !Number.isFinite(filter.limit) || filter.limit <= 0) return pool
  if (roundNumber > filter.maxRound) return pool
  if (pool.length === 0) return pool

  const kept = pool.filter((phrase) => {
    const n = filter.syllablesOf(phrase)
    if (typeof n !== 'number' || !Number.isFinite(n)) return true // uncountable ⇒ passes
    return n <= filter.limit
  })
  if (kept.length > 0) return kept

  let shortest = pool[0]
  let shortestN = Infinity
  for (const phrase of pool) {
    const n = filter.syllablesOf(phrase)
    const value = typeof n === 'number' && Number.isFinite(n) ? n : Infinity
    if (value < shortestN) { shortestN = value; shortest = phrase }
  }
  return [shortest]
}

// ---------------------------------------------------------------------------
// THE REVIEW URN
// ---------------------------------------------------------------------------

/**
 * Where a reviewed LEGO's round-robin cursor sits when it is pulled at
 * `offsetIndex` in the Fibonacci schedule.
 *
 * WHY A CLOSED FORM RATHER THAN A LIVE COUNTER. The walk keeps a per-LEGO
 * `useIndex` in an in-function Map, incremented on every attempted draw, and
 * gets away with it because it always regenerates the WHOLE course from round 1
 * in one invocation. The bundle path does not have that luxury: it pages by
 * (`fromLegoId`, `roundLimit`) and is re-entered per page and per INF-PLAY
 * expansion, so a Map scoped to one call would silently restart every LEGO's
 * urn at 0 partway through the course — strictly worse than what it replaces.
 * The cursor therefore has to be a FUNCTION OF POSITION, not of call history.
 *
 * It is exactly that. A LEGO is reviewed at Fibonacci offsets in ascending
 * order, so its draws are: `n1PhraseCount` at offsetIndex 0, then one at each
 * subsequent offsetIndex. The cursor after k reviews is therefore
 * `min(n1PhraseCount, poolLength) + (k - 1)` — the walk's `useIndex` written
 * without the counter. Callers take `pool[(cursor + i) % pool.length]` and
 * advance on EVERY attempted draw including ones a same-round dedup then
 * suppresses, exactly as the walk increments before its dedup check, so
 * rotation stays in step.
 *
 * The urn properties this guarantees, which are what Tom asked hold (specific
 * draws need not match, the properties must): the sequence of indices is
 * strictly +1 per draw modulo the pool length, so every phrase in the pool is
 * met before any is met twice, and the wraparound is exact.
 */
export function reviewCursorStart(
  offsetIndex: number,
  poolLength: number,
  n1PhraseCount: number,
): number {
  if (offsetIndex <= 0 || poolLength <= 0) return 0
  return Math.min(n1PhraseCount, poolLength) + (offsetIndex - 1)
}

// ---------------------------------------------------------------------------
// DEBUT SELECTION
// ---------------------------------------------------------------------------

/**
 * The pools a LEGO's round draws from, already ordered and capped. Produced by
 * `orderLegoPools`, consumed by `selectDebutPhrases` and by the review draw.
 */
export interface OrderedLegoPools<T> {
  /** BUILD basket, eligible-only, shortest-first, capped. */
  build: T[]
  /** USE basket, eligible-only, shortest-first, capped. */
  use: T[]
}

export interface OrderLegoPoolsOptions<T> {
  /**
   * Is this phrase playable at all? A phrase missing any of its three audio
   * ids is removed HERE, before ordering, so it never consumes a slot — the
   * walk drops it at fetch time and the bundle path used to let it burn one of
   * the seven BUILD slots and emit nothing.
   */
  eligible: (phrase: T) => boolean
  /** Target-side syllables — the sort key. */
  syllablesOf: (phrase: T) => number
  /** Target-side characters — the cap's measure. */
  lengthOf: (phrase: T) => number
  /** Absolute character ceiling; Infinity ⇒ plain historic sort (Fast). */
  limit: number
}

/** Eligible-only, shortest-first, capped — both baskets, one rule. */
export function orderLegoPools<T>(
  build: readonly T[],
  use: readonly T[],
  opts: OrderLegoPoolsOptions<T>,
): OrderedLegoPools<T> {
  const { eligible, syllablesOf, lengthOf, limit } = opts
  return {
    build: capPhrasesByLength(
      build.filter(eligible), syllablesOf, lengthOf, limit, MIN_BUILD_PHRASES_AFTER_CAP,
    ),
    use: capPhrasesByLength(
      use.filter(eligible), syllablesOf, lengthOf, limit, MIN_USE_PHRASES_AFTER_CAP,
    ),
  }
}

export interface DebutSelection<T> {
  /** Phrases for the round's BUILD slots, in emission order. */
  build: T[]
  /** Phrases for the round's CONSOLIDATE slots, in emission order. */
  consolidate: T[]
}

export interface SelectDebutOptions<T> {
  /** `script_shape.maxBuildPhrases` — 7. */
  maxBuildPhrases: number
  /** `script_shape.useConsolidationCount` — 2. */
  useConsolidationCount: number
  /**
   * Claim a phrase for this round. Returns false if the round has already
   * played it (or if it IS the bare LEGO). The caller owns the claim set
   * because spaced rep, which runs between the two phases, claims from it too.
   */
  claim: (phrase: T) => boolean
  /**
   * Is this phrase the bare LEGO? The consolidate second pass relaxes the
   * once-per-round rule but never this one — a round must not say the LEGO
   * twice in a row.
   */
  isBareLego: (phrase: T) => boolean
  /**
   * CONSOLIDATE's pool, when it differs from `pools.use` — the known-side pull
   * filter applies to consolidate slots but not to the debut BUILD/USE fill
   * (Tom, 2026-08-07, named REVIEW and CONSOLIDATE together). Defaults to
   * `pools.use`.
   */
  consolidatePool?: readonly T[]
}

/**
 * The debut round's phrase selection: BUILD slots first, then CONSOLIDATE.
 *
 * BUILD — walk the shortest-first BUILD basket and then the shortest-first USE
 * basket, taking the first `maxBuildPhrases` DISTINCT phrases the round has not
 * already claimed. "BUILD priority > CONSOLIDATE… filling 7 BUILD is
 * non-negotiable": a USE row promoted into a build slot is emitted as a BUILD
 * cycle. A phrase the round has already played is skipped BEFORE it consumes a
 * slot, so a duplicate row costs the round nothing.
 *
 * CONSOLIDATE — up to `useConsolidationCount` of this LEGO's own USE phrases,
 * last in the round. First pass takes phrases the round has not used; if that
 * leaves the round short, a second pass relaxes the once-per-round rule (but
 * never the bare-LEGO rule) rather than under-fill.
 *
 * SPACED REP runs BETWEEN these two phases and claims from the same set, which
 * is why the caller passes `claim` in rather than this owning it.
 */
export function selectDebutPhrases<T>(
  pools: OrderedLegoPools<T>,
  opts: SelectDebutOptions<T>,
): { build: T[]; selectConsolidate: () => T[] } {
  const build: T[] = []
  for (const phrase of [...pools.build, ...pools.use]) {
    if (build.length >= opts.maxBuildPhrases) break
    if (!opts.claim(phrase)) continue
    build.push(phrase)
  }

  const selectConsolidate = (): T[] => {
    const pool = opts.consolidatePool ?? pools.use
    const consolidate: T[] = []
    for (const phrase of pool) {
      if (consolidate.length >= opts.useConsolidationCount) break
      if (!opts.claim(phrase)) continue
      consolidate.push(phrase)
    }
    if (consolidate.length < opts.useConsolidationCount) {
      for (const phrase of pool) {
        if (consolidate.length >= opts.useConsolidationCount) break
        if (opts.isBareLego(phrase)) continue
        consolidate.push(phrase)
      }
    }
    return consolidate
  }

  return { build, selectConsolidate }
}

/**
 * One review draw's worth of phrases from a LEGO's USE basket.
 *
 * `take` consecutive entries starting at `reviewCursorStart(offsetIndex, …)`,
 * modulo the pool — the urn. Every attempted draw advances the cursor,
 * including one the caller's `claim` then suppresses, exactly as the walk
 * increments `useIndex` before its dedup check, so rotation stays in step. The
 * suppressed draw is returned as `null` so the caller can tell a skipped slot
 * from a filled one without re-deriving the cursor.
 */
export function drawReviewPhrases<T>(
  pool: readonly T[],
  offsetIndex: number,
  take: number,
  n1PhraseCount: number,
  claim: (phrase: T) => boolean,
): Array<T | null> {
  if (pool.length === 0 || take <= 0) return []
  let cursor = reviewCursorStart(offsetIndex, pool.length, n1PhraseCount)
  const drawn: Array<T | null> = []
  for (let i = 0; i < take; i++) {
    const phrase = pool[cursor % pool.length]
    cursor++
    drawn.push(claim(phrase) ? phrase : null)
  }
  return drawn
}
