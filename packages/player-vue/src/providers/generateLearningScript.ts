/**
 * generateLearningScript - Build complete learning script from Supabase
 *
 * Copied from dashboard (src/services/supabase.js) - this is the source of truth.
 * Same database, same query, same result.
 *
 * Round Structure:
 * 1. INTRO     - presentation audio ("The Dutch for X is...")
 * 2. DEBUT     - the LEGO itself (known → target)
 * 3. BUILD ×7  - up to 7 BUILD phrases (drilling)
 * 4. SPACED REP - USE phrases from older LEGOs (max 12, Fibonacci timing)
 * 5. USE ×2    - exactly 2 USE phrases (consolidation)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { validateLearningScript } from './validateLearningScript'
import { applyAudioRef, fetchRevisedAudioRefs, stampRowAudioRefs } from './revisedAudioRefs'
// The phrase-length cap lives with the mode config it comes from — ONE place,
// next to resolveScriptShape (Aran's correction, 2026-08-06).
import {
  capPhrasesByLength, courseMaxPhraseLength, phraseTextLength,
  normalizeMaxPhraseLengthFraction, normalizeMaxKnownSyllables,
  normalizeReviewFilterMaxRound, makeKnownSyllableResolver, filterReviewPool,
  MIN_BUILD_PHRASES_AFTER_CAP, MIN_USE_PHRASES_AFTER_CAP,
} from '../composables/useAlgorithmConfig'
import type { ReviewPullFilter } from '../composables/useAlgorithmConfig'
import { capConsecutiveRepeats } from '../playback/capConsecutiveRepeats'
import { doublePhraseCycles } from './doublePhraseCycles'

export interface ScriptItem {
  uuid: string
  cycleNum: number
  roundNumber: number
  seedId: string
  legoKey: string
  seedCode: string
  legoCode: string
  type: 'intro' | 'debut' | 'build' | 'spaced_rep' | 'use' | 'listening' | 'component_intro' | 'component_practice' | 'listen_intro' | 'listen_outro' | 'pod'
  knownText: string
  targetText: string
  /** Native script text — only set when targetText is romanized */
  targetTextNative?: string
  presentationAudioId?: string
  knownAudioId?: string
  target1Id?: string
  target2Id?: string
  target1DurationMs?: number
  target2DurationMs?: number
  isNew: boolean
  syllableCount?: number
  fibPosition?: number
  reviewOf?: number
  /** Set to 'seed' when this spaced_rep item is a SEED-PHASE review (offset
   * ≥ SEED_PHASE_START_OFFSET): the payload is the full parent seed sentence,
   * not a use-phrase. Absent for ordinary use-phrase reviews. */
  reviewItemKind?: 'seed'
  componentLegoIds?: string[]
  componentLegoTexts?: string[]
  /** Native script variants — only set when romanized text exists */
  componentLegoTextsNative?: string[]
  /** Authoritative content-level tiling from course_practice_phrases.decomposition,
   * carried verbatim for phrase-sourced items. Player renders it directly. */
  decomposition?: Array<{ legoId: string | null; target: string; known: string; isGhost: boolean; isSalient?: boolean }>
  /** Authored display tiles from course_practice_phrases.display_tiling —
   * {n: native, r: roman, salient} per tile, built and validated in Popty.
   * When present the player renders these directly (native glyph primary,
   * roman as ruby) instead of running the device segmenter. */
  displayTiling?: Array<{ n: string; r: string; salient?: boolean }>

  /** M-LEGO component breakdown: [{known: "with", target: "con"}, ...] */
  components?: Array<{ known: string; target: string }>
  /** Native script variant of components */
  componentsNative?: Array<{ known: string; target: string }>
  /** Listening phase: playback speed multiplier (1.0 = normal, 2.0 = double) */
  playbackSpeed?: number
  /** Listening phase: which seed this listening item is for */
  listeningSeedNumber?: number
}

/**
 * Default per-round script shape — mirrored to algorithm_config.script_shape.
 * Changing these reshapes every round generated after the change.
 */
export interface ScriptShape {
  spacedRepOffsets: number[]
  maxBuildPhrases: number
  useConsolidationCount: number
  maxSpacedRepPhrases: number
  n1PhraseCount: number
}

export const DEFAULT_SCRIPT_SHAPE: ScriptShape = {
  // Extended to span a full course (≈1200–2000 LEGOs), mirroring the dashboard
  // generator (services/learning-script-generator.cjs). Offsets ≥144 are
  // SEED-PHASE production reviews (whole parent seed sentence). The live
  // algorithm_config.script_shape row is the runtime source of truth; this is
  // the fallback when that fetch fails.
  spacedRepOffsets: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584],
  maxBuildPhrases: 7,
  useConsolidationCount: 2,
  maxSpacedRepPhrases: 12,
  n1PhraseCount: 3,
}

/**
 * First skip offset at which a spaced-rep PRODUCTION review switches from a
 * use-phrase (LEGO-level) to the FULL PARENT SEED SENTENCE. Mirrors the
 * dashboard generator. 144 is the first Fibonacci term past the historical
 * use-phrase tail (…,55,89), so the 89-step stays the last use-phrase.
 *
 * Distinct from L1 listening (the 30-cup model): cups are passive INPUT
 * (hearing whole sentences you've stopped producing); a seed-phase spaced-rep
 * review is active PRODUCTION (recalling the whole sentence from a known cue).
 * Complementary channels, not redundant — so a graduated seed (dropped from
 * use-phrase review) stays eligible for seed-phase production review.
 */
export const SEED_PHASE_START_OFFSET = 144

/** Is a spaced-rep review at this skip offset in the seed-sentence phase? */
export function reviewItemIsSeed(offset: number): boolean {
  return offset >= SEED_PHASE_START_OFFSET
}

// Role → runtime playback rate for Layer-2 pod plays (emitPodLap, retained
// for hot-fix rollback — see the comment above emitPodLap). All audio
// (target or known) plays back at the role's speed; 'trans' is always 1.0×
// because the known-language clip is reference material.
const ROLE_SPEED: Record<string, number> = {
  ps08x: 0.8,
  ps: 1.0,
  ps15x: 1.5,
  ps2x: 2.0,
  trans: 1.0,
}

// Per Aran's listening-layers spec.
// Graduation is event-driven (1 LEGO == 1 round; a seed graduates once
// all its LEGOs have been introduced and the offset has elapsed).
//
// 2026-05-19: L1 listening pulled out of the main flow, replaced by the
// runtime 30-cup wheel (useLayer1Scheduler.ts). L2 stays in (every
// POD_ROUND_INTERVAL rounds, runtime-scheduled); L1 graduation still
// tracks here (graduatedSeeds) purely to gate SEED-PHASE production
// review continuation (reviewItemIsSeed) once a seed's use-phrase review
// has lapsed — see the SPACED REP phase below.
export interface ListeningConfig {
  enabled: boolean
  offset: number              // rounds after last LEGO before seed graduates
  // Layer 2 — Pod 0
  /** First pod lap fires at end of this main round (start of seed 2).
   *  Optional now that the field's primary home is PodsConfig — callers
   *  that pass the listening config without merging it in still work;
   *  the generator falls back to 6 (matches DEFAULT_POD_ACTIVATION). */
  podActivationRound?: number
}

export const DEFAULT_LISTENING_CONFIG: ListeningConfig = {
  enabled: true,
  // Graduation offset: rounds after a seed's LAST LEGO debut before it
  // becomes eligible for L1 listening. Calibrated to N-89 spaced-rep
  // decay — final fib review for the last LEGO is at lastRound + 89,
  // graduation one round later means the seed enters listening only
  // after every one of its LEGOs has fully dropped out of spaced rep.
  offset: 90,
  podActivationRound: 6,
}

export interface LearningScriptResult {
  items: ScriptItem[]
  cycleCount: number
  roundCount: number
  /**
   * Number of MAIN-LOOP rounds in the playable output (i.e. where the INF-PLAY
   * revival tail begins, as a 0-based index into the rounds). Derived from the
   * generator's OWN boundary (mainLoopLastRound) over the PLAYABLE items — so it
   * is the true current course size (sparse LEGO ordinal, unbuilt/no-audio seeds
   * already excluded). The single source of truth for "where INF PLAY starts";
   * callers must NOT re-derive it from a DB count, which diverges.
   */
  mainLoopRoundCount: number
  hasRomanizedText: boolean
  /**
   * Did the KNOWN-side review/consolidate pull filter actually apply?
   *
   * False when the mode sets no filter (Fast), OR when this course's KNOWN
   * language has no registered syllable counter. The flag exists so the
   * filter's inertness is VISIBLE to callers rather than being an invisible
   * no-op, which is exactly how the first syllable attempt failed. Pairs with
   * the once-per-course console warning from makeKnownSyllableResolver.
   */
  syllableCapApplied: boolean
}

/**
 * The Easy-mode levers, all off by default — so a caller that passes nothing
 * (and Fast, which passes them all off explicitly) generates byte-identical
 * output to the pre-2026-08-07 walk.
 */
export interface EasyModeOptions {
  /**
   * Play every BUILD / USE / REVIEW / CONSOLIDATE cycle exactly twice, back to
   * back (Tom, 2026-08-07). Intro and bare-LEGO debut cycles play once.
   */
  doublePhraseCycles?: boolean
  /** False ⇒ BUILD phrases bypass the phrase-length cap entirely ("no
   *  filtering on BLD phrases" — Tom, 2026-08-07). Default true. */
  filterBuildPhrases?: boolean
  /** Max KNOWN-language syllables for a review/consolidate pull. 0 ⇒ off. */
  reviewMaxKnownSyllables?: number
  /** Last round on which that filter applies; it lifts from the next round. */
  reviewSyllableFilterMaxRound?: number
}

/**
 * Sample `n` items without replacement using a partial Fisher-Yates shuffle.
 *
 * `rng` is an injectable [0,1) random source. The revival / random-USE tail
 * of INF PLAY passes a SEEDED rng (mulberry32 keyed on the learner's position)
 * so the steady-state USE stream is deterministic: same learner + same
 * position ⇒ same sequence, every session and every regeneration. This is what
 * makes online INF PLAY navigable (back-nav returns to what was just heard)
 * and matches the offline seeded model. Main-loop callers omit `rng` and get
 * the legacy unseeded `Math.random()` — main play is unchanged.
 */
function sampleWithoutReplacement<T>(arr: T[], n: number, rng: () => number = Math.random): T[] {
  if (n >= arr.length) return [...arr]
  const a = [...arr]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

// Deliberately EXCLUDES the two heavy JSON columns `decomposition` and
// `display_tiling`. Across a big course's 15-17k phrase rows those two
// dominate the payload, yet the full-course walk only needs them for the
// handful of rounds actually RENDERED — and rendering is served per-round by
// the instant-playback /cycles path (useInstantPlayback → backendCyclesToRounds),
// which fetches both columns for exactly the rounds on screen. Pulling them
// across the whole course here was pure up-front tax. Script items generated
// from this fetch simply omit decomposition/displayTiling (nativeFields guards
// on presence); any round that reaches the screen gets its authored tiling from
// /cycles. See the course-load-window fix.
const PRACTICE_PHRASE_COLUMNS =
  'seed_number, lego_index, known_text, target_text, target_text_roman, phrase_role, target_syllable_count, position, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms, introduce'

/**
 * Fetch ALL course_practice_phrases for a course, paginated.
 *
 * A single `.limit(N)` is silently capped by PostgREST's server-side max-rows
 * (>=10000 here). Big courses carry 15-17k phrase rows, so the old single
 * `.limit(10000)` query dropped every phrase past ~seed 405 — the back 40-56%
 * of the course had NO build/use phrases, which starved INF PLAY's random-USE
 * pool AND the SR-drain (revival rounds came out as ~4-16 cycles of mostly the
 * front of the course, never the canonical 22, and the spaced review of the
 * final LEGOs played nothing). Count first, then fetch every page in parallel
 * (PAGE well under any server cap, so the slices are complete and ordered).
 */
async function fetchAllPracticePhrases(
  supabase: SupabaseClient,
  courseCode: string,
): Promise<{ data: any[] | null; error: any }> {
  const PAGE = 1000
  const { count, error: countError } = await supabase
    .from('course_practice_phrases')
    .select('*', { count: 'exact', head: true })
    .eq('course_code', courseCode)
  if (countError) return { data: null, error: countError }
  const total = count ?? 0
  if (total === 0) return { data: [], error: null }
  const pageCount = Math.ceil(total / PAGE)
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) =>
      supabase
        .from('course_practice_phrases')
        .select(PRACTICE_PHRASE_COLUMNS)
        .eq('course_code', courseCode)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })
        .order('position', { ascending: true })
        .range(i * PAGE, i * PAGE + PAGE - 1),
    ),
  )
  const all: any[] = []
  for (const p of pages) {
    if (p.error) return { data: null, error: p.error }
    if (p.data) all.push(...p.data)
  }
  return { data: all, error: null }
}

// ————————————————————————————————————————————————————————————————————————
// Cooperative yielding for the whole-course walk. The walk is idle-scheduled
// the moment READY paints (LearningPlayer's ready-gated handoff), and its
// build loops used to run as ONE synchronous task — measured as a 10.9s
// main-thread block on a 4x-throttled CPU right after READY, which is the
// post-READY input dead zone (founder 2026-07-30: READY must mean
// INTERACTIVE, not painted). Yielding to the event loop between ~40ms slices
// lets input events and rendering interleave with the walk; the walk still
// completes long before its output is consumed (INF-PLAY boundary / warm
// cache / resume repair).
const WALK_SLICE_BUDGET_MS = 40

/**
 * Prompt identity for the A-64 consecutive-repeat cap: what the learner
 * actually hears as "the same thing again".
 *
 * Default per Tom's brief — normalised known text paired with normalised target
 * text, the same notion `getPhraseId` uses for within-round de-duplication.
 * Listening items are the one case that notion cannot see: a pod sentence play
 * carries no known text and a pod translation carries no target text, so two
 * plays of the same clip at different speeds ('ps' vs 'ps2x') would otherwise
 * look like different prompts. For those we fall back to the audio ids, which
 * is the honest answer — it is the same clip.
 */
export function scriptItemIdentity(item: ScriptItem): string {
  const norm = (text: string | null | undefined): string =>
    text ? text.toLowerCase().trim().replace(/[.,!?;:¡¿'"]+/g, '') : ''
  const known = norm(item.knownText)
  const target = norm(item.targetText)
  if (known || target) return `${known}|${target}`
  return `audio:${item.knownAudioId ?? ''}|${item.target1Id ?? ''}`
}

export const yieldToEventLoop = (): Promise<void> => {
  const sched = (globalThis as any).scheduler
  if (sched && typeof sched.yield === 'function') {
    // scheduler.yield(): continuation-priority resume, input runs first.
    return sched.yield().catch(() => new Promise<void>((r) => setTimeout(r, 0)))
  }
  if (typeof MessageChannel !== 'undefined') {
    // MessageChannel beats setTimeout's ~4ms nested-timer clamp; a fresh
    // channel per yield so concurrent walks can never steal each other's wake.
    return new Promise<void>((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => { ch.port1.close(); resolve() }
      ch.port2.postMessage(null)
    })
  }
  return new Promise<void>((r) => setTimeout(r, 0))
}

/**
 * Returns an awaitable tick: a no-op while the current slice is under
 * budget, a real event-loop yield once it exceeds it. Sprinkled through the
 * walk's hot loops so no single main-thread task outlives ~budgetMs.
 */
export const makeSliceYielder = (budgetMs: number = WALK_SLICE_BUDGET_MS): (() => Promise<void>) => {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  let sliceStart = now()
  return async () => {
    if (now() - sliceStart < budgetMs) return
    await yieldToEventLoop()
    sliceStart = now()
  }
}

export async function generateLearningScript(
  supabase: SupabaseClient,
  courseCode: string,
  /**
   * Number of revival (infinite-play) rounds to emit AFTER the main loop
   * exhausts every is_new LEGO. The main-loop walk is always full-course;
   * this only controls how far the post-main tail extends. Default 50.
   */
  infinitePlayLookahead: number = 50,
  listeningConfig: ListeningConfig = DEFAULT_LISTENING_CONFIG,
  scriptShape: ScriptShape = DEFAULT_SCRIPT_SHAPE,
  /**
   * Cap on phrase length for the active learning mode, as a fraction of the
   * longest phrase available for each LEGO. 1.0 (the default) is uncapped and
   * reproduces the pre-2026-08-06 behaviour exactly; Easy ships 0.5.
   * See capPhrasesByLength() — the one place the rule lives.
   */
  maxPhraseLengthFraction: number = 1,
  /**
   * The active mode's Easy levers — doubling, the BUILD-filter switch, and the
   * known-side review/consolidate pull filter (Tom, 2026-08-07). Everything is
   * off by default, and Fast passes them all off, so Fast's script is provably
   * unchanged. Replaces the absolute TARGET-syllable ceiling that briefly
   * occupied this slot earlier the same night.
   */
  easyOptions: EasyModeOptions = {},
  /**
   * Fire a pod-lap every N main rounds from podActivationRound onward.
   * Mirrors PodsConfig.roundInterval — passed in so the generator's
   * L1-outro merge decision stays in sync with the runtime scheduler.
   * Default 1 (every round, legacy behaviour).
   */
  podRoundInterval: number = 5,
  /**
   * Seeded [0,1) random source for the INF-PLAY revival / random-USE tail.
   * When supplied, the long-tail steady-state USE stream becomes deterministic
   * for a given learner+position (so online INF PLAY is navigable and matches
   * the offline seeded model — coordinator decision 2026-05-29). Omit for the
   * legacy unseeded behaviour; the MAIN LOOP never consumes this, so main play
   * is unaffected either way.
   */
  infplayRandom?: () => number,
): Promise<LearningScriptResult> {
  // Per-round shape — DB-tweakable via algorithm_config.script_shape.
  const SPACED_REP_OFFSETS = scriptShape.spacedRepOffsets
  const MAX_BUILD_PHRASES = scriptShape.maxBuildPhrases
  const USE_CONSOLIDATION_COUNT = scriptShape.useConsolidationCount
  const MAX_SPACED_REP_PHRASES = scriptShape.maxSpacedRepPhrases
  const N1_PHRASE_COUNT = scriptShape.n1PhraseCount

  // Phrase-length cap (mode row). The ceiling is ABSOLUTE and COURSE-WIDE —
  // a fraction of the longest phrase in the whole course, measured in
  // characters of target text — computed once below, after the phrase pools
  // are known. 1.0 = uncapped = historic behaviour; Easy ships 0.5. Ordering
  // is always shortest-first; the cap only removes the long tail.
  const PHRASE_LENGTH_FRACTION = normalizeMaxPhraseLengthFraction(maxPhraseLengthFraction)
  const phraseLengthOf = (p: Phrase): number => phraseTextLength(p.target_text)

  const normalizeText = (text: string | null | undefined): string => {
    if (!text) return ''
    return text.toLowerCase().trim().replace(/[.,!?;:¡¿'"\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g, '')
  }

  const getPhraseId = (knownText: string, targetText: string): string => {
    return `${normalizeText(knownText)}|${normalizeText(targetText)}`
  }

  const countTargetSyllables = (targetText: string | null | undefined): number => {
    if (!targetText) return 0
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g
    const cjkChars = targetText.match(cjkRegex)
    if (cjkChars && cjkChars.length > 0) return cjkChars.length
    const vowelClusters = targetText.toLowerCase().match(/[aeiouyáéíóúàèìòùâêîôûäëïöü]+/gi)
    return vowelClusters ? vowelClusters.length : 1
  }

  /** A phrase's target syllable count: the stored value, else derived. */
  const phraseSyllables = (phrase: {
    target_syllable_count?: number
    target_text?: string | null
  }): number => phrase.target_syllable_count || countTargetSyllables(phrase.target_text)

  // Query tables directly - audio IDs stored on each row, no joins needed.
  // ALL course-content queries are course-wide — no startSeed/endSeed
  // filtering. The script generator always walks the full course. Chunking
  // by seed range was the original cause of the L1-listening silent-fail
  // bug: any course-wide derivation (graduated seeds, anchor ordinals,
  // cross-LEGO references) needs the whole inventory in scope, not just
  // the current chunk's window.
  const [legosResult, phrasesResult, seedsResult, bookendsResult, podsResult, catalogueResult, revisedAudioRefs, courseRowResult] = await Promise.all([
    supabase
      .from('course_legos')
      .select('seed_number, lego_index, known_text, target_text, target_text_roman, type, is_new, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms')
      .eq('course_code', courseCode)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .limit(5000),
    // Paginated — a single .limit() is capped by PostgREST max-rows and big
    // courses have 15-17k phrase rows; truncation starved INF PLAY (see helper).
    fetchAllPracticePhrases(supabase, courseCode),
    // Seed sentences — needed for L1 listening (cups) AND seed-phase spaced-rep
    // reviews (offset ≥144, the whole parent sentence). Loaded unconditionally
    // so seed-phase production reviews work even when listening is disabled.
    supabase
      .from('course_seeds')
      .select('seed_number, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id')
      .eq('course_code', courseCode)
      .order('seed_number', { ascending: true }),
    // Pre-fetch the two LISTEN-block bookend audio rows for this course.
    // Generated by scripts/generate-listen-bookends.cjs in the dashboard repo;
    // missing rows just mean this course's bookends haven't been generated yet
    // and Phase 6 will skip emitting them silently.
    listeningConfig.enabled
      ? supabase
          .from('course_audio')
          .select('role, text, id, duration_ms')
          .eq('course_code', courseCode)
          .in('role', ['bookend_listen_intro', 'bookend_listen_outro'])
      : Promise.resolve({ data: [], error: null }),
    // Pre-fetch Pod 0 sentences (Layer 2 listening — round-end lap after
    // activation). Pod ID convention: "${course_code}:${slug}". Sentences
    // ordered by global_order; entry into the lap is 1 sentence/round.
    // Returns empty if course has no pod-0 — Phase 7 silently skips.
    listeningConfig.enabled
      ? supabase
          .from('listening_pod_sentences')
          .select('global_order, target_text, known_text, target_audio_id, known_audio_id')
          .eq('pod_id', `${courseCode}:pod-0`)
          .order('global_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    // Course-wide LEGO catalogue (just seed_number + lego_index). Used to
    // assign every LEGO an absolute ordinal position in the course — drives
    // L1 graduation tracking. Now redundant with the legos query above (same
    // course-wide scope), but kept as a separate fetch with only the two
    // columns needed for ordinal mapping — slightly cheaper than re-iterating
    // legosResult.
    listeningConfig.enabled
      ? supabase
          .from('course_legos')
          .select('seed_number, lego_index')
          .eq('course_code', courseCode)
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true })
          .limit(10000)
      : Promise.resolve({ data: [], error: null }),
    // Per-clip versioned audio refs. This walk reads the denormalised
    // `*_audio_id` columns straight from Supabase, so — unlike the /cycles
    // routes, which run the same map server-side — nothing here would carry a
    // revision suffix without this. A bare uuid for a REVISED clip is a
    // permanent stale-audio bug: both downstream caches key on the ref string.
    // Fetched in parallel with the content queries, so it costs no latency;
    // returns an empty map on any error (a missed suffix costs one stale clip,
    // a thrown error costs the whole script). See ./revisedAudioRefs.
    fetchRevisedAudioRefs(supabase, courseCode),
    // The course's KNOWN LANGUAGE — the one thing the review/consolidate pull
    // filter needs and nothing else here did. Smallest possible fetch: one
    // column, one row, in the existing parallel batch so it costs no latency.
    // Skipped entirely when no filter is set (Fast), so Fast issues exactly the
    // queries it always did. A failed/missing row leaves known_lang null,
    // which makes the filter inert and warn — never throws, never guesses.
    normalizeMaxKnownSyllables(easyOptions.reviewMaxKnownSyllables) < Infinity
      ? supabase
          .from('courses')
          .select('known_lang')
          .eq('course_code', courseCode)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  // KNOWN-side review/consolidate pull filter for this run (Tom, 2026-08-07).
  // Resolved ONCE: the mode's limit, the round it lifts at, and the one
  // resolver that knows how to count a phrase in this course's KNOWN language.
  // `countable` false ⇒ the filter is inert on this course and has already
  // warned.
  // A courses-table read error is NOT fatal — the filter going inert costs the
  // learner nothing (the character cap still applies), while throwing would
  // cost them the whole script.
  const MAX_KNOWN_SYLLABLES = normalizeMaxKnownSyllables(easyOptions.reviewMaxKnownSyllables)
  const REVIEW_FILTER_MAX_ROUND = normalizeReviewFilterMaxRound(easyOptions.reviewSyllableFilterMaxRound)
  if (courseRowResult?.error) {
    console.warn(`[phrase-cap] could not read courses.known_lang for ${courseCode} — review pull filter may be inert:`, courseRowResult.error.message)
  }
  const knownSyllableResolver = MAX_KNOWN_SYLLABLES < Infinity
    ? makeKnownSyllableResolver(courseCode, (courseRowResult?.data as { known_lang?: string } | null)?.known_lang)
    : null
  const REVIEW_PULL_FILTER: ReviewPullFilter<Phrase> | null = knownSyllableResolver
    ? {
        limit: MAX_KNOWN_SYLLABLES,
        maxRound: REVIEW_FILTER_MAX_ROUND,
        syllablesOf: (p: Phrase) => knownSyllableResolver.syllablesOf(p),
      }
    : null
  const syllableCapApplied = Boolean(knownSyllableResolver?.countable)

  // "No filtering on BLD phrases" (Tom, 2026-08-07) — Easy takes its BUILD
  // pool whole. Default true keeps every other caller on the historic path.
  const FILTER_BUILD_PHRASES = easyOptions.filterBuildPhrases !== false

  // All build loops below tick this — no single main-thread slice of the
  // walk may exceed the budget (post-READY interactivity, founder 2026-07-30).
  const yieldTick = makeSliceYielder()

  if (legosResult.error) throw new Error('Failed to query LEGOs: ' + legosResult.error.message)
  if (phrasesResult.error) throw new Error('Failed to query phrases: ' + phrasesResult.error.message)
  if (seedsResult.error) throw new Error('Failed to query seeds for listening: ' + seedsResult.error.message)
  if (bookendsResult.error) throw new Error('Failed to query listen bookends: ' + bookendsResult.error.message)
  if (podsResult.error) throw new Error('Failed to query pod sentences: ' + podsResult.error.message)

  // Stamp the revision suffix onto every audio-id column BEFORE anything below
  // reads one. Doing it here — once, on the fetched rows — rather than at the
  // dozens of places that copy an id onto a ScriptItem is the same trick the
  // server routes use (`stampRowAudioRefs` in api/_utils/audioAccess.ts), and
  // for the same reason: the ref is just a string that rides through untouched.
  // No-op (and no copy) when the course has no revised clips.
  if (revisedAudioRefs.size > 0) {
    legosResult.data = stampRowAudioRefs(revisedAudioRefs, legosResult.data || [])
    phrasesResult.data = stampRowAudioRefs(revisedAudioRefs, phrasesResult.data || [])
    seedsResult.data = stampRowAudioRefs(revisedAudioRefs, seedsResult.data || [])
    bookendsResult.data = stampRowAudioRefs(revisedAudioRefs, bookendsResult.data || [])
    podsResult.data = stampRowAudioRefs(revisedAudioRefs, podsResult.data || [])
    console.log(`[generateLearningScript] ${revisedAudioRefs.size} revised clip(s) in ${courseCode} — audio refs stamped`)
  }

  // Map bookend role → audio (used in Phase 6 to wrap the listening batch).
  // Both intro and outro must exist for either to be emitted.
  interface BookendAudio { id: string; text: string; duration_ms?: number }
  const bookendByRole = new Map<string, BookendAudio>()
  for (const row of (bookendsResult.data || []) as Array<{ role: string; text: string; id: string; duration_ms?: number }>) {
    bookendByRole.set(row.role, { id: row.id, text: row.text, duration_ms: row.duration_ms })
  }
  const listenIntroAudio = bookendByRole.get('bookend_listen_intro')
  const listenOutroAudio = bookendByRole.get('bookend_listen_outro')
  const hasBookends = !!(listenIntroAudio && listenOutroAudio)

  // (Audio-ID fallback layer removed 2026-05-03. It scanned up to 20K rows
  // from course_audio per script generation to patch NULL audio_id columns
  // left behind by the dashboard's text-edit trigger, and was the heaviest
  // query in the trio for big courses — tipping Estonian / Basque over
  // Postgres' statement timeout. The fix lives upstream in the dashboard:
  // close the re-link gap when fresh audio lands. Until then, phrases with
  // NULL audio IDs are gracefully skipped by the downstream filters.)

  // -------------------------------------------------------------------------
  // Listening Layers.
  //
  //   Layer 2 (Pod 0):  fires every POD_ROUND_INTERVAL rounds (default 5)
  //                     from podActivationRound onward. Runtime-scheduled
  //                     by usePodLapScheduler. Pod-round counts fires,
  //                     not main-rounds. Stage table unchanged.
  //   Layer 1:          REMOVED from main flow 2026-05-19, replaced by the
  //                     runtime 30-cup wheel (useLayer1Scheduler.ts).
  //                     Graduated seeds are still tracked here
  //                     (graduatedSeeds) purely to gate SEED-PHASE
  //                     production review continuation — see the
  //                     SPACED REP phase below.
  // -------------------------------------------------------------------------
  const POD_ACTIVATION_ROUND = listeningConfig.podActivationRound ?? 6
  const POD_ROUND_INTERVAL = Math.max(1, Math.floor(podRoundInterval))
  type PodPlayRole = 'ps08x' | 'ps' | 'ps15x' | 'ps2x' | 'trans'
  // Stage playlists per Aran's road-test 2026-05-05. PS = pod sentence at
  // 1.0×, PS×2 at 2.0×, trans = English translation. Stage 1 stays all 1.0×;
  // 2× kicks in from stage 2. Stages 1–6 each last 5 pod-rounds (was 3);
  // stage 7 is the eternal holding bay.
  const STAGE_PLAYLIST: Record<number, PodPlayRole[]> = {
    1: ['ps', 'trans', 'ps', 'ps'],
    2: ['ps', 'trans', 'ps2x', 'ps2x'],
    3: ['ps', 'trans', 'ps2x'],
    4: ['ps2x', 'trans', 'ps2x'],
    5: ['ps', 'ps2x'],
    6: ['ps2x', 'ps2x'],
    7: ['ps2x'],
  }
  const STAGE_DURATION = 5
  function podStageFor(entryPodRound: number, currentPodRound: number): { stage: number; iter: number | null } | null {
    const alive = currentPodRound - entryPodRound + 1
    if (alive < 1) return null
    for (let stage = 1; stage <= 6; stage++) {
      const stageEnd = stage * STAGE_DURATION
      if (alive <= stageEnd) {
        return { stage, iter: alive - (stage - 1) * STAGE_DURATION }
      }
    }
    return { stage: 7, iter: null }
  }
  interface PodSentenceRow {
    global_order: number
    target_text: string
    known_text: string
    target_audio_id: string | null
    known_audio_id: string | null
  }
  const podSentences = (podsResult.data || []) as PodSentenceRow[]
  const hasPods = podSentences.length > 0

  // Pod-round counts actual fires, not player rounds. With interval N, a
  // pod-lap only fires on rounds where (mainRound - activation) % N === 0;
  // the pod-round increments by 1 per fire (so stage clocks still measure
  // laps, not session-rounds). Non-firing rounds map to 0.
  function podRoundForMainRound(mainRound: number): number {
    if (mainRound < POD_ACTIVATION_ROUND) return 0
    const offset = mainRound - POD_ACTIVATION_ROUND
    if (offset % POD_ROUND_INTERVAL !== 0) return 0
    return Math.floor(offset / POD_ROUND_INTERVAL) + 1
  }
  function l2FiresAt(round: number): boolean {
    if (!hasPods || round < POD_ACTIVATION_ROUND) return false
    return (round - POD_ACTIVATION_ROUND) % POD_ROUND_INTERVAL === 0
  }

  // Compute lap items for a given main-course round. Returns false when pods
  // not activated, course has none, or pod-0 has been fully introduced and
  // no sentence is in any stage (shouldn't happen since stage 7 is eternal).
  // Caller is responsible for gating on l2FiresAt(round).
  function emitPodLap(mainRoundNumber: number, cycleCounter: { v: number }): boolean {
    if (!hasPods) return false
    const podRound = podRoundForMainRound(mainRoundNumber)
    if (podRound < 1) return false
    const TOTAL = podSentences.length
    const activeCount = Math.min(podRound, TOTAL)
    if (activeCount < 1) return false

    // Pre-flight: collect plays so we can decide whether to emit bookends.
    const plays: Array<{ i: number; sentence: PodSentenceRow; playRole: PodPlayRole }> = []
    for (let i = 1; i <= activeCount; i++) {
      const sentence = podSentences[i - 1]
      if (!sentence.target_audio_id) continue
      const stageInfo = podStageFor(i, podRound)
      if (!stageInfo) continue
      for (const playRole of STAGE_PLAYLIST[stageInfo.stage]) {
        if (playRole === 'trans' && !sentence.known_audio_id) continue
        plays.push({ i, sentence, playRole })
      }
    }
    if (plays.length === 0) return false

    if (hasBookends && listenIntroAudio) {
      cycleCounter.v++
      emitItem({
        uuid: `listen_intro_pod_R${String(mainRoundNumber).padStart(4, '0')}_${cycleCounter.v}`,
        cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'listen_intro',
        knownText: listenIntroAudio.text,
        targetText: '',
        knownAudioId: listenIntroAudio.id,
        isNew: false,
      })
    }
    for (const { i, sentence, playRole } of plays) {
      cycleCounter.v++
      const cyc = cycleCounter.v
      const speed = ROLE_SPEED[playRole] ?? 1.0
      const isTrans = playRole === 'trans'
      emitItem({
        uuid: `pod_R${String(mainRoundNumber).padStart(4, '0')}_S${String(i).padStart(3, '0')}_${playRole}_${cyc}`,
        cycleNum: cyc, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'pod',
        knownText: isTrans ? sentence.known_text : '',
        targetText: isTrans ? '' : sentence.target_text,
        knownAudioId: isTrans ? (sentence.known_audio_id || undefined) : undefined,
        target1Id: isTrans ? undefined : (sentence.target_audio_id || undefined),
        isNew: false,
        playbackSpeed: speed,
      })
    }
    if (hasBookends && listenOutroAudio) {
      cycleCounter.v++
      emitItem({
        uuid: `listen_outro_pod_R${String(mainRoundNumber).padStart(4, '0')}_${cycleCounter.v}`,
        cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'listen_outro',
        knownText: listenOutroAudio.text,
        targetText: '',
        knownAudioId: listenOutroAudio.id,
        isNew: false,
      })
    }
    return true
  }

  // Build seed map for listening phase
  interface SeedData {
    seed_number: number
    known_text: string
    target_text: string
    target_text_roman?: string
    known_audio_id?: string
    target1_audio_id?: string
    target2_audio_id?: string
  }
  const seedMap = new Map<number, SeedData>()
  for (const seed of (seedsResult.data || []) as SeedData[]) {
    seedMap.set(seed.seed_number, seed)
  }

  // FLAG: LEGOs with bracket explanations (these shouldn't exist in production)
  const bracketPattern = /\[.*?\]/
  const legosWithBrackets = (legosResult.data || []).filter(
    (l: any) => bracketPattern.test(l.known_text) || bracketPattern.test(l.target_text)
  )
  if (legosWithBrackets.length > 0) {
    console.warn(`[generateLearningScript] ${legosWithBrackets.length} LEGOs with bracket explanations`)
  }

  // Group phrases by LEGO into BUILD and USE pools
  interface Phrase {
    seed_number: number
    lego_index: number
    known_text: string
    target_text: string
    target_text_roman?: string
    phrase_role: string
    target_syllable_count?: number
    position?: number
    known_audio_id?: string
    target1_audio_id?: string
    target2_audio_id?: string
    presentation_audio_id?: string
    target1_duration_ms?: number
    target2_duration_ms?: number
    introduce?: boolean
    decomposition?: Array<{ legoId: string | null; target: string; known: string; isGhost: boolean; isSalient?: boolean }> | null
    display_tiling?: Array<{ n: string; r: string; salient?: boolean }> | null
  }
  const phrasesByLego = new Map<string, { build: Phrase[]; use: Phrase[]; practice: Phrase[] }>()
  // Collect M-LEGO component breakdowns: legoKey → [{known, target}, ...]
  const componentsByLego = new Map<string, Array<{ known: string; target: string }>>()
  const componentsByLegoNative = new Map<string, Array<{ known: string; target: string }>>()
  // Full component phrases with audio IDs for component priming
  const componentPhrasesByLego = new Map<string, Phrase[]>()
  // Same audio-completeness invariant as LEGOs: a phrase used in a cycle
  // must have all three audio IDs. Visual-only component tiles
  // (introduce === false, shown on intro cards without audio playback)
  // are exempt — they're purely presentational.
  const phraseHasFullAudio = (p: Phrase): boolean =>
    !!(p.known_audio_id && p.target1_audio_id && p.target2_audio_id)
  // Untranslatable component particles (Chinese 了/的/得 etc.) intentionally
  // have empty known_text and no known_audio_id — they're function words
  // with no English equivalent. They're skipped from audio cycles by design,
  // not because of a missing-audio bug. Don't count them in the warning.
  const isIntentionalParticleSkip = (p: Phrase): boolean =>
    p.phrase_role === 'component' && (!p.known_text || p.known_text.trim() === '')
  let phrasesSkippedForAudio = 0
  let particleSkips = 0
  for (const phrase of (phrasesResult.data || []) as Phrase[]) {
    await yieldTick()
    const key = `${phrase.seed_number}:${phrase.lego_index}`
    if (!phrasesByLego.has(key)) phrasesByLego.set(key, { build: [], use: [], practice: [] })
    const group = phrasesByLego.get(key)!
    if (phrase.phrase_role === 'component') {
      // Visual tiles on intro/debut — ALL components (even introduce=false)
      if (!componentsByLego.has(key)) componentsByLego.set(key, [])
      componentsByLego.get(key)!.push({ known: phrase.known_text, target: phrase.target_text_roman || phrase.target_text })
      // Store native script variant when romanized exists
      if (phrase.target_text_roman) {
        if (!componentsByLegoNative.has(key)) componentsByLegoNative.set(key, [])
        componentsByLegoNative.get(key)!.push({ known: phrase.known_text, target: phrase.target_text })
      }
      // Audio cycles (component_intro/component_practice) — only introduced components with full audio
      if (phrase.introduce !== false) {
        if (!phraseHasFullAudio(phrase)) {
          if (isIntentionalParticleSkip(phrase)) particleSkips++
          else phrasesSkippedForAudio++
          continue
        }
        if (!componentPhrasesByLego.has(key)) componentPhrasesByLego.set(key, [])
        componentPhrasesByLego.get(key)!.push(phrase)
      }
      continue
    }
    if (!phraseHasFullAudio(phrase)) {
      phrasesSkippedForAudio++
      continue
    }
    if (phrase.phrase_role === 'build') group.build.push(phrase)
    else if (phrase.phrase_role === 'use') group.use.push(phrase)
    else if (phrase.phrase_role === 'practice') group.practice.push(phrase)
  }
  if (phrasesSkippedForAudio > 0) {
    console.warn(`[generateLearningScript] Skipped ${phrasesSkippedForAudio} practice phrases for "${courseCode}" (missing audio IDs)`)
  }
  if (particleSkips > 0) {
    console.debug(`[generateLearningScript] Skipped ${particleSkips} untranslatable particles for "${courseCode}" (intentional)`)
  }

  console.log(`[generateLearningScript] ${phrasesResult.data?.length || 0} phrases fetched, ${componentsByLego.size} LEGOs with components`)

  // Classify legacy 'practice' phrases per LEGO:
  // - If the LEGO already has explicit USE phrases, practice → BUILD (fragments, drill once)
  // - If the LEGO has NO USE phrases, practice → USE (so it has spaced rep material)
  for (const [, group] of phrasesByLego.entries()) {
    if (group.practice.length === 0) continue
    if (group.use.length > 0) {
      group.build.push(...group.practice)
    } else {
      group.use.push(...group.practice)
    }
    group.practice = []
  }

  // Sort BUILD phrases shortest-first and apply the mode's phrase-length cap
  // — the twin of the USE sort below; both must move together or a round's
  // BUILD and USE halves disagree about length. capPhrasesByLength falls back
  // to that LEGO's shortest phrases rather than starve the round. The floor is
  // the methodology's per-LEGO minimum (4 BUILD / 5 USE), NOT the round's
  // ceiling: passing the ceiling makes the guard swallow the cap on every LEGO
  // smaller than it, which is most of them (BUILD pools average 3.2 phrases).
  // One ceiling for the whole run, from every pool the learner can meet.
  const PHRASE_LENGTH_LIMIT = PHRASE_LENGTH_FRACTION >= 1
    ? Infinity
    : courseMaxPhraseLength<Phrase>(
        [...phrasesByLego.values()].flatMap((g) => [g.build, g.use]),
        phraseLengthOf,
      ) * PHRASE_LENGTH_FRACTION

  // Easy passes filterBuildPhrases:false and so keeps its whole BUILD pool,
  // shortest-first but uncut — "no filtering on BLD phrases" (Tom,
  // 2026-08-07). Passing Infinity rather than branching keeps the sort in one
  // place: capPhrasesByLength with no finite limit IS the plain historic sort.
  for (const [, group] of phrasesByLego.entries()) {
    group.build = capPhrasesByLength<Phrase>(
      group.build,
      phraseSyllables,
      phraseLengthOf,
      FILTER_BUILD_PHRASES ? PHRASE_LENGTH_LIMIT : Infinity,
      MIN_BUILD_PHRASES_AFTER_CAP,
    )
  }

  // Organize LEGOs by seed
  interface Lego {
    seed_number: number
    lego_index: number
    known_text: string
    target_text: string
    target_text_roman?: string
    type: string
    is_new: boolean
    known_audio_id?: string
    target1_audio_id?: string
    target2_audio_id?: string
    presentation_audio_id?: string
    target1_duration_ms?: number
    target2_duration_ms?: number
  }
  const allLegosRaw = (legosResult.data || []) as Lego[]
  // Invariant (unchanged): never SCHEDULE an unplayable cycle. Partial-import
  // courses (e.g. Greek 2026-04) had LEGOs with NULL target audio, which
  // caused silent play.
  //
  // What changed 2026-08-06 is the GRANULARITY. This used to drop the whole
  // LEGO from the walk, which cost far more than the missing clip: round
  // numbers are assigned after this point, so one gap slid every later round
  // down by one and re-paired the entire Fibonacci review schedule
  // (fra_for_eng, from round 47), and a partial import amputated the course
  // outright (ara_lb_for_eng lost 776 of 1414 rounds — the player simply
  // stopped). A course must always play what it HAS.
  //
  // So every LEGO now keeps its round and its round NUMBER and enters
  // legoState for later review; the audio invariant is enforced per ITEM at
  // emit time (introIsPlayable / debutIsPlayable below), exactly as phrase
  // rows already are. A round that loses its intro/debut keeps its build,
  // use, review and consolidate cycles. If a round ends up with nothing
  // playable at all, toSimpleRounds drops it (its `cycles.length === 0`
  // guard) and SimplePlayer — which walks rounds by array index, not by
  // round number — carries on; it also advances defensively on an empty
  // round, so a hole can't stall playback.
  const allLegos = allLegosRaw

  // Backfill missing presentation_audio_id from course_audio / lego_introductions
  // Some courses have presentation audio generated but not yet linked to course_legos
  const legosMissingPresentation = allLegos.filter(l => l.is_new && !l.presentation_audio_id)
  if (legosMissingPresentation.length > 0) {
    const missingLegoIds = legosMissingPresentation.map(l =>
      `S${String(l.seed_number).padStart(4, '0')}L${String(l.lego_index).padStart(2, '0')}`
    )

    // Try course_audio first (authoritative), then lego_introductions (legacy)
    const [courseAudioResult, introResult] = await Promise.all([
      supabase
        .from('course_audio')
        .select('id, lego_id')
        .eq('course_code', courseCode)
        .eq('role', 'presentation')
        .in('lego_id', missingLegoIds),
      supabase
        .from('lego_introductions')
        .select('lego_id, presentation_audio_id, audio_uuid')
        .eq('course_code', courseCode)
        .in('lego_id', missingLegoIds)
    ])

    // Build lookup: lego_id → audio ID (prefer course_audio.id, fallback to lego_introductions)
    const presLookup = new Map<string, string>()
    for (const row of (introResult.data || []) as any[]) {
      const audioId = row.presentation_audio_id || row.audio_uuid
      if (audioId) presLookup.set(row.lego_id, String(audioId))
    }
    for (const row of (courseAudioResult.data || []) as any[]) {
      if (row.id && row.lego_id) presLookup.set(row.lego_id, row.id)  // overwrites legacy
    }

    if (presLookup.size > 0) {
      console.debug(`[generateLearningScript] Backfilled ${presLookup.size}/${legosMissingPresentation.length} missing presentation audio IDs`)
      for (const lego of legosMissingPresentation) {
        const legoId = `S${String(lego.seed_number).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
        // Stamped on the way in: this lookup was built from queries issued
        // AFTER the bulk stamping pass above, so its ids are still bare.
        const audioId = applyAudioRef(revisedAudioRefs, presLookup.get(legoId))
        if (audioId) lego.presentation_audio_id = audioId
      }
    } else if (legosMissingPresentation.length > 0) {
      console.warn(`[generateLearningScript] ${legosMissingPresentation.length} LEGOs missing presentation audio (not in course_audio or lego_introductions)`)
    }
  }

  const legosBySeed = new Map<number, Lego[]>()
  for (const lego of allLegos) {
    if (!legosBySeed.has(lego.seed_number)) legosBySeed.set(lego.seed_number, [])
    legosBySeed.get(lego.seed_number)!.push(lego)
  }

  // Diagnostic: report what was loaded. Per-item audio suppression is counted
  // during the walk and reported after it (introsSkippedForAudio /
  // debutsSkippedForAudio) — a LEGO short of one clip no longer costs a round.
  if (allLegosRaw.length === 0) {
    console.warn(`[generateLearningScript] No LEGOs found for course "${courseCode}"`)
  }
  let introsSkippedForAudio = 0
  let debutsSkippedForAudio = 0

  const sortedSeedNums = Array.from(legosBySeed.keys()).sort((a, b) => a - b)
  interface LegoState {
    lastRound: number
    usePhrases: Phrase[]
    useIndex: number
    seedNum: number
    legoIndex: number
    lego: Lego
  }
  const legoState = new Map<string, LegoState>()
  const items: ScriptItem[] = []
  let cycleNum = 0
  let roundNumber = 0

  // Listening phase state.
  // Graduation is anchored to absolute LEGO position in the course
  // catalogue, NOT chunk-local roundNumber. The chunk's roundNumber
  // resets to 0 every script generation, so the old `seedLastRound`
  // map was incomplete whenever a chunk didn't start at seed 1 (belt
  // skip, partial loads) — earlier seeds never entered the map and
  // never graduated, so L1 silently never fired. Catalogue ordinals
  // are stable: pos(S0001L01) = 1, pos(S0001L02) = 2, ... regardless
  // of which chunk is being generated.
  const seedLastLegoOrdinal = new Map<number, number>()  // seedNum → ordinal of its highest-index LEGO
  const legoOrdinalMap = new Map<string, number>()       // legoKey → ordinal
  {
    const catalogue = (catalogueResult.data || []) as Array<{ seed_number: number; lego_index: number }>
    let ord = 0
    for (const row of catalogue) {
      ord++
      const k = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
      legoOrdinalMap.set(k, ord)
      // Final write for each seed wins → that's the seed's last-LEGO ordinal
      // because the query is ordered by (seed_number, lego_index).
      seedLastLegoOrdinal.set(row.seed_number, ord)
    }
  }
  let currentLegoOrdinal = 0  // updated as each LEGO is introduced in the walk
  // Graduated-seed tracking: gates SEED-PHASE production review continuation
  // (reviewItemIsSeed) once a seed's use-phrase review has lapsed — see the
  // SPACED REP phase below. (The L1 fire-count/stage/urn machinery that used
  // to read this was deleted 2026-07-14 — dead since the 2026-05-19 L1
  // main-flow removal; L1 listening now lives in the runtime 30-cup wheel,
  // useLayer1Scheduler.ts.)
  const graduatedSeeds = new Set<number>()         // idempotency check

  // Build LEGO text map for phrase decomposition (normalised target text → LEGO key)
  // Uses ALL LEGOs (not just is_new) since reused LEGOs are still valid vocabulary
  const legoTextMap = new Map<string, string>()
  for (const lego of allLegos) {
    const legoKey = `S${String(lego.seed_number).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
    const normalized = normalizeText(lego.target_text)
    if (normalized) legoTextMap.set(normalized, legoKey)
    // Also index by romanized text so phrases using target_text_roman can decompose
    if (lego.target_text_roman) {
      const normalizedRoman = normalizeText(lego.target_text_roman)
      if (normalizedRoman && !legoTextMap.has(normalizedRoman)) {
        legoTextMap.set(normalizedRoman, legoKey)
      }
    }
  }

  // Reverse map: LEGO key → display text (prefer romanized for display when available)
  const legoIdToText = new Map<string, string>()
  // Native script map: LEGO key → native text (only populated when romanized exists)
  const legoIdToTextNative = new Map<string, string>()
  for (const lego of allLegos) {
    const legoKey = `S${String(lego.seed_number).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
    if (lego.target_text) legoIdToText.set(legoKey, lego.target_text_roman || lego.target_text)
    if (lego.target_text_roman) legoIdToTextNative.set(legoKey, lego.target_text)
  }

  // Greedy longest-match decomposition of a phrase into component LEGO IDs
  // Supports both space-separated languages and CJK (no spaces)
  const cjkRegex = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/
  const isCJK = (text: string) => cjkRegex.test(text)

  // Track synthetic (on-the-fly) LEGOs for unmatched text
  let syntheticCounter = 0
  const syntheticLegoMap = new Map<string, string>() // normalized text → synthetic ID

  const getOrCreateSyntheticLego = (text: string): string => {
    const existing = syntheticLegoMap.get(text)
    if (existing) return existing
    const id = `_SYN${String(++syntheticCounter).padStart(4, '0')}`
    syntheticLegoMap.set(text, id)
    legoIdToText.set(id, text)
    return id
  }

  const decomposePhrase = (targetText: string): string[] => {
    const normalized = normalizeText(targetText)
    if (!normalized) return []

    // CJK: character-level sliding window (no spaces to split on)
    if (isCJK(normalized)) {
      const chars = [...normalized] // proper Unicode split
      const result: string[] = []
      let i = 0
      while (i < chars.length) {
        let longestMatch: string | null = null
        let longestLength = 0
        for (let len = chars.length - i; len > 0; len--) {
          const candidate = chars.slice(i, i + len).join('')
          const legoId = legoTextMap.get(candidate)
          if (legoId) {
            longestMatch = legoId
            longestLength = len
            break
          }
        }
        if (longestMatch) {
          result.push(longestMatch)
          i += longestLength
        } else {
          // Create synthetic LEGO for this character
          const char = chars[i]
          result.push(getOrCreateSyntheticLego(char))
          i++
        }
      }
      return result
    }

    // Space-separated languages: word-level sliding window
    const words = normalized.split(/\s+/).filter(w => w.length > 0)
    const result: string[] = []
    let i = 0
    while (i < words.length) {
      let longestMatch: string | null = null
      let longestLength = 0
      for (let len = words.length - i; len > 0; len--) {
        const candidate = words.slice(i, i + len).join(' ')
        const legoId = legoTextMap.get(candidate)
        if (legoId) {
          longestMatch = legoId
          longestLength = len
          break
        }
      }
      if (longestMatch) {
        result.push(longestMatch)
        i += longestLength
      } else {
        // Create synthetic LEGO for this word
        result.push(getOrCreateSyntheticLego(words[i]))
        i++
      }
    }
    return result
  }

  // Track intros missing presentation audio (logged as summary at end, not per-item)
  const introsMissingAudio: string[] = []

  // Always-true emit gate. The full-course refactor drops emit windowing —
  // the script generator is now one-shot whole-course. The player handles
  // resume-from-position via cursor jumps, not by skipping early items in
  // the script. Helper retained as a no-op for now so the in-loop call
  // sites below don't need editing in this pass.
  const shouldEmit = () => true
  const emitItem = (item: ScriptItem) => {
    if (item.type === 'intro' || item.type === 'component_intro') {
      // Intros ALWAYS pass — they define the round structure.
      // Missing presentation audio is handled by SimplePlayer (skips empty prompt phase).
      // Target voice1/voice2 still play to introduce the LEGO pronunciation.
      if (!item.presentationAudioId && !item.knownAudioId && item.type === 'intro') {
        introsMissingAudio.push(item.legoKey || 'unknown')
      }
    } else if (item.type === 'listening') {
      // Listening items only need target audio (passive listening, no known prompt)
      if (!item.target1Id) return
    } else if (item.type === 'listen_intro' || item.type === 'listen_outro') {
      // Bookends play one known-language clip — no target voices, no pause.
      // The audio is stored under knownAudioId so SimplePlayer's prompt phase
      // picks it up; voice1/voice2 are intentionally absent.
      if (!item.knownAudioId) return
    } else if (item.type === 'pod') {
      // Pod plays carry exactly one of {knownAudioId (translation play),
      // target1Id (sentence play, possibly with playbackSpeed=2.0)}. Never
      // both, never target2Id. The "all three audio IDs" check below would
      // wrongly drop every pod item, leaving the round-end lap empty.
      if (!item.knownAudioId && !item.target1Id) return
    } else if (item.type === 'spaced_rep' && item.reviewItemKind === 'seed') {
      // Drained SEED-PHASE review sub-cycles (the t→k→t→t sandwich, see
      // emitSeedSandwich): same single-audio shape as pod plays — exactly
      // one of {knownAudioId, target1Id}, never target2Id.
      if (!item.knownAudioId && !item.target1Id) return
    } else {
      // Non-intro items need all three audio IDs to be useful
      if (!item.knownAudioId || !item.target1Id || !item.target2Id) return
    }
    items.push(item)
  }

  // Whether this course has any romanized text (for toggle detection)
  const courseHasRomanized = legoIdToTextNative.size > 0

  // Helper: returns native text fields when romanized text exists
  // Spread onto every emitted item. Carries the native-script variant AND, for
  // phrase-sourced items, the authoritative content-level tiling served verbatim
  // on course_practice_phrases.decomposition (LEGO/seed callers lack the field,
  // so it's simply omitted there). The player renders it directly when present.
  const nativeFields = (item: {
    target_text?: string
    target_text_roman?: string
    decomposition?: Array<{ legoId: string | null; target: string; known: string; isGhost: boolean; isSalient?: boolean }> | null
    display_tiling?: Array<{ n: string; r: string; salient?: boolean }> | null
  }) => ({
    ...(item.target_text_roman ? { targetTextNative: item.target_text } : {}),
    ...(Array.isArray(item.decomposition) && item.decomposition.length > 0
      ? { decomposition: item.decomposition }
      : {}),
    ...(Array.isArray(item.display_tiling) && item.display_tiling.length > 0
      ? { displayTiling: item.display_tiling }
      : {}),
  })

  /**
   * Drained/eternal SEED-PHASE review (offset ≥144): the comprehensible-input
   * sandwich — target → known → target → target, all @1× (Tom + Aran,
   * 2026-07-14). Mirrors the Layer-1 listening cups sandwich: a seed this far
   * through spaced rep no longer needs an active-recall gap, so this emits
   * FOUR single-audio sub-cycles (the same per-role split the pod/listening
   * cycles use — see toSimpleRounds.ts's singleAudio flag) instead of the
   * standard prompt/pause/voice1/voice2 production cycle.
   * Known slot is omitted — never silenced — when the seed has no known audio.
   */
  const emitSeedSandwich = (
    seed: SeedData,
    base: {
      reviewKey: string; reviewSeedId: string; reviewLegoNum: string
      roundNumber: number; fibPosition: number; reviewOf: number; uuidPrefix: string
    },
    bumpCycle: () => number,
  ): void => {
    const roles: Array<'target' | 'known'> = seed.known_audio_id
      ? ['target', 'known', 'target', 'target']
      : ['target', 'target', 'target']
    for (const role of roles) {
      const cycleNum = bumpCycle()
      emitItem({
        uuid: `${base.uuidPrefix}_${cycleNum}`,
        cycleNum, roundNumber: base.roundNumber, seedId: base.reviewSeedId, legoKey: base.reviewKey,
        seedCode: base.reviewSeedId, legoCode: base.reviewLegoNum,
        type: 'spaced_rep',
        reviewItemKind: 'seed',
        knownText: seed.known_text,
        targetText: seed.target_text_roman || seed.target_text,
        ...nativeFields(seed),
        ...(role === 'known' ? { knownAudioId: seed.known_audio_id } : { target1Id: seed.target1_audio_id }),
        isNew: false,
        fibPosition: base.fibPosition,
        reviewOf: base.reviewOf,
        playbackSpeed: 1.0,
      })
    }
  }

  // Process each seed
  for (const seedNum of sortedSeedNums) {
    // Only process LEGOs that are NEW (is_new = true)
    // LEGOs with is_new = false were already introduced in earlier seeds
    const seedLegos = legosBySeed.get(seedNum)!
      .filter(l => l.is_new)
      .sort((a, b) => a.lego_index - b.lego_index)

    for (const lego of seedLegos) {
      await yieldTick()
      roundNumber++
      const legoKey = `S${String(seedNum).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
      const seedId = `S${String(seedNum).padStart(4, '0')}`
      const legoNum = String(lego.lego_index).padStart(2, '0')
      const phraseKey = `${seedNum}:${lego.lego_index}`
      const phrases = phrasesByLego.get(phraseKey) || { build: [], use: [] }
      // presentation_audio_id comes directly from course_legos (or backfilled above)
      const presentationAudioId = lego.presentation_audio_id
      // Fallback: if no presentation audio, use known_audio_id so the intro still plays
      // the LEGO itself (known → target1 → target2, no pause) — learner hears it passively
      // before the debut asks them to produce it.
      const introAudioId = presentationAudioId || lego.known_audio_id

      const usedPhrasesThisRound = new Set<string>()
      const legoComponents = componentsByLego.get(phraseKey)
      const legoComponentsNative = componentsByLegoNative.get(phraseKey)

      // Per-ITEM audio invariant (see the allLegos comment above). The intro
      // plays prompt → target1 → target2 with no pause, so it needs a prompt
      // clip (presentation, or known as the documented fallback) and the first
      // target voice; a missing second voice is a phase SimplePlayer skips
      // gracefully, as bookends already rely on. The debut asks the learner to
      // produce, so it needs all three — the same rule toSimpleRounds applies
      // to every non-intro cycle, applied here so we never schedule one it
      // would only drop.
      const introIsPlayable = !!(introAudioId && lego.target1_audio_id)
      const debutIsPlayable = !!(lego.known_audio_id && lego.target1_audio_id && lego.target2_audio_id)
      if (!introIsPlayable) introsSkippedForAudio++
      if (!debutIsPlayable) debutsSkippedForAudio++

      // Phase 1: INTRO
      // The M-LEGO is the cognitive unit. For M-LEGOs the per-component breakdown
      // is rendered as ghost text under each target word (visual scaffolding) — we
      // do NOT pre-introduce components with their own audio cycles. A-LEGOs just
      // get a standard intro.
      if (introIsPlayable) {
        cycleNum++
        emitItem({
          uuid: `${legoKey}_intro_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'intro',
          knownText: lego.known_text,
          targetText: lego.target_text_roman || lego.target_text,
          ...nativeFields(lego),
          presentationAudioId: introAudioId,
          target1Id: lego.target1_audio_id,
          target2Id: lego.target2_audio_id,
          target1DurationMs: lego.target1_duration_ms,
          target2DurationMs: lego.target2_duration_ms,
          isNew: true,
          ...(legoComponents ? { components: legoComponents } : {}),
          ...(legoComponentsNative ? { componentsNative: legoComponentsNative } : {}),
        })
      }

      // Phase 2: DEBUT
      if (debutIsPlayable) {
        cycleNum++
        emitItem({
          uuid: `${legoKey}_debut_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'debut',
          knownText: lego.known_text,
          targetText: lego.target_text_roman || lego.target_text,
          ...nativeFields(lego),
          knownAudioId: lego.known_audio_id,
          target1Id: lego.target1_audio_id,
          target2Id: lego.target2_audio_id,
          target1DurationMs: lego.target1_duration_ms,
          target2DurationMs: lego.target2_duration_ms,
          isNew: true,
          ...(legoComponents ? { components: legoComponents } : {}),
          ...(legoComponentsNative ? { componentsNative: legoComponentsNative } : {}),
        })
      }
      // The debut IS the bare LEGO — claim it so no later phase replays it. Some
      // courses carry a build row whose text equals its own LEGO (deu_for_eng
      // S0001L01 'I want / ich will'); playing that as a BUILD breaks the rule that
      // a BUILD is the new LEGO plugged into ALREADY-KNOWN vocabulary, and burns a
      // build slot a real phrase should have had. Mirrors the dashboard generator
      // (services/learning-script-generator.cjs).
      usedPhrasesThisRound.add(getPhraseId(lego.known_text, lego.target_text))

      // Phase 3: BUILD phrases up to 7
      let practiceCount = 0
      const usedForPractice = new Set<string>()

      for (const phrase of phrases.build) {
        if (practiceCount >= MAX_BUILD_PHRASES) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        // Skip BEFORE consuming a build slot, so a skipped row costs nothing.
        if (usedPhrasesThisRound.has(phraseId)) continue
        cycleNum++
        practiceCount++
        usedPhrasesThisRound.add(phraseId)
        emitItem({
          uuid: `${legoKey}_build_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'build',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true,
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text),
        })
      }

      // Fill remaining BUILD slots with USE phrases (BUILD priority > CONSOLIDATE)
      // CONSOLIDATE can repeat BUILD phrases if needed — filling 7 BUILD is non-negotiable
      // Twin of the BUILD sort above — same shortest-first order, same cap.
      // 'needed' is only the slots still unfilled, so the starvation guard
      // measures against what this round actually has to place.
      const sortedUsePhrases = capPhrasesByLength<Phrase>(
        phrases.use,
        phraseSyllables,
        phraseLengthOf,
        PHRASE_LENGTH_LIMIT,
        MIN_USE_PHRASES_AFTER_CAP,
      )
      for (const phrase of sortedUsePhrases) {
        if (practiceCount >= MAX_BUILD_PHRASES) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue

        cycleNum++
        practiceCount++
        usedPhrasesThisRound.add(phraseId)
        usedForPractice.add(phraseId)
        emitItem({
          uuid: `${legoKey}_build_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'build',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true,
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text),
        })
      }

      // Initialize LEGO state.
      // The review pool gets the SAME cap. It has to: spaced rep walks this
      // pool round-robin (useIndex % length), so it is the only place a LEGO's
      // LONGEST phrases ever reach the learner — the debut BUILD/USE fills
      // above take a shortest-first prefix and would ignore a cap entirely.
      // Guard against an N-1 review's worth, the largest single draw.
      legoState.set(legoKey, {
        lastRound: roundNumber,
        usePhrases: capPhrasesByLength<Phrase>(
          phrases.use,
          phraseSyllables,
          phraseLengthOf,
          PHRASE_LENGTH_LIMIT,
          MIN_USE_PHRASES_AFTER_CAP,
        ),
        useIndex: 0,
        seedNum, legoIndex: lego.lego_index, lego
      })

      // Update absolute LEGO ordinal for graduation tracking. Catalogue
      // lookup, NOT chunk-local roundNumber — see seedLastLegoOrdinal
      // comment for why.
      currentLegoOrdinal = legoOrdinalMap.get(legoKey) ?? currentLegoOrdinal

      // Phase 4: SPACED REP
      const dueForReview: { key: string; state: LegoState; fibPosition: number; phraseCount: number }[] = []
      const seenLegos = new Set<string>()

      for (let offsetIdx = 0; offsetIdx < SPACED_REP_OFFSETS.length; offsetIdx++) {
        const offset = SPACED_REP_OFFSETS[offsetIdx]
        const reviewRound = roundNumber - offset
        if (reviewRound < 1) break

        for (const [prevKey, state] of legoState.entries()) {
          if (prevKey === legoKey || seenLegos.has(prevKey)) continue
          // Graduated seeds drop out of use-phrase review, but stay eligible
          // for SEED-PHASE production review (offset ≥144) — nothing truly
          // retires; whole-sentence production continues at growing cadence.
          if (graduatedSeeds.has(state.seedNum) && !reviewItemIsSeed(offset)) continue
          if (state.lastRound === reviewRound) {
            const isN1 = offset === 1
            const phraseCount = isN1 ? N1_PHRASE_COUNT : 1
            dueForReview.push({ key: prevKey, state, fibPosition: offsetIdx, phraseCount })
            seenLegos.add(prevKey)
          }
        }
      }

      let spacedRepCount = 0
      for (const { key: reviewKey, state, fibPosition, phraseCount } of dueForReview) {
        if (spacedRepCount >= MAX_SPACED_REP_PHRASES) break

        const reviewLegoNum = reviewKey.match(/L(\d+)/)?.[1] || ''
        const reviewSeedId = reviewKey.match(/S\d+/)?.[0] || ''

        // SEED-PHASE review (offset ≥144): emit the FULL PARENT SEED SENTENCE
        // (drained comprehensible-input sandwich) instead of a use-phrase. One
        // review slot, not phraseCount (N-1 is never seed-phase). Falls back
        // to the use-phrase path if the seed row is missing or lacks target
        // audio — never an empty review.
        const reviewOffset = SPACED_REP_OFFSETS[fibPosition]
        if (reviewItemIsSeed(reviewOffset)) {
          const seed = seedMap.get(state.seedNum)
          if (seed && seed.target1_audio_id) {
            const seedPhraseId = getPhraseId(seed.known_text, seed.target_text)
            if (!usedPhrasesThisRound.has(seedPhraseId)) {
              usedPhrasesThisRound.add(seedPhraseId)
              spacedRepCount++
              emitSeedSandwich(seed, {
                reviewKey, reviewSeedId, reviewLegoNum, roundNumber, fibPosition,
                reviewOf: state.lastRound, uuidPrefix: `${reviewKey}_seed_rep`,
              }, () => ++cycleNum)
            }
            continue
          }
          // seed missing / no target audio → fall through to the use-phrase review
        }

        if (state.usePhrases.length === 0) continue

        // KNOWN-side pull filter (Tom, 2026-08-07): for the first
        // REVIEW_FILTER_MAX_ROUND rounds a review draws from the shorter half
        // of the LEGO's basket, measured in the learner's OWN language. Past
        // that round the basket opens fully — "it's the LEGO that you are
        // practicing", so a phrase never met before is no obstacle. Rotation
        // still walks useIndex round-robin, just over the eligible sub-basket.
        const reviewPool = filterReviewPool(state.usePhrases, roundNumber, REVIEW_PULL_FILTER)
        const phrasesToUse = Math.min(phraseCount, MAX_SPACED_REP_PHRASES - spacedRepCount, reviewPool.length)
        for (let i = 0; i < phrasesToUse; i++) {
          const phrase = reviewPool[state.useIndex % reviewPool.length]
          state.useIndex++

          const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
          if (usedPhrasesThisRound.has(phraseId)) continue
          usedPhrasesThisRound.add(phraseId)

          cycleNum++
          spacedRepCount++
          emitItem({
            uuid: `${reviewKey}_spaced_rep_${cycleNum}`,
            cycleNum, roundNumber, seedId: reviewSeedId, legoKey: reviewKey,
            seedCode: reviewSeedId, legoCode: reviewLegoNum,
            type: 'spaced_rep',
            knownText: phrase.known_text,
            targetText: phrase.target_text_roman || phrase.target_text,
            ...nativeFields(phrase),
            knownAudioId: phrase.known_audio_id,
            target1Id: phrase.target1_audio_id,
            target2Id: phrase.target2_audio_id,
            target1DurationMs: phrase.target1_duration_ms,
            target2DurationMs: phrase.target2_duration_ms,
            isNew: false,
            fibPosition,
            reviewOf: state.lastRound,
          })
        }
      }

      // Phase 5: CONSOLIDATE ×2 - prefer unused USE phrases, allow reuse if pool exhausted
      let consolidateCount = 0
      const emitConsolidate = (phrase: Phrase) => {
        consolidateCount++
        cycleNum++
        emitItem({
          uuid: `${legoKey}_use_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'use',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true,
        })
      }
      // CONSOLIDATE draws from the same known-side-filtered pool as review
      // (Tom named REVIEW and CONSOLIDATE together) — consolidate cycles ARE
      // use phrases. Debut BUILD/USE selection above is deliberately untouched.
      const consolidatePool = filterReviewPool(sortedUsePhrases, roundNumber, REVIEW_PULL_FILTER)
      // First pass: unused USE phrases
      for (const phrase of consolidatePool) {
        if (consolidateCount >= USE_CONSOLIDATION_COUNT) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue
        usedPhrasesThisRound.add(phraseId)
        emitConsolidate(phrase)
      }
      // Second pass: reuse USE phrases already used in BUILD (pool was too small)
      if (consolidateCount < USE_CONSOLIDATION_COUNT) {
        for (const phrase of consolidatePool) {
          if (consolidateCount >= USE_CONSOLIDATION_COUNT) break
          emitConsolidate(phrase)
        }
      }

      // Layer 1 main-flow emission was removed 2026-05-19 (now the runtime
      // 30-cup wheel, useLayer1Scheduler.ts). Graduation is still tracked
      // here purely to gate SEED-PHASE production review continuation
      // (reviewItemIsSeed) once a seed's use-phrase review has lapsed.
      if (listeningConfig.enabled) {
        for (const [sNum, lastOrd] of seedLastLegoOrdinal) {
          if (graduatedSeeds.has(sNum)) continue
          if (currentLegoOrdinal === 0) continue
          if (currentLegoOrdinal - lastOrd < listeningConfig.offset) continue
          graduatedSeeds.add(sNum)
        }
      }

      // L2 (pod laps) stays runtime-scheduled by usePodLapScheduler —
      // every POD_ROUND_INTERVAL rounds from podActivationRound onward,
      // independent of main-round arithmetic. The script's emitPodLap /
      // l2FiresAt / podStageFor / STAGE_PLAYLIST / podSentences /
      // podRoundForMainRound helpers are intentionally retained for
      // hot-fix rollback to the in-script L2 path.
    }
  }

  // ==========================================================================
  // INFINITE-PLAY ROUNDS — review-only rounds after all new LEGOs introduced
  // ==========================================================================
  //
  // The course never ends. Once the main loop has introduced every new LEGO
  // from the range, we keep incrementing roundNumber and emitting review
  // rounds shaped as:
  //
  //   - target ~TARGET_ROUND_CYCLES (20) cycles per round
  //   - spaced-rep fills first via the same N-1, N-2, ..., N-89 fib-offset
  //     logic as the main loop, capped at MAX_SPACED_REP_PHRASES
  //   - random USE fills the remainder, with a floor of MIN_RANDOM_USE (10):
  //     one phrase each from distinct LEGOs sampled uniformly at random
  //     across the whole debuted inventory. (Previously recency-tiered, but
  //     in infinite play every LEGO has been debuted, so a recency bias
  //     becomes topic clustering toward the back end of the course.)
  //     Random-USE selections are deduped against this round's spaced-rep set.
  //
  // We do NOT mutate lastRound on random USE — the fib decay drains
  // naturally. Long-tail steady state is pure recency-biased USE.
  //
  // How many infinite-play rounds we generate is `infinitePlayLookahead`
  // rounds beyond the main loop's last round. After the full-course
  // refactor this is always the same number (default 50) regardless of
  // where the learner is — the script is one-shot whole-course; the
  // player consumes from wherever its cursor lands.

  // Canonical INF PLAY round (Tom's spec): 10 random USE + the full spaced
  // review (N-1×3, then N-2,N-3,N-5…N-89, capped at MAX_SPACED_REP_PHRASES=12)
  // = ~22 cycles. randomUseCount tops the random bucket back up to hold 22 as
  // spaced offsets drain (e.g. N-1 dropping off → +3 random), floored at 10.
  const TARGET_ROUND_CYCLES = 22
  const MIN_RANDOM_USE = 10
  const mainLoopLastRound = roundNumber
  const revivalCap = mainLoopLastRound + infinitePlayLookahead

  while (roundNumber < revivalCap) {
    await yieldTick()
    roundNumber++
    const usedPhrasesThisRound = new Set<string>()
    let cycleNum = 0

    // Phase 1: SPACED-REP candidate set — same logic as the main loop.
    // LEGOs whose lastRound matches N-1, N-2, ..., N-89 from the current
    // round, skipping graduated-into-listening seeds.
    const dueForReview: { key: string; state: LegoState; fibPosition: number; phraseCount: number }[] = []
    const seenLegos = new Set<string>()
    for (let offsetIdx = 0; offsetIdx < SPACED_REP_OFFSETS.length; offsetIdx++) {
      const offset = SPACED_REP_OFFSETS[offsetIdx]
      const reviewRound = roundNumber - offset
      if (reviewRound < 1) break
      for (const [prevKey, state] of legoState.entries()) {
        if (seenLegos.has(prevKey)) continue
        // Graduated seeds stay eligible for SEED-PHASE production review (≥144).
        if (graduatedSeeds.has(state.seedNum) && !reviewItemIsSeed(offset)) continue
        if (state.lastRound === reviewRound) {
          const isN1 = offset === 1
          const phraseCount = isN1 ? N1_PHRASE_COUNT : 1
          dueForReview.push({ key: prevKey, state, fibPosition: offsetIdx, phraseCount })
          seenLegos.add(prevKey)
        }
      }
    }

    // Project how many spaced-rep cycles will actually fire (capped) so
    // we can size the random-USE bucket to maintain ~TARGET_ROUND_CYCLES.
    let projectedSpacedRep = 0
    for (const { phraseCount } of dueForReview) {
      if (projectedSpacedRep >= MAX_SPACED_REP_PHRASES) break
      projectedSpacedRep += Math.min(phraseCount, MAX_SPACED_REP_PHRASES - projectedSpacedRep)
    }
    const randomUseCount = Math.max(MIN_RANDOM_USE, TARGET_ROUND_CYCLES - projectedSpacedRep)

    // Phase 2: RANDOM USE selection — uniform random over ALL debuted LEGOs.
    //
    // Previous design used recency tiers (50% last 55 / 25% next 100 / 25%
    // rest), which made sense mid-course where "recent" tracks current
    // content. In infinite play every LEGO has been debuted, so the recency
    // bias becomes a topic-clustering bias toward the back end of the
    // course — for a 300-seed course that's half the round locked to ~26
    // seeds at the top. Uniform sampling gives the learner genuine variety
    // across the whole inventory.
    //
    // Deduped against the spaced-rep set so a LEGO can't appear twice in
    // one round.
    const spacedRepKeys = new Set(dueForReview.map(d => d.key))
    const allKeys = [...legoState.keys()]
    const pool = allKeys.filter(k => !spacedRepKeys.has(k))
    // Seeded in INF PLAY (infplayRandom supplied) so the random-USE tail is a
    // stable, navigable, reproducible stream rather than a per-session slot
    // machine. Falls back to Math.random for any legacy caller that omits it.
    const chosenKeys = sampleWithoutReplacement(pool, randomUseCount, infplayRandom ?? Math.random)

    // Phase 3: emit random USE (1 phrase per LEGO, advance round-robin
    // useIndex so phrases rotate across visits).
    if (shouldEmit()) {
      for (const legoKey of chosenKeys) {
        const state = legoState.get(legoKey)
        if (!state || state.usePhrases.length === 0) continue
        const phrase = state.usePhrases[state.useIndex % state.usePhrases.length]
        state.useIndex++
        if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue
        usedPhrasesThisRound.add(phraseId)
        const legoNum = legoKey.match(/L(\d+)/)?.[1] || ''
        const seedId = legoKey.match(/S\d+/)?.[0] || ''
        cycleNum++
        emitItem({
          uuid: `${legoKey}_inf_R${roundNumber}_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'use',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: false,
        })
      }
    }

    // Phase 4: emit spaced rep — same shape as main-loop spaced rep.
    if (shouldEmit()) {
      let spacedRepCount = 0
      for (const { key: reviewKey, state, fibPosition, phraseCount } of dueForReview) {
        if (spacedRepCount >= MAX_SPACED_REP_PHRASES) break

        const reviewLegoNum = reviewKey.match(/L(\d+)/)?.[1] || ''
        const reviewSeedId = reviewKey.match(/S\d+/)?.[0] || ''

        // SEED-PHASE review (offset ≥144): the FULL PARENT SEED SENTENCE
        // (drained comprehensible-input sandwich) instead of a use-phrase.
        // Falls back to the use-phrase path if the seed row is missing or
        // lacks target audio.
        const reviewOffset = SPACED_REP_OFFSETS[fibPosition]
        if (reviewItemIsSeed(reviewOffset)) {
          const seed = seedMap.get(state.seedNum)
          if (seed && seed.target1_audio_id) {
            const seedPhraseId = getPhraseId(seed.known_text, seed.target_text)
            if (!usedPhrasesThisRound.has(seedPhraseId)) {
              usedPhrasesThisRound.add(seedPhraseId)
              spacedRepCount++
              emitSeedSandwich(seed, {
                reviewKey, reviewSeedId, reviewLegoNum, roundNumber, fibPosition,
                reviewOf: state.lastRound, uuidPrefix: `${reviewKey}_inf_seed_R${roundNumber}`,
              }, () => ++cycleNum)
            }
            continue
          }
          // seed missing / no target audio → fall through to the use-phrase review
        }

        if (state.usePhrases.length === 0) continue

        // Same known-side pull filter as the main loop's review. Revival
        // rounds sit past the main loop, so on any real course this is already
        // beyond REVIEW_FILTER_MAX_ROUND and the basket is whole; it is here so
        // a short course's revival rounds obey the same rule as its main ones.
        const reviewPool = filterReviewPool(state.usePhrases, roundNumber, REVIEW_PULL_FILTER)
        const phrasesToUse = Math.min(phraseCount, MAX_SPACED_REP_PHRASES - spacedRepCount, reviewPool.length)
        for (let i = 0; i < phrasesToUse; i++) {
          const phrase = reviewPool[state.useIndex % reviewPool.length]
          state.useIndex++
          const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
          if (usedPhrasesThisRound.has(phraseId)) continue
          usedPhrasesThisRound.add(phraseId)
          if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
          cycleNum++
          spacedRepCount++
          emitItem({
            uuid: `${reviewKey}_inf_sr_R${roundNumber}_${cycleNum}`,
            cycleNum, roundNumber, seedId: reviewSeedId, legoKey: reviewKey,
            seedCode: reviewSeedId, legoCode: reviewLegoNum,
            type: 'spaced_rep',
            knownText: phrase.known_text,
            targetText: phrase.target_text_roman || phrase.target_text,
            ...nativeFields(phrase),
            knownAudioId: phrase.known_audio_id,
            target1Id: phrase.target1_audio_id,
            target2Id: phrase.target2_audio_id,
            target1DurationMs: phrase.target1_duration_ms,
            target2DurationMs: phrase.target2_duration_ms,
            isNew: false,
            fibPosition,
            reviewOf: state.lastRound,
          })
        }
      }
    }

    // L1 listening removed from infinite-play main flow 2026-05-19 —
    // moved to Listening MODE. L2 stays runtime-scheduled (unchanged).

    // Safety: if nothing emitted (no usable LEGOs at all), stop — otherwise
    // we'd loop emitting empty rounds.
    if (cycleNum === 0) break
  }

  // Decompose phrases into component LEGO IDs
  let decomposedCount = 0
  for (const item of items) {
    await yieldTick()
    if (item.type === 'intro' || item.type === 'debut' || item.type === 'listening' || item.type === 'component_intro' || item.type === 'component_practice' || item.type === 'pod' || item.type === 'listen_intro' || item.type === 'listen_outro') continue
    const components = decomposePhrase(item.targetText)
    if (components.length > 0) {
      item.componentLegoIds = components
      item.componentLegoTexts = components.map(id => legoIdToText.get(id) || '')
      if (courseHasRomanized) {
        item.componentLegoTextsNative = components.map(id => legoIdToTextNative.get(id) || legoIdToText.get(id) || '')
      }
      decomposedCount++
    }
  }
  console.debug(`[generateLearningScript] Decomposed ${decomposedCount}/${items.filter(i => i.type !== 'intro' && i.type !== 'debut').length} phrases into LEGO components (${legoTextMap.size} LEGOs in map)`)

  // Remove consecutive duplicates (matching dashboard logic)
  const dedupedItems: ScriptItem[] = []
  let lastNonIntroItem: ScriptItem | null = null

  for (const item of items) {
    await yieldTick()
    if (item.type === 'intro' || item.type === 'debut' || item.type === 'listening' || item.type === 'component_intro' || item.type === 'pod' || item.type === 'listen_intro' || item.type === 'listen_outro') {
      dedupedItems.push(item)
      continue
    }

    if (lastNonIntroItem) {
      const sameKnown = normalizeText(item.knownText) === normalizeText(lastNonIntroItem.knownText)
      const sameTarget = normalizeText(item.targetText) === normalizeText(lastNonIntroItem.targetText)
      if (sameKnown && sameTarget) continue
    }

    dedupedItems.push(item)
    lastNonIntroItem = item
  }

  const removedCount = items.length - dedupedItems.length

  // Drop individual cycles missing required text (partially-built phrases).
  // Per-cycle filtering preserves the good cycles in a partially-incomplete
  // round; whole-round filtering preserves nothing if even one cycle is good.
  //
  // The whole-round "no audio at all" drop that used to live here was removed
  // 2026-08-06 with the per-LEGO audio filter it partnered: it keyed off an
  // intro/debut with no target1Id, and killed that round's build, use, review
  // and consolidate cycles with it — the second of the two amputations. Intros
  // and debuts are now only EMITTED when their own audio resolves, so a round
  // with an audio hole simply arrives without them and keeps everything else;
  // a round left with nothing at all is dropped downstream by toSimpleRounds.
  //
  // Listening items (pod/bookend) are exempt: pod sentence plays have empty
  // knownText, pod translation plays have empty targetText, and bookends
  // have empty targetText. These are by design — the text-completeness check
  // is for unbuilt LEGO/phrase rows, not for listening cycles whose missing
  // side reflects their play role.
  const TEXT_CHECK_EXEMPT = new Set(['pod', 'listen_intro', 'listen_outro', 'listening'])
  let droppedByText = 0
  const playableItems = dedupedItems.filter(item => {
    if (TEXT_CHECK_EXEMPT.has(item.type)) return true
    const knownOk = typeof item.knownText === 'string' && item.knownText.trim().length > 0
    const targetOk = typeof item.targetText === 'string' && item.targetText.trim().length > 0
    if (!knownOk || !targetOk) {
      droppedByText++
      return false
    }
    return true
  })

  // ── EASY doubling (Tom, 2026-08-07) ──────────────────────────────────────
  // "in EASY mode, double up every phrase, every BLD, every USE, every REVIEW,
  // every CONSOLIDATE". Runs AFTER the consecutive-duplicate removal above,
  // which would strip the second copy, and BEFORE the A-64 floor below, which
  // allows exactly two in a row and so guarantees "doubled" can never become
  // tripled. Off for Fast, and the pass returns its input untouched then, so
  // Fast's script is byte-identical to the pre-2026-08-07 walk.
  const doubledItems = easyOptions.doublePhraseCycles
    ? doublePhraseCycles(playableItems)
    : playableItems

  // ── A-64 floor (Tom, 2026-08-06) ─────────────────────────────────────────
  // "No mode should ever repeat the same prompt more than twice consecutively."
  //
  // The consecutive-duplicate pass above is stricter than the law for ordinary
  // cycles, but it lets intro/debut/pod/bookend types straight through — so a
  // pod lap whose stage playlist fires the same clip three times, or any future
  // emitter, can still breach. This pass is the floor that cannot be breached:
  // it runs downstream of every script-shape value (Easy mode's doubled
  // n1PhraseCount included) and of the pod stage playlists in algorithm_config.
  //
  // Re-interleaving is confined to a single round: rounds are the player's unit
  // of position, so an item must never migrate across a round boundary. Each
  // round is seeded with the previous round's tail so the law also holds at the
  // seam. Totals survive wherever a round holds anything to interleave with.
  const roundCapped: ScriptItem[] = []
  let capTail: string[] = []
  let capDropped = 0
  let capReordered = 0
  let currentRound: number | null = null
  let roundBuffer: ScriptItem[] = []
  const flushRound = () => {
    if (roundBuffer.length === 0) return
    const capped = capConsecutiveRepeats(roundBuffer, scriptItemIdentity, { seed: capTail })
    capTail = capped.tail
    capDropped += capped.dropped.length
    if (capped.reordered) capReordered++
    roundCapped.push(...capped.items)
    roundBuffer = []
  }
  for (const item of doubledItems) {
    await yieldTick()
    if (currentRound !== null && item.roundNumber !== currentRound) flushRound()
    currentRound = item.roundNumber
    roundBuffer.push(item)
  }
  flushRound()
  if (capReordered > 0 || capDropped > 0) {
    console.info(`[generateLearningScript] A-64 cap: re-interleaved ${capReordered} round(s)${capDropped > 0 ? `, dropped ${capDropped} rep(s) with nothing to interleave against` : ''}`)
  }

  if (introsSkippedForAudio > 0 || debutsSkippedForAudio > 0 || droppedByText > 0) {
    console.info(`[generateLearningScript] Suppressed ${introsSkippedForAudio} intros / ${debutsSkippedForAudio} debuts for missing audio (their rounds still play), ${droppedByText} missing-text cycles`)
  }

  // Validate generated script integrity in dev mode only — production cold
  // start doesn't benefit from re-checking script integrity at runtime, and
  // validating a 9999-round script costs hundreds of ms on in-progress
  // courses where most rounds end up with errors anyway.
  // Defensive: import.meta.env is Vite-specific, so guard for non-Vite hosts
  // (e.g. running this module under tsx for diagnostic scripts).
  const isDevBuild = (() => {
    try { return !!(import.meta as any)?.env?.DEV } catch { return false }
  })()
  if (isDevBuild) {
    const validationReport = validateLearningScript(roundCapped)
    if (!validationReport.valid) {
      console.warn(`[generateLearningScript] Validation: ${validationReport.summary}`)
    }
  }

  // Summary: intros missing presentation audio (single log instead of per-item spam)
  if (introsMissingAudio.length > 0) {
    console.warn(`[generateLearningScript] ${introsMissingAudio.length} intros missing presentation audio — will play target audio only`)
  }

  // Recount rounds from playable items
  const playableRoundCount = new Set(roundCapped.map(i => i.roundNumber)).size
  // Where the INF-PLAY revival tail begins = count of PLAYABLE main-loop rounds.
  // mainLoopLastRound is the generator's own boundary (set right before the
  // revival loop); counting distinct playable roundNumbers at-or-below it gives
  // the true current course size, with unbuilt/no-audio rounds already filtered
  // out. This is what the player must use to find the tail — never a DB count.
  const mainLoopRoundCount = new Set(
    roundCapped.filter(i => i.roundNumber <= mainLoopLastRound).map(i => i.roundNumber)
  ).size
  const listeningStats = listeningConfig.enabled && graduatedSeeds.size > 0
    ? `, ${graduatedSeeds.size} seeds graduated`
    : ''
  console.debug(`[generateLearningScript] ${roundCapped.length} items, ${playableRoundCount} rounds for ${courseCode}${removedCount > 0 ? `, ${removedCount} deduped` : ''}${introsSkippedForAudio + debutsSkippedForAudio > 0 ? `, ${introsSkippedForAudio + debutsSkippedForAudio} no-audio intro/debut cycles` : ''}${droppedByText > 0 ? `, ${droppedByText} bad-text cycles` : ''}${listeningStats}`)
  return { items: roundCapped, cycleCount: roundCapped.length, roundCount: playableRoundCount, mainLoopRoundCount, hasRomanizedText: courseHasRomanized, syllableCapApplied }
}
