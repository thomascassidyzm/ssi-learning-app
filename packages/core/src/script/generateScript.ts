/**
 * generateScript — unified main-loop + INF PLAY generator.
 *
 * Lives in `@ssi/core` (moved from `player-vue/src/script/` in the
 * bundle-cutover Phase 1 promotion, archive/docs-retired-2026-08-24/bundle-cutover-design.md §3/§5
 * step 1) so both the client and a future server script-view (§3) call the
 * SAME function — `packages/player-vue/src/script/generateScript.ts`
 * re-exports from here so no import churn rides the move.
 *
 * Pure function (modulo `random` injection): consumes a `CourseBundle`
 * already in memory and emits `Round[]` (see `./playerTypes`) ready for
 * `simplePlayer.initialize` / `simplePlayer.appendRounds`. Replaces the
 * three JIT pipelines (/cycles, /infplay-cycles, plus their adapters).
 *
 * No I/O. No Supabase. No fetch. No framework import (the "engine rule" —
 * `@ssi/core` stays framework-agnostic; pause-model config is injected via
 * `opts.pauseConfig` rather than imported from `player-vue`'s
 * `useAlgorithmConfig`). Deterministic given the same `random` callback —
 * same seed in, same script out.
 *
 * Per-cycle audio URLs are constructed via the injectable `audioUrl`
 * builder (defaults to `/api/audio/<id>`). The `AudioCache` transparently
 * intercepts these via its blob-URL handoff when the file is locally
 * cached.
 *
 * Algorithms ported from:
 *   - api/courses/[code]/cycles.ts          (main-loop per-LEGO sequence)
 *   - api/courses/[code]/infplay-cycles.ts  (INF PLAY assembly)
 *   - providers/backendCyclesToRounds.ts    (cycle audio-completeness + pause math)
 *
 * The SEED-PHASE tier (offsets ≥144, the whole parent sentence) was DELETED
 * from both paths on 2026-09-18 — see `REVIEW_OFFSET_CEILING`.
 */

import type { Cycle, Round } from './playerTypes'
import {
  legosById,
  phrasesByLegoAndRole,
  type BundleAudioRef,
  type BundleLego,
  type BundlePhrase,
  type CourseBundle,
} from './courseBundle'
import { computePauseDuration, DEFAULT_PAUSE_CONFIG, type PauseModeConfig } from './computePauseDuration'
import {
  countTargetSyllables,
  drawReviewPhrases,
  orderLegoPools,
  phraseTextLength,
  selectDebutPhrases,
  type OrderedLegoPools,
} from './phraseSelection'
import type {
  GenerateScriptOptions,
  GenerateScriptResult,
  MainPosition,
  InfPlayPosition,
} from './scriptGenerator.types'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Identifies the assembly algorithm's CODE (as opposed to `scriptShapeVersion`,
 * which identifies the algorithm's PARAMETERS) — one component of the script
 * artifact identity (archive/docs-retired-2026-08-24/bundle-cutover-design.md §2). Bump when the
 * assembly logic changes (e.g. a new cycle-ordering rule), not when a shape
 * parameter changes.
 */
export const GENERATOR_VERSION = 2

const DEFAULT_ROUND_LIMIT = 15

/**
 * Fibonacci offsets for spaced rep, identical to the server's main-loop
 * + INF PLAY schedule and to `generateLearningScript.ts`'s
 * `DEFAULT_SCRIPT_SHAPE.spacedRepOffsets`. The N-1 offset gets THREE
 * different USE phrases (per `n1PhraseCount`); all other offsets get ONE.
 * The tail stops at 89 — see `REVIEW_OFFSET_CEILING`.
 */
const DEFAULT_SPACED_REP_OFFSETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

/**
 * SPACED REP STOPS BELOW THIS OFFSET — 89 is the last review a LEGO ever
 * gets, on every path (Tom, 2026-09-18: "Delete the additional SEED once
 * it's dropped out of the Spaced Rep. Because the cups handle it.").
 *
 * Offsets ≥ 144 used to carry the SEED-PHASE tier: the walk served the
 * parent seed sentence as a four-slot listening sandwich, this generator
 * served it as an ordinary three-clip production exercise, and the two were
 * a live A/B nobody chose. A seed that has drained out of spaced repetition
 * is no longer re-served as production at all; the cups listening interlude
 * (`useLayer1Scheduler`, runtime, identical on both paths) is its only
 * channel. Applied as a CODE ceiling rather than by shortening the default
 * array, because the live `algorithm_config.script_shape` row still carries
 * the long Fibonacci tail — `reviewOffsets()` is the one filter both
 * generators run their configured offsets through.
 */
export const REVIEW_OFFSET_CEILING = 144

/** The configured offsets a review may actually fire at. */
export const reviewOffsets = (offsets: number[]): number[] =>
  offsets.filter((o) => o < REVIEW_OFFSET_CEILING)

/**
 * Fallback round shape — used only when neither `opts.shape` nor
 * `bundle.scriptShape` is present (old cached bundles). Numerically identical
 * to `generateLearningScript.ts`'s `DEFAULT_SCRIPT_SHAPE` and to cycles.ts's
 * module constants; the live values come from `algorithm_config.script_shape`
 * via the bundle, which is the whole point of shape injection (design §3
 * parity item 1).
 */
export const DEFAULT_SCRIPT_SHAPE: ResolvedScriptShape = {
  spacedRepOffsets: DEFAULT_SPACED_REP_OFFSETS,
  maxBuildPhrases: 7,
  useConsolidationCount: 2,
  maxSpacedRepPhrases: 12,
  n1PhraseCount: 3,
}

interface ResolvedScriptShape {
  spacedRepOffsets: number[]
  maxBuildPhrases: number
  useConsolidationCount: number
  maxSpacedRepPhrases: number
  n1PhraseCount: number
}

function resolveShape(bundle: CourseBundle, override?: Partial<ResolvedScriptShape>): ResolvedScriptShape {
  const fromBundle = (bundle as { scriptShape?: Partial<ResolvedScriptShape> }).scriptShape
  const merged = {
    ...DEFAULT_SCRIPT_SHAPE,
    ...(fromBundle ?? {}),
    ...(override ?? {}),
  }
  // THE ONE PLACE the configured offsets are capped (Tom, 2026-09-18) — a
  // baked bundle or an admin row carrying the long Fibonacci tail still
  // stops at 89, so a drained seed is never re-served as production.
  return { ...merged, spacedRepOffsets: reviewOffsets(merged.spacedRepOffsets) }
}

/**
 * Within-round identity of a phrase — character-for-character the same notion
 * as `cycles.ts`'s `phraseKey`/`normalizeForKey` and the walk's `getPhraseId`,
 * so all three builders claim and skip exactly the same rows.
 */
function normalizeForKey(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .trim()
    .replace(
      /[.,!?;:\u00a1\u00bf'"\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g,
      '',
    )
}

function phraseKey(knownText: string | null | undefined, targetText: string | null | undefined): string {
  return `${normalizeForKey(knownText)}|${normalizeForKey(targetText)}`
}

/**
 * A phrase is in the pool only if all three of its clips exist. Same rule the
 * cycle builders apply, hoisted to SELECTION time so an unplayable row can
 * never consume one of the seven BUILD slots and then emit nothing — which is
 * what it used to do here, and what the walk has never done (it drops such rows
 * as it reads them).
 */
function phraseIsPlayable(p: BundlePhrase): boolean {
  return !!(p.audio.known && p.audio.target1 && p.audio.target2)
}

/**
 * The SORT KEY, matching the walk's
 * `target_syllable_count || countTargetSyllables(target_text)` exactly.
 *
 * Note `targetTextNative ?? targetText`: on a romanised course the bundle's
 * `targetText` is the ROMAN form and the native script lives in
 * `targetTextNative`, whereas the walk counts `target_text` — the native one.
 * Counting the roman form instead would reorder every debut on jpn/zho/tha/hin.
 */
function phraseSyllables(p: BundlePhrase): number {
  return p.targetSyllableCount || countTargetSyllables(p.targetTextNative ?? p.targetText)
}

function phraseLength(p: BundlePhrase): number {
  return phraseTextLength(p.targetTextNative ?? p.targetText)
}

/**
 * A LEGO's baskets, eligible-only and shortest-first, via the SHARED selector,
 * MEMOISED for the life of one `generateScript` call.
 *
 * The memo is not an optimisation detail, it is load-bearing. Ordering is
 * needed once per LEGO for its debut and again on every one of that LEGO's
 * later review draws — up to twelve per round across the whole course — so
 * without the cache the same basket is filtered, syllable-counted and sorted
 * hundreds of times. Measured on the full `spa_for_eng` bundle (1,339 LEGOs,
 * 15,205 phrases, whole-course build): 388 ms uncached against 52 ms before
 * the shared selector, 55 ms with the cache. That difference lands directly in
 * the main-thread block that holds the play button.
 *
 * `limit: Infinity` is deliberate and is the whole of the mode story here: the
 * length cap, the known-side pull filter and the sliding word cap are EASY
 * levers, and mode-neutrality is a property of this path (Tom, 2026-08-09 —
 * "the instructions for WHICH cycles get selected/played and HOW MANY TIMES
 * belongs in the player logic, not the cached script data"). Fast, which is
 * what every caller of this generator asks for, passes exactly this. The
 * shared selector carries the levers so that a future mode-aware caller turns
 * them on by passing a finite limit, not by forking the algorithm.
 */
function makePoolOrderer(
  phraseIndex: Map<string, { build: BundlePhrase[]; use: BundlePhrase[] }>,
): (legoId: string) => OrderedLegoPools<BundlePhrase> {
  const memo = new Map<string, OrderedLegoPools<BundlePhrase>>()
  return (legoId: string) => {
    const hit = memo.get(legoId)
    if (hit) return hit
    const phrases = phraseIndex.get(legoId)
    const ordered = orderLegoPools(phrases?.build ?? [], phrases?.use ?? [], {
      eligible: phraseIsPlayable,
      syllablesOf: phraseSyllables,
      lengthOf: phraseLength,
      limit: Infinity,
    })
    memo.set(legoId, ordered)
    return ordered
  }
}

const INTRO_LINGER_MS = 2000

// INF PLAY round-shape — keep ~22 cycles regardless of how much spaced
// rep has drained, so encouragements / listening / pods slot in cleanly.
const TARGET_CYCLES_PER_ROUND = 22
const MIN_RANDOM_USE_PER_ROUND = 6
const MAX_RANDOM_USE_PER_ROUND = TARGET_CYCLES_PER_ROUND

// ============================================================================
// PUBLIC ENTRY
// ============================================================================

export function generateScript(opts: GenerateScriptOptions): GenerateScriptResult {
  const roundLimit = opts.roundLimit ?? DEFAULT_ROUND_LIMIT
  const audioUrl = opts.audioUrl ?? defaultAudioUrl
  const random = opts.random ?? Math.random
  const pauseConfig = opts.pauseConfig ?? DEFAULT_PAUSE_CONFIG

  const shape = resolveShape(opts.bundle, opts.shape)

  if (opts.position.mode === 'main') {
    // NOTE: main-loop generation is fully deterministic — reviews use the
    // closed-form round-robin cursor, not a draw — so `random` is INF-PLAY-only.
    return generateMain(opts.bundle, opts.position, roundLimit, audioUrl, pauseConfig, shape)
  }
  return generateInfPlay(opts.bundle, opts.position, roundLimit, audioUrl, random, pauseConfig, shape)
}

// ============================================================================
// MAIN-LOOP GENERATION
// ============================================================================

function generateMain(
  bundle: CourseBundle,
  position: MainPosition,
  roundLimit: number,
  audioUrl: (id: string) => string,
  pauseConfig: PauseModeConfig,
  shape: ResolvedScriptShape,
): GenerateScriptResult {
  const roundMap = bundle.roundMap
  const startIdx = roundMap.findIndex((e) => e.legoId === position.fromLegoId)
  if (startIdx < 0) {
    throw new Error(`legoId not in round map: ${position.fromLegoId}`)
  }

  const legoIndex = legosById(bundle)
  const phraseIndex = phrasesByLegoAndRole(bundle)
  const orderedPoolsFor = makePoolOrderer(phraseIndex)

  const rounds: Round[] = []
  let lastEmittedIdx = startIdx - 1

  for (let i = 0; i < roundLimit; i++) {
    const mapIdx = startIdx + i
    if (mapIdx >= roundMap.length) break
    const entry = roundMap[mapIdx]
    const lego = legoIndex.get(entry.legoId)
    // Schema drift: round-map references a LEGO we don't have. Skip
    // silently — same policy as the cycles endpoint.
    if (!lego) {
      lastEmittedIdx = mapIdx
      continue
    }
    const cycles: Cycle[] = []

    // --- intro / debut ---
    const introCycle = buildIntroCycle(lego, audioUrl)
    if (introCycle) cycles.push(introCycle)
    const debutCycle = buildDebutCycle(lego, audioUrl, pauseConfig)
    if (debutCycle) cycles.push(debutCycle)

    // The debut IS the bare LEGO — claim it so no later phase replays it, and
    // claim each phrase as it is emitted so a duplicated row cannot play
    // twice in one round. Same guard, same key, as `cycles.ts`'s `claimed`
    // set and the walk's `usedPhrasesThisRound`; without it a course whose
    // build basket contains its own LEGO text (fra S0009L01 'I speak / je
    // parle') says the LEGO twice in a row.
    const claimed = new Set<string>([phraseKey(lego.knownText, lego.targetText)])
    const claim = (p: BundlePhrase): boolean => {
      const key = phraseKey(p.knownText, p.targetText)
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    }

    // --- BUILD ×≤maxBuildPhrases, USE rows filling any leftover slots ---
    // The SHARED selector decides which phrases those are (see
    // `phraseSelection.ts`) — shortest-first by target syllables, eligible-only,
    // BUILD basket before USE. This used to order by DB position, which is the
    // single rule by which this generator's debut differed from the walk's.
    const pools = orderedPoolsFor(entry.legoId)
    const debut = selectDebutPhrases(pools, {
      maxBuildPhrases: shape.maxBuildPhrases,
      useConsolidationCount: shape.useConsolidationCount,
      claim,
      isBareLego: (p) => phraseKey(p.knownText, p.targetText) === phraseKey(lego.knownText, lego.targetText),
    })
    let buildOrdinal = 0
    for (const phrase of debut.build) {
      buildOrdinal++
      const cyc = buildPhraseCycle(phrase, lego, 'build', buildOrdinal, audioUrl, pauseConfig)
      if (cyc) cycles.push(cyc)
    }

    // --- spaced rep against this round's index in the round-map ---
    const spacedRepCycles = buildSpacedRepCycles(
      entry.roundIndex,
      bundle,
      legoIndex,
      orderedPoolsFor,
      audioUrl,
      pauseConfig,
      shape,
      entry.legoId,
      claim,
    )
    cycles.push(...spacedRepCycles)

    // --- CONSOLIDATE ×≤useConsolidationCount — this LEGO's own USE phrases,
    // last in the round. Deferred until here (rather than chosen with the
    // BUILD slots) because spaced rep runs in between and claims from the same
    // set; the shared selector's two-pass rule is unchanged. ---
    let useOrdinal = 0
    for (const phrase of debut.selectConsolidate()) {
      useOrdinal++
      const cyc = buildPhraseCycle(phrase, lego, 'use', useOrdinal, audioUrl, pauseConfig)
      if (cyc) cycles.push(cyc)
    }

    if (cycles.length === 0) {
      lastEmittedIdx = mapIdx
      continue
    }

    rounds.push({
      roundNumber: entry.roundIndex,
      legoId: entry.legoId,
      seedId: lego.seedId,
      legoTargetText: lego.targetText,
      ...(lego.targetTextNative ? { legoTargetTextNative: lego.targetTextNative } : {}),
      legoKnownText: lego.knownText,
      revival: false,
      cycles,
    })
    lastEmittedIdx = mapIdx
  }

  const nextIdx = lastEmittedIdx + 1
  const nextLegoId = nextIdx < roundMap.length ? roundMap[nextIdx].legoId : null

  return {
    rounds,
    next: { mode: 'main', legoId: nextLegoId },
  }
}

/**
 * Build spaced-rep cycles for one main-loop round. Walks `SPACED_REP_OFFSETS`
 * back from the current round-map index, dedup'd by LEGO. Each entry pulls
 * 3 (N-1) or 1 (others) USE phrases from that LEGO. The offsets are already
 * capped below `REVIEW_OFFSET_CEILING` by `resolveShape`, so 89 is the last
 * review a LEGO gets and nothing is emitted for a drained seed.
 */
function buildSpacedRepCycles(
  currentRoundIndex: number,
  bundle: CourseBundle,
  legoIndex: Map<string, BundleLego>,
  orderedPoolsFor: (legoId: string) => OrderedLegoPools<BundlePhrase>,
  audioUrl: (id: string) => string,
  pauseConfig: PauseModeConfig,
  shape: ResolvedScriptShape,
  currentLegoId: string,
  claim: (p: BundlePhrase) => boolean,
): Cycle[] {
  const cycles: Cycle[] = []
  const seenLegos = new Set<string>()
  let repCount = 0

  for (let offsetIndex = 0; offsetIndex < shape.spacedRepOffsets.length; offsetIndex++) {
    if (repCount >= shape.maxSpacedRepPhrases) break
    const offset = shape.spacedRepOffsets[offsetIndex]
    const reviewRoundIndex = currentRoundIndex - offset
    if (reviewRoundIndex < 1) break
    const mapEntry = bundle.roundMap[reviewRoundIndex - 1]
    if (!mapEntry) continue
    if (mapEntry.legoId === currentLegoId) continue
    if (seenLegos.has(mapEntry.legoId)) continue
    seenLegos.add(mapEntry.legoId)

    const lego = legoIndex.get(mapEntry.legoId)
    if (!lego) continue

    const pool = orderedPoolsFor(mapEntry.legoId).use
    if (pool.length === 0) continue

    // The SHARED urn (see `drawReviewPhrases`): a per-LEGO monotonic
    // round-robin over the same shortest-first USE pool the debut drew from, so
    // a LEGO's reviews walk its basket exhaustively with no repeat before a
    // full cycle. Deterministic — main-loop reviews need no RNG at all, which
    // is what makes an artifact id replayable.
    const want = offsetIndex === 0 ? shape.n1PhraseCount : 1
    const take = Math.min(want, shape.maxSpacedRepPhrases - repCount, pool.length)
    for (const phrase of drawReviewPhrases(pool, offsetIndex, take, shape.n1PhraseCount, claim)) {
      if (!phrase) continue // claimed by an earlier slot this round; the cursor still advanced
      repCount++
      const cyc = buildPhraseCycle(phrase, lego, 'review', repCount, audioUrl, pauseConfig)
      if (cyc) cycles.push(cyc)
    }
  }

  return cycles
}

// ============================================================================
// INF PLAY GENERATION
// ============================================================================

function generateInfPlay(
  bundle: CourseBundle,
  position: InfPlayPosition,
  roundLimit: number,
  audioUrl: (id: string) => string,
  random: () => number,
  pauseConfig: PauseModeConfig,
  shape: ResolvedScriptShape,
): GenerateScriptResult {
  const mainLoopCount = bundle.mainLoopCount
  const roundMap = bundle.roundMap
  const legoIndex = legosById(bundle)
  const orderedPoolsFor = makePoolOrderer(phrasesByLegoAndRole(bundle))

  const rounds: Round[] = []

  for (let r = 0; r < roundLimit; r++) {
    const infRound = position.fromInfRound + r
    const absoluteRound = mainLoopCount + infRound
    const usedLegosThisRound = new Set<string>()

    // --- phase 1: spaced rep ---
    type SpacedRepEntry = { lego: BundleLego; offset: number; offsetIndex: number; phraseCount: number }
    const spacedRepEntries: SpacedRepEntry[] = []

    for (let offsetIndex = 0; offsetIndex < shape.spacedRepOffsets.length; offsetIndex++) {
      const offset = shape.spacedRepOffsets[offsetIndex]
      const reviewRound = absoluteRound - offset
      if (reviewRound < 1) continue
      if (reviewRound > mainLoopCount) continue
      const mapEntry = roundMap[reviewRound - 1]
      if (!mapEntry) continue
      if (usedLegosThisRound.has(mapEntry.legoId)) continue
      const lego = legoIndex.get(mapEntry.legoId)
      if (!lego) continue
      usedLegosThisRound.add(mapEntry.legoId)
      spacedRepEntries.push({
        lego,
        offset,
        // The LEGO's position in ITS OWN review schedule, which is what the urn
        // cursor is a function of. `offset` here IS `absoluteRound - debutRound`
        // because the review round is looked up by that offset, so the index
        // into the Fibonacci array is the count of reviews this LEGO has had —
        // exactly as in the main loop.
        offsetIndex,
        phraseCount: offset === 1 ? shape.n1PhraseCount : 1,
      })
    }

    // --- phase 2: emit the spaced-rep cycles ---
    // Emitted BEFORE the random-USE bucket is sized, because the bucket is
    // sized from what spaced rep actually produced, not from what it hoped to.
    // A reviewed LEGO whose USE basket has no playable phrase emits nothing,
    // and on a course with patchy audio that is most of them: eus_for_eng
    // projected 16 review cycles, emitted 6, and then only allowed itself the
    // 6-cycle random-USE floor — a 10-cycle round where the round target is
    // 22. Counting first and sizing second holds the round at its intended
    // length, which is what TARGET_CYCLES_PER_ROUND is for (Tom, 2026-05-20:
    // "it then keeps ROUND length approx the same for inserting
    // encouragements, listening exercises and so on").
    const cycles: Cycle[] = []
    let cycleSeq = 0

    for (const { lego, offsetIndex, phraseCount } of spacedRepEntries) {
      // The SAME urn the main loop uses — a per-LEGO monotonic round-robin over
      // the shortest-first USE pool, not an independent `Math.random` sample.
      // The old sample had no cross-draw memory at all, so a LEGO's reviews
      // could repeat one phrase indefinitely or never reach another; INF PLAY
      // is where a learner meets a LEGO most often, so that is where it hurt.
      const pool = orderedPoolsFor(lego.legoId).use
      if (pool.length === 0) continue
      const take = Math.min(phraseCount, pool.length)
      // No same-round claim set on this path (INF PLAY dedups by LEGO, one
      // entry per LEGO per round), so every draw is taken.
      for (const phrase of drawReviewPhrases(pool, offsetIndex, take, shape.n1PhraseCount, () => true)) {
        if (!phrase) continue
        cycleSeq++
        const cyc = buildInfPlayCycle(phrase, lego, 'review', infRound, cycleSeq, audioUrl, pauseConfig)
        if (cyc) cycles.push(cyc)
      }
    }

    // --- phase 3: random USE — fill to TARGET_CYCLES_PER_ROUND ---
    const targetRandomUse = Math.max(
      MIN_RANDOM_USE_PER_ROUND,
      Math.min(MAX_RANDOM_USE_PER_ROUND, TARGET_CYCLES_PER_ROUND - cycles.length),
    )

    // Pool = all main-loop LEGOs we haven't already used this round.
    // Walk the round-map (script order) so the pool is bounded to the
    // main loop, not the bundle.legos array (which could include extras).
    const availableLegos: BundleLego[] = []
    for (let i = 0; i < roundMap.length; i++) {
      const entry = roundMap[i]
      if (usedLegosThisRound.has(entry.legoId)) continue
      const lego = legoIndex.get(entry.legoId)
      if (!lego) continue
      availableLegos.push(lego)
    }
    const randomUseLegos = sampleN(availableLegos, targetRandomUse, random)
    for (const l of randomUseLegos) usedLegosThisRound.add(l.legoId)

    for (const lego of randomUseLegos) {
      // Phase 3 stays a genuine random sample by design — it is the "any USE
      // phrase from anywhere in the course" bucket, not a review urn — but it
      // now draws from the same eligible, ordered pool so an unplayable row
      // cannot win the draw and emit nothing.
      const pool = orderedPoolsFor(lego.legoId).use
      if (pool.length === 0) continue
      const phrase = pool[Math.floor(random() * pool.length)]
      cycleSeq++
      const cyc = buildInfPlayCycle(phrase, lego, 'use', infRound, cycleSeq, audioUrl, pauseConfig)
      if (cyc) cycles.push(cyc)
    }

    if (cycles.length === 0) continue

    const firstCycle = cycles[0]
    rounds.push({
      roundNumber: mainLoopCount + infRound,
      legoId: firstCycle.legoId ?? '',
      seedId: firstCycle.legoId
        ? legoIndex.get(firstCycle.legoId)?.seedId ?? ''
        : '',
      legoTargetText: '',
      legoKnownText: '',
      revival: true,
      cycles,
    })
  }

  return {
    rounds,
    next: { mode: 'infplay', infRound: position.fromInfRound + rounds.length },
  }
}

// ============================================================================
// CYCLE BUILDERS
// ============================================================================

/**
 * Intro cycle — uses the LEGO's `presentation` audio as prompt + target1 /
 * target2 voices for the reveal. Skip if EITHER target voice is missing
 * (without both we can't do the reveal — same policy as the cycles
 * endpoint adapter).
 *
 * pauseDuration: 0, lingerMs: 2000 — engine skips the speak phase when
 * pauseDuration === 0; lingerMs holds after voice2 so the learner can
 * read the tiles.
 */
function buildIntroCycle(lego: BundleLego, audioUrl: (id: string) => string): Cycle | null {
  const target1 = lego.ephemeralAudio.target1
  const target2 = lego.ephemeralAudio.target2
  if (!target1 || !target2) return null

  const presentation = lego.ephemeralAudio.presentation
  // Intro prompt = presentation when available; fall back to known so
  // we still emit something playable (matches `toPlayerCycle`).
  const promptId = presentation?.id ?? lego.ephemeralAudio.known?.id
  const promptUrl = promptId ? audioUrl(promptId) : ''

  return baseCycle({
    id: `${lego.legoId}_intro`,
    type: 'intro',
    legoId: lego.legoId,
    seedId: lego.seedId,
    knownText: lego.knownText,
    knownAudioUrl: promptUrl,
    targetText: lego.targetText,
    targetTextNative: lego.targetTextNative,
    target1,
    target2,
    audioUrl,
    pauseDuration: 0,
    lingerMs: INTRO_LINGER_MS,
    components: lego.components,
    glossSegments: lego.glossSegments,
  })
}

/**
 * Debut cycle — standard 4-phase prompt/pause/voice1/voice2 on the LEGO
 * itself. Requires known + target1 + target2.
 */
function buildDebutCycle(
  lego: BundleLego,
  audioUrl: (id: string) => string,
  pauseConfig: PauseModeConfig,
): Cycle | null {
  const known = lego.ephemeralAudio.known
  const target1 = lego.ephemeralAudio.target1
  const target2 = lego.ephemeralAudio.target2
  if (!known || !target1 || !target2) return null

  return baseCycle({
    id: `${lego.legoId}_debut`,
    type: 'debut',
    legoId: lego.legoId,
    seedId: lego.seedId,
    knownText: lego.knownText,
    knownAudioUrl: audioUrl(known.id),
    targetText: lego.targetText,
    targetTextNative: lego.targetTextNative,
    target1,
    target2,
    audioUrl,
    pauseDuration: computePauseDuration(
      target1.durationMs ?? 0,
      target2.durationMs ?? 0,
      pauseConfig,
    ),
    components: lego.components,
    glossSegments: lego.glossSegments,
  })
}

/**
 * Phrase cycle — used for build / use / review (spaced rep). Same
 * audio-completeness gate as debut. The `cycleType` becomes `Cycle.type`
 * for telemetry; `id` carries BOTH the cycle type and the ordinal so repeated
 * phrases stay unique. The type is load-bearing, not decoration: one USE row
 * can legitimately play twice in a round — promoted into a BUILD slot and
 * again in the consolidation tail — and with a type-less id those two cycles
 * collide, so the client's de-dupe-by-cycle-id (`bufferCycles`) silently eats
 * the consolidation cycle. Caught by the wire-level parity harness.
 */
function buildPhraseCycle(
  phrase: BundlePhrase,
  lego: BundleLego,
  cycleType: 'build' | 'use' | 'review',
  ordinal: number,
  audioUrl: (id: string) => string,
  pauseConfig: PauseModeConfig,
): Cycle | null {
  const known = phrase.audio.known
  const target1 = phrase.audio.target1
  const target2 = phrase.audio.target2
  if (!known || !target1 || !target2) return null

  return baseCycle({
    id: `${phrase.phraseId}_${cycleType}_${ordinal}`,
    type: cycleType,
    legoId: lego.legoId,
    seedId: lego.seedId,
    knownText: phrase.knownText,
    knownAudioUrl: audioUrl(known.id),
    targetText: phrase.targetText,
    targetTextNative: phrase.targetTextNative,
    target1,
    target2,
    audioUrl,
    pauseDuration: computePauseDuration(
      target1.durationMs ?? 0,
      target2.durationMs ?? 0,
      pauseConfig,
    ),
    displayTiling: phrase.displayTiling,
    decomposition: phrase.decomposition,
  })
}

/**
 * INF PLAY cycle — separate builder because the id format is round-aware
 * (`${legoId}_infsr_R${infRound}_${seq}` for spaced rep,
 * `${legoId}_infuse_R${infRound}_${seq}` for random USE), matching the
 * server's existing infplay-cycles endpoint so any callsite that already
 * knows the id pattern keeps working.
 */
function buildInfPlayCycle(
  phrase: BundlePhrase,
  lego: BundleLego,
  cycleType: 'use' | 'review',
  infRound: number,
  seq: number,
  audioUrl: (id: string) => string,
  pauseConfig: PauseModeConfig,
): Cycle | null {
  const known = phrase.audio.known
  const target1 = phrase.audio.target1
  const target2 = phrase.audio.target2
  if (!known || !target1 || !target2) return null

  const idPrefix = cycleType === 'review' ? 'infsr' : 'infuse'

  return baseCycle({
    id: `${lego.legoId}_${idPrefix}_R${infRound}_${seq}`,
    type: cycleType,
    legoId: lego.legoId,
    seedId: lego.seedId,
    knownText: phrase.knownText,
    knownAudioUrl: audioUrl(known.id),
    targetText: phrase.targetText,
    targetTextNative: phrase.targetTextNative,
    target1,
    target2,
    audioUrl,
    pauseDuration: computePauseDuration(
      target1.durationMs ?? 0,
      target2.durationMs ?? 0,
      pauseConfig,
    ),
    displayTiling: phrase.displayTiling,
    decomposition: phrase.decomposition,
  })
}

// ============================================================================
// SHARED CYCLE-SHAPE BUILDER
// ============================================================================

interface BaseCycleOpts {
  id: string
  type: string
  legoId: string
  seedId: string
  knownText: string
  knownAudioUrl: string
  targetText: string
  targetTextNative?: string
  target1: BundleAudioRef
  target2: BundleAudioRef
  audioUrl: (id: string) => string
  pauseDuration: number
  lingerMs?: number
  components?: Array<{ known: string; target: string }>
  /** Authored known-language word mapping — LEGO-sourced cycles only. */
  glossSegments?: Array<{ span: number; known: string }>
  /** Authored display tiles — phrase-sourced cycles only. */
  displayTiling?: Array<{ n: string; r: string; salient?: boolean }>
  /**
   * Authoritative content-level tiling (course_practice_phrases.decomposition),
   * phrase-sourced cycles only. Load-bearing beyond display: the round adapter
   * derives `componentLegoIds` from it, and those ids are what the player
   * co-fires into `learner_lego_pairings`. Dropping it here silently killed
   * every pair on every bundle course (job #158).
   */
  decomposition?: Array<{
    legoId: string | null
    target: string
    known: string
    isGhost: boolean
    isSalient?: boolean
  }>
}

function baseCycle(o: BaseCycleOpts): Cycle {
  const cycle: Cycle = {
    id: o.id,
    type: o.type,
    legoId: o.legoId,
    known: {
      text: o.knownText,
      audioUrl: o.knownAudioUrl,
    },
    target: {
      text: o.targetText,
      ...(o.targetTextNative ? { textNative: o.targetTextNative } : {}),
      voice1Url: o.audioUrl(o.target1.id),
      voice2Url: o.audioUrl(o.target2.id),
    },
    pauseDuration: o.pauseDuration,
    ...(o.lingerMs !== undefined ? { lingerMs: o.lingerMs } : {}),
    ...(o.target1.durationMs ? { target1DurationMs: o.target1.durationMs } : {}),
    ...(o.target2.durationMs ? { target2DurationMs: o.target2.durationMs } : {}),
    ...(o.components && o.components.length > 0 ? { components: o.components } : {}),
    ...(o.glossSegments && o.glossSegments.length > 0 ? { glossSegments: o.glossSegments } : {}),
    ...(o.displayTiling && o.displayTiling.length > 0 ? { displayTiling: o.displayTiling } : {}),
    ...(o.decomposition && o.decomposition.length > 0 ? { decomposition: o.decomposition } : {}),
  }
  // `seedId` lives on Round, not Cycle — but the round consumer reads
  // `lego.seedId` from `legoIndex`, so we don't need to stash it on
  // each cycle. (Kept out of the shape on purpose: SimplePlayer.Cycle
  // has no seedId field.)
  return cycle
}

// ============================================================================
// UTILITIES
// ============================================================================

function defaultAudioUrl(id: string): string {
  return `/api/audio/${id}`
}

/**
 * Partial Fisher-Yates: returns up to `n` distinct elements from `arr`
 * in a fresh array. O(min(n, arr.length)) work. The `random` callback
 * is the seed-injection point for deterministic tests.
 */
function sampleN<T>(arr: T[], n: number, random: () => number): T[] {
  if (n <= 0 || arr.length === 0) return []
  if (n >= arr.length) return [...arr]
  const a = [...arr]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (a.length - i))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a.slice(0, n)
}
