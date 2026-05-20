/**
 * generateScript — client-side, unified main-loop + INF PLAY generator.
 *
 * Pure function (modulo `random` injection): consumes a `CourseBundle`
 * already in memory and emits `SimplePlayer.Round[]` ready for
 * `simplePlayer.initialize` / `simplePlayer.appendRounds`. Replaces the
 * three JIT pipelines (/cycles, /infplay-cycles, plus their adapters).
 *
 * No I/O. No Supabase. No fetch. Deterministic given the same `random`
 * callback — same seed in, same script out.
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
 */

import type { Cycle, Round } from '../playback/SimplePlayer'
import {
  legosById,
  phrasesByLegoAndRole,
  type BundleAudioRef,
  type BundleLego,
  type BundlePhrase,
  type CourseBundle,
} from '../types/courseBundle'
import { computePauseDuration } from '../playback/computePauseDuration'
import { DEFAULT_NORMAL } from '../composables/useAlgorithmConfig'
import type {
  GenerateScriptOptions,
  GenerateScriptResult,
  MainPosition,
  InfPlayPosition,
} from './scriptGenerator.types'

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_ROUND_LIMIT = 15

/**
 * Fibonacci offsets for spaced rep, identical to the server's main-loop
 * + INF PLAY schedule. The N-1 offset gets THREE different USE phrases
 * (per `n1PhraseCount`); all other offsets get ONE.
 */
const SPACED_REP_OFFSETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const

const N1_PHRASE_COUNT = 3

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

  if (opts.position.mode === 'main') {
    return generateMain(opts.bundle, opts.position, roundLimit, audioUrl, random)
  }
  return generateInfPlay(opts.bundle, opts.position, roundLimit, audioUrl, random)
}

// ============================================================================
// MAIN-LOOP GENERATION
// ============================================================================

function generateMain(
  bundle: CourseBundle,
  position: MainPosition,
  roundLimit: number,
  audioUrl: (id: string) => string,
  random: () => number,
): GenerateScriptResult {
  const roundMap = bundle.roundMap
  const startIdx = roundMap.findIndex((e) => e.legoId === position.fromLegoId)
  if (startIdx < 0) {
    throw new Error(`legoId not in round map: ${position.fromLegoId}`)
  }

  const legoIndex = legosById(bundle)
  const phraseIndex = phrasesByLegoAndRole(bundle)

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
    const phrases = phraseIndex.get(entry.legoId) ?? { build: [], use: [] }

    const cycles: Cycle[] = []

    // --- intro / debut ---
    const introCycle = buildIntroCycle(lego, audioUrl)
    if (introCycle) cycles.push(introCycle)
    const debutCycle = buildDebutCycle(lego, audioUrl)
    if (debutCycle) cycles.push(debutCycle)

    // --- builds, then uses (position-ordered) ---
    const buildsSorted = [...phrases.build].sort((a, b) => a.position - b.position)
    let buildOrdinal = 0
    for (const phrase of buildsSorted) {
      buildOrdinal++
      const cyc = buildPhraseCycle(phrase, lego, 'build', buildOrdinal, audioUrl)
      if (cyc) cycles.push(cyc)
    }
    const usesSorted = [...phrases.use].sort((a, b) => a.position - b.position)
    let useOrdinal = 0
    for (const phrase of usesSorted) {
      useOrdinal++
      const cyc = buildPhraseCycle(phrase, lego, 'use', useOrdinal, audioUrl)
      if (cyc) cycles.push(cyc)
    }

    // --- spaced rep against this round's index in the round-map ---
    const spacedRepCycles = buildSpacedRepCycles(
      entry.roundIndex,
      bundle,
      legoIndex,
      phraseIndex,
      audioUrl,
      random,
    )
    cycles.push(...spacedRepCycles)

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
 * 3 (N-1) or 1 (others) USE phrases from that LEGO.
 */
function buildSpacedRepCycles(
  currentRoundIndex: number,
  bundle: CourseBundle,
  legoIndex: Map<string, BundleLego>,
  phraseIndex: Map<string, { build: BundlePhrase[]; use: BundlePhrase[] }>,
  audioUrl: (id: string) => string,
  random: () => number,
): Cycle[] {
  const cycles: Cycle[] = []
  const seenLegos = new Set<string>()

  for (const offset of SPACED_REP_OFFSETS) {
    const reviewRoundIndex = currentRoundIndex - offset
    if (reviewRoundIndex < 1) continue
    const mapEntry = bundle.roundMap[reviewRoundIndex - 1]
    if (!mapEntry) continue
    if (seenLegos.has(mapEntry.legoId)) continue
    seenLegos.add(mapEntry.legoId)

    const lego = legoIndex.get(mapEntry.legoId)
    if (!lego) continue
    const phrases = phraseIndex.get(mapEntry.legoId)
    if (!phrases || phrases.use.length === 0) continue

    const count = offset === 1 ? N1_PHRASE_COUNT : 1
    const drawn = sampleN(phrases.use, Math.min(count, phrases.use.length), random)
    let seq = 0
    for (const phrase of drawn) {
      seq++
      const cyc = buildPhraseCycle(phrase, lego, 'review', seq, audioUrl)
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
): GenerateScriptResult {
  const mainLoopCount = bundle.mainLoopCount
  const roundMap = bundle.roundMap
  const legoIndex = legosById(bundle)
  const phraseIndex = phrasesByLegoAndRole(bundle)

  const rounds: Round[] = []

  for (let r = 0; r < roundLimit; r++) {
    const infRound = position.fromInfRound + r
    const absoluteRound = mainLoopCount + infRound
    const usedLegosThisRound = new Set<string>()

    // --- phase 1: spaced rep ---
    type SpacedRepEntry = { lego: BundleLego; offset: number; phraseCount: number }
    const spacedRepEntries: SpacedRepEntry[] = []

    for (const offset of SPACED_REP_OFFSETS) {
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
        phraseCount: offset === 1 ? N1_PHRASE_COUNT : 1,
      })
    }

    // --- phase 2: random USE — fill to TARGET_CYCLES_PER_ROUND ---
    const projectedSpacedRepCount = spacedRepEntries.reduce(
      (sum, e) => sum + e.phraseCount,
      0,
    )
    const targetRandomUse = Math.max(
      MIN_RANDOM_USE_PER_ROUND,
      Math.min(
        MAX_RANDOM_USE_PER_ROUND,
        TARGET_CYCLES_PER_ROUND - projectedSpacedRepCount,
      ),
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

    // --- emit cycles ---
    const cycles: Cycle[] = []
    let cycleSeq = 0

    for (const { lego, phraseCount } of spacedRepEntries) {
      const phrases = phraseIndex.get(lego.legoId)
      if (!phrases || phrases.use.length === 0) continue
      const drawn = sampleN(phrases.use, Math.min(phraseCount, phrases.use.length), random)
      for (const phrase of drawn) {
        cycleSeq++
        const cyc = buildInfPlayCycle(phrase, lego, 'review', infRound, cycleSeq, audioUrl)
        if (cyc) cycles.push(cyc)
      }
    }

    for (const lego of randomUseLegos) {
      const phrases = phraseIndex.get(lego.legoId)
      if (!phrases || phrases.use.length === 0) continue
      const phrase = phrases.use[Math.floor(random() * phrases.use.length)]
      cycleSeq++
      const cyc = buildInfPlayCycle(phrase, lego, 'use', infRound, cycleSeq, audioUrl)
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
  })
}

/**
 * Debut cycle — standard 4-phase prompt/pause/voice1/voice2 on the LEGO
 * itself. Requires known + target1 + target2.
 */
function buildDebutCycle(lego: BundleLego, audioUrl: (id: string) => string): Cycle | null {
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
      DEFAULT_NORMAL,
    ),
    components: lego.components,
  })
}

/**
 * Phrase cycle — used for build / use / review (spaced rep). Same
 * audio-completeness gate as debut. The `cycleType` becomes `Cycle.type`
 * for telemetry; `id` carries the ordinal so repeated phrases stay unique.
 */
function buildPhraseCycle(
  phrase: BundlePhrase,
  lego: BundleLego,
  cycleType: 'build' | 'use' | 'review',
  ordinal: number,
  audioUrl: (id: string) => string,
): Cycle | null {
  const known = phrase.audio.known
  const target1 = phrase.audio.target1
  const target2 = phrase.audio.target2
  if (!known || !target1 || !target2) return null

  return baseCycle({
    id: `${phrase.phraseId}_${ordinal}`,
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
      DEFAULT_NORMAL,
    ),
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
      DEFAULT_NORMAL,
    ),
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
