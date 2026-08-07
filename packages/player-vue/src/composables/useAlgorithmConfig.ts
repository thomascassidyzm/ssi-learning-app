/**
 * useAlgorithmConfig
 *
 * Fetches and caches admin-tweakable algorithm parameters from Supabase.
 * Follows "everything is a parameter" philosophy - no hardcoded algorithm values.
 *
 * Usage:
 *   const { getConfig, easyConfig, fastConfig, isLoaded } = useAlgorithmConfig(supabase)
 *   await loadConfigs()
 *   const pauseMs = fastConfig.value.pause_base_ms
 */

import { ref, computed, type Ref } from 'vue'
import { type Stage0Config, DEFAULT_STAGE0 } from '@ssi/core/pods'
import { type RatePolicyBounds, DEFAULT_RATE_POLICY_BOUNDS } from '@ssi/core'
import {
  type EncouragementTaperConfig,
  DEFAULT_ENCOURAGEMENT_TAPER,
} from '../services/MetaCommentaryService'

// Type definitions for algorithm configs
export interface ModeConfig {
  playback_speed: number      // 1.0 = normal, 1.25 = 25% faster
  pause_base_ms: number       // Base pause before multiplier
  pause_multiplier: number    // Multiplied by target audio duration
  min_pause_ms: number        // Floor for pause duration
  max_pause_ms: number        // Ceiling for pause duration
  /** Reference duration the pause scales with (default 'sum' = legacy t1+t2).
   *  See computePauseDuration.ts. */
  pause_reference?: 'avg' | 'target1' | 'sum'
  /** LEGACY knee model — reference (ms) past which the gentler tail kicks in. */
  pause_knee_ms?: number
  /** LEGACY knee model — slope beyond the knee (default = pause_multiplier). */
  pause_tail_multiplier?: number
  /** Boot / reaction floor (ms) — length-independent spin-up. See
   *  computePauseDuration.ts (boot + assembly model). */
  pause_boot_ms?: number
  /** Reference (ms) below which there is no assembly cost (short = pure boot). */
  pause_assembly_threshold_ms?: number
  /** Linear assembly per ms of reference past the threshold. */
  pause_assembly_lin?: number
  /** Quadratic assembly (ms per second² past the threshold) — super-linear
   *  long-phrase cost. 0 ⇒ a straight assembly ramp. */
  pause_assembly_quad?: number
  /** Boot multiplier at Green belt (White=1.0; interpolated). <1 shrinks
   *  short-phrase gaps as the learner advances. */
  pause_belt_boot?: number
  /** Assembly multiplier at Green belt (White=1.0). Keep nearer 1.0 than
   *  belt_boot so long phrases shorten less than short ones across belts. */
  pause_belt_assembly?: number
  /**
   * Extra silence (ms) held AFTER voice2, before the next cycle's prompt —
   * "to stop the next cycle just coming in and taking over" (Tom, 2026-08-07).
   * Voice2 is the phase carrying the target text on screen, so the same gap
   * also leaves that text up for longer. Easy holds 1s; Fast holds none.
   * Absent / 0 ⇒ the historic behaviour (next cycle starts immediately).
   */
  post_voice2_gap_ms?: number
  spaced_rep_fraction: number // 1.0 = full, 0.33 = skip 2/3
  debut_phrases_fraction: number // 1.0 = all, 0.5 = half
  skip_voice2: boolean        // Skip second target voice?
  /**
   * OPTIONAL per-mode override of the GLOBAL `script_shape` row. Keys mirror
   * ScriptShapeConfig exactly; anything omitted falls through to the global
   * value. Layering happens in exactly ONE place — `resolveScriptShape()`
   * below — so there is no second merge rule to keep in sync.
   *
   * This is where Easy and Fast are allowed to differ in SHAPE, and it is the
   * ONLY way they may: a mode GENERATES a different round, it never plays a
   * subset of one. There is no per-cycle cull on the mode path — SimplePlayer's
   * `shouldSkipCycle` hook belongs to adaptation v2 alone.
   */
  scriptShape?: Partial<ScriptShapeConfig>
  /**
   * Cap on phrase LENGTH, expressed as a fraction of the longest phrase in
   * the WHOLE COURSE (not per-LEGO — see courseMaxPhraseLength). Range (0, 1].
   *   1.0 — uncapped; today's exact behaviour. Fast ships 1.0, so Fast is
   *         provably unchanged.
   *   0.5 — Easy: half the longest possible phrase (Aran, 2026-08-06).
   * Applied by `capPhrasesByLength()` below — the ONE place the rule lives.
   * Sorting is always shortest-first; this is a CAP, not a sort direction.
   * A missing or invalid value degrades to 1.0 (uncapped), never to a cap.
   */
  maxPhraseLengthFraction?: number
}

/** The two learning modes (Aran's ruling 2026-08-06). Fast is the default. */
export type LearningMode = 'easy' | 'fast'

/** The mode a learner has not explicitly chosen. */
export const DEFAULT_LEARNING_MODE: LearningMode = 'fast'

/** `algorithm_config` row key for a mode. */
export const MODE_CONFIG_KEY: Record<LearningMode, string> = {
  easy: 'easy_mode',
  fast: 'fast_mode',
}

/**
 * Listening slot roles — full set including runtime playback rates.
 *   ps08x = 0.8×, ps = 1×, ps15x = 1.5×, ps2x = 2×, trans = known audio at 1×
 */
export type ListeningSlotRole = 'ps08x' | 'ps' | 'ps15x' | 'ps2x' | 'trans'
// Layer-2 pods additionally know 'explainer' (2026-06-10): Tom-voiced bilingual
// chunk breakdown — Phase 0 plays it INSTEAD of trans. Layer 1 never uses it.
export type PodSlotRole = ListeningSlotRole | 'explainer'

/** Layer 2 (Listening Pod) scheduler — gap matrix + stage progression. */
export interface PodsConfig {
  stagePlaylist: Record<string, PodSlotRole[]>  // keyed by stage number as string
  stageDuration: number       // pod-rounds per transitional stage; highest key = eternal
  /** Per-stage duration overrides (e.g. {'1': 2, '2': 3} — Phase 0 explainer
   *  plays twice, Phase 1 three times). Unlisted stages use stageDuration. */
  stageDurations?: Record<string, number>
  gapSuperTightMs: number     // known→target, target→target
  gapTightMs: number          // target→known
  gapGluedMs: number          // chunk → glued chunk (early stages)
  gapBetweenMs: number        // chunk → non-glued, intro→first, last→outro
  /** Fire a pod-lap every N main rounds from podActivationRound onward.
   *  Default 1 (every round, legacy behaviour). Stretches every pod stage
   *  proportionally because the pod-round ratchet only ticks on actual
   *  fires — not session rounds. */
  roundInterval: number
  /** Main-round at which Layer 2 pods START FIRING for new learners.
   *  Returning learners get their own pin on `course_enrollments.pod_activation_round`
   *  which always wins over this default. Moved here from ListeningModeConfig
   *  so the admin "pod activation" knob lives next to the other pod controls. */
  podActivationRound: number
}

/**
 * Resume regression — long absences re-engage the learner with familiar
 * territory. Cursor regression is one-way (only on resume); ceiling
 * (highest_completed_*) is always preserved so they keep access.
 */
export interface ResumeConfig {
  /** After this gap in MINUTES, ignore current_cycle_index on resume and
   *  restart the in-progress round (replays the LEGO intro). A brief pause
   *  resumes the exact cycle; a real break restarts the round. ~5 min cutoff. */
  cycleResetMinutes: number
  /** After this gap in days, walk the round cursor back to the start of
   *  the learner's current belt. Set to a very large number to disable. */
  beltRegressionDays: number
}

/** Per-round script shape — phrase counts + Fibonacci spaced-rep schedule. */
export interface ScriptShapeConfig {
  spacedRepOffsets: number[]   // fib offsets at which spaced rep fires
  maxBuildPhrases: number      // BUILD slots per round
  useConsolidationCount: number  // USE phrases per LEGO
  maxSpacedRepPhrases: number    // total spaced-rep cap per round
  n1PhraseCount: number          // phrases at the N-1 review (vs 1 elsewhere)
}

/**
 * Layer 1 + Layer 2 listening config — mirrored to DB row
 * `algorithm_config` key='listening'. Admins tweak in Supabase Studio
 * and the change takes effect on next session (5-min cache TTL).
 */
export interface ListeningModeConfig {
  enabled: boolean
  offset: number              // rounds after last LEGO before seed graduates
  /** @deprecated Moved to PodsConfig.podActivationRound (2026-05-17).
   *  Optional/read-only here for legacy rows whose `pods` config hasn't
   *  been re-saved yet. The dashboard backfills on next load.
   *  KEPT: still the #2 fallback link for un-migrated `listening` config
   *  rows (LearningPlayer.vue) — removing changes pod-activation timing
   *  for un-migrated learners. Keep until the dashboard backfills `pods`. */
  podActivationRound?: number
}

/**
 * Meta-commentary knobs — DB row `algorithm_config` key='meta_commentary'.
 * Encouragement taper (owner ruling 2026-08-06, superseding 2026-07-24):
 * random encouragements dial down with learner experience and switch fully off
 * past a threshold. The experience unit is the learner's CUMULATIVE LEARNING
 * MINUTES ACROSS ALL COURSES — not their position in the current course, which
 * made a veteran starting a new course look like a beginner. Defaults: taper
 * starts at 600 min (10h), off at 1800 min (30h). Instructions (the once-ever
 * science bits) are never tapered.
 */
export interface MetaCommentaryConfig {
  encouragementTaper: EncouragementTaperConfig
}

export interface AlgorithmConfigs {
  fast_mode: ModeConfig
  easy_mode: ModeConfig
  listening: ListeningModeConfig
  pods: PodsConfig
  script_shape: ScriptShapeConfig
  resume: ResumeConfig
  stage0: Stage0Config
  adaptation_v2: AdaptationV2Config
  meta_commentary: MetaCommentaryConfig
  [key: string]: ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig | Stage0Config | AdaptationV2Config | MetaCommentaryConfig
}

// Default fallbacks (used if DB fetch fails)
//
// Normal-mode pause formula: clamp(min_pause_ms, max_pause_ms, pause_base_ms + (target1 + target2) × pause_multiplier).
// The previous fallback (base 1500, mul 1.0, ceiling 8000) was the legacy too-tight curve;
// values below match the formula deployed for SSi's generate-from-prompt loop, so when
// the DB algorithm_config row is missing the fallback gives the same answer.
export const DEFAULT_FAST: ModeConfig = {
  playback_speed: 1.0,
  // Boot + assembly model (see computePauseDuration.ts). These defaults
  // reproduce the previous White-belt curve for medium/long phrases exactly
  // (boot 1000 + 2.5×ref-past-1000ms ≡ the old floor-1000 / knee-1600 / tail-2.0
  // curve at White), while the boot/knee makes the shortest phrases a touch
  // shorter. Belt taper: short phrases (boot) belt-independent by default,
  // long phrases (assembly) shrink ~20% by Green — matching the old speed ramp.
  pause_reference: 'avg',
  pause_boot_ms: 1000,
  pause_assembly_threshold_ms: 1000,
  pause_assembly_lin: 2.5,
  pause_assembly_quad: 0,
  pause_belt_boot: 1.0,
  pause_belt_assembly: 0.8,
  pause_base_ms: 0,
  pause_multiplier: 1.05,
  min_pause_ms: 700,
  max_pause_ms: 15000,
  // Fast is unchanged: the next cycle follows voice2 immediately, as it always has.
  post_voice2_gap_ms: 0,
  spaced_rep_fraction: 1.0,
  debut_phrases_fraction: 1.0,
  skip_voice2: false,
  // Identity override: Fast generates EXACTLY the global script_shape, so its
  // behaviour is provably unchanged from the pre-2026-08-06 'normal_mode'.
  scriptShape: {},
  // Uncapped phrase length — Fast meets exactly the phrases it always did.
  maxPhraseLengthFraction: 1.0,
}

/**
 * EASY mode — the gentler of the two modes (Aran's ruling 2026-08-06: exactly
 * two modes, Turbo deleted).
 *
 * TUNING STATUS: these are FIRST-PASS defaults, chosen to be coherent, not
 * calibrated by ear. Every value is a DB row (`algorithm_config.easy_mode`),
 * so retuning Easy is a Supabase edit, not a deploy.
 *
 * These MIRROR the seeded DB rows (Popty's scripts/learning-modes/
 * create-mode-rows.cjs) and are pitched at roughly a learner's FIRST 10 HOURS,
 * adjusting upwards from there (Aran, 2026-08-06). Aran's three seeds: double
 * the time, double the reps, halve the longest possible phrase. On the time he
 * added that it "does not need to be dramatic", so the doubling is confined to
 * boot + floor and deliberately does NOT touch the assembly slope or the
 * ceiling — doubling those too would compound into a sluggish gap on long
 * sentences.
 *
 * SPEED: Easy does NOT have a speed of its own. It rides the same belt/target-
 * language ramp as Fast (Tom's ruling, 2026-08-07: "Easy should follow the
 * exact speed pattern on-ramps for the target language as Fast — but just with
 * bigger pauses, more repetitions and so on"). Easy used to force a flat 1.0×,
 * which made a White-belt beginner on Easy hear FASTER speech than the same
 * beginner on Fast. `playback_speed` below is therefore INERT for both modes —
 * kept only because the DB row carries the column.
 */
export const DEFAULT_EASY: ModeConfig = {
  playback_speed: 1.0,
  pause_reference: 'avg',
  // DOUBLE the time, confined to boot + floor (see above).
  pause_boot_ms: 4000,
  pause_assembly_threshold_ms: 750,
  pause_assembly_lin: 3.5,
  pause_assembly_quad: 75,
  pause_belt_boot: 0.8,
  pause_belt_assembly: 0.95,
  pause_base_ms: 0,
  pause_multiplier: 1.05,
  min_pause_ms: 2000,
  max_pause_ms: 15000,
  // A beat of silence after voice2 so the next cycle doesn't come straight in
  // over the top of the one just heard, and the target text stays on screen
  // that bit longer (Tom, 2026-08-07). Easy only — Fast holds 0.
  post_voice2_gap_ms: 1000,
  spaced_rep_fraction: 1.0,
  debut_phrases_fraction: 1.0,
  skip_voice2: false,
  // DOUBLE the reps, against the global script_shape values (7/2/12/3).
  // These mirror the seeded easy_mode DB row exactly; the row is authoritative
  // and these only apply when it cannot be read.
  scriptShape: {
    maxBuildPhrases: 14,
    useConsolidationCount: 4,
    maxSpacedRepPhrases: 24,
    n1PhraseCount: 6,
  },
  // HALVE the longest possible phrase (Aran, 2026-08-06) — a fraction of the
  // COURSE's longest phrase, measured in characters. Phrases still arrive
  // shortest-first; the cap only cuts the long tail, with the starvation guard
  // in capPhrasesByLength standing behind it.
  maxPhraseLengthFraction: 0.5,
}

/**
 * Layer a mode's optional `scriptShape` over the global `script_shape` row.
 * THE single place this merge happens — modes differ by OVERRIDE, never by a
 * parallel shape object. A mode with no override (Fast) resolves to the
 * global row byte-for-byte.
 */
export function resolveScriptShape(
  global: ScriptShapeConfig,
  mode?: Pick<ModeConfig, 'scriptShape'> | null,
): ScriptShapeConfig {
  return { ...global, ...(mode?.scriptShape || {}) }
}

/**
 * Coerce a mode's `maxPhraseLengthFraction` into (0, 1].
 * Anything missing, non-finite, ≤0 or >1 degrades to 1.0 — UNCAPPED, i.e. the
 * historic behaviour. A bad DB value must never silently shorten a course.
 */
export function normalizeMaxPhraseLengthFraction(fraction?: number | null): number {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return 1
  if (fraction <= 0 || fraction > 1) return 1
  return fraction
}

/**
 * How the CAP measures phrase length: CHARACTERS of target text.
 *
 * Not syllables, and this is measured rather than assumed. On real data
 * (ara_for_eng, 11,340 phrases): `target_syllable_count` is NULL for every
 * row, and the `countTargetSyllables` fallback is a Latin vowel-cluster
 * heuristic that returns 1 for every Arabic phrase — it special-cases CJK but
 * not Arabic. A syllable-based ceiling therefore computed to 0.5 and the cap
 * silently did nothing. Character length is always present and works in every
 * script.
 *
 * The shortest-first SORT still uses syllables, exactly as it always has.
 * Only the cap's measure is characters. Mirrors `phraseLengthOf` in Popty's
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
 * phrase and the starvation guard fired on 100% of LEGOs — the cap never bit
 * at all. Mirrors `courseMaxPhraseLength` in Popty's learning-modes.cjs.
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
 * Sort a LEGO's candidate phrase pool shortest-first and cap it at an
 * ABSOLUTE length ceiling computed once per run from the whole course.
 *
 * THE single place the phrase-length cap lives (Aran, 2026-08-06: Easy halves
 * the longest possible phrase). The rules, in order:
 *   1. sort shortest-first by SYLLABLES — unchanged, historic, and what makes
 *      an uncapped run byte-identical to the pre-2026-08-06 behaviour;
 *   2. drop phrases whose target text is longer than `limit` CHARACTERS;
 *   3. STARVATION GUARD — if that leaves fewer than `minKeep`, return the
 *      shortest `minKeep` instead. `minKeep` is the methodology's per-LEGO
 *      phrase floor (4 BUILD / 5 USE), deliberately NOT the round's ceiling:
 *      passing the ceiling makes the guard swallow the cap on every LEGO
 *      smaller than it, which is most of them. Phrase volume is a hard rail —
 *      fewer phrases is a FAIL — so the cap yields to it, not the reverse.
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

/** Methodology per-LEGO phrase floors the cap must never breach (ralph: >=4
 *  BUILD, >=5 USE — "fewer phrases is a FAIL"). */
export const MIN_BUILD_PHRASES_AFTER_CAP = 4
export const MIN_USE_PHRASES_AFTER_CAP = 5

const DEFAULT_LISTENING: ListeningModeConfig = {
  enabled: true,
  offset: 90,
}

const DEFAULT_PODS: PodsConfig = {
  // Stage count is dynamic — the runtime reads the key count, the
  // highest-numbered key is the eternal hold.
  // Stage 1 = "Phase 0" (Tom 2026-06-10): the explainer plays INSTEAD of
  // the translation, for 2 pod-rounds, then retires for good. Sentences
  // without explainer audio (fully-repeat lines, vocab codas) play their
  // translation in that slot via the scheduler fallback.
  // Stage 2 = "Phase 1": plain translation pattern, 3 rounds. The speed
  // ramp (Aran's 2026-05-07 bridge) follows from stage 3.
  stagePlaylist: {
    '1': ['ps08x', 'explainer', 'ps08x'],
    '2': ['ps08x', 'trans', 'ps08x', 'ps08x'],
    '3': ['ps08x', 'trans', 'ps', 'ps15x'],
    '4': ['ps', 'trans', 'ps15x', 'ps15x'],
    '5': ['ps', 'trans', 'ps2x', 'ps2x'],
    '6': ['ps', 'trans', 'ps2x'],
    '7': ['ps', 'ps2x'],
    '8': ['ps2x', 'ps2x'],
    '9': ['ps2x'],
  },
  stageDuration: 5,
  stageDurations: { '1': 2, '2': 3 },
  gapSuperTightMs: 100,
  gapTightMs: 200,
  gapGluedMs: 300,
  gapBetweenMs: 1000,
  /* L2 pod-lap fires every 5 main rounds from activation. Hotfix
   * 2026-05-20: stale activation values (21+ from an earlier rule) are
   * capped at 5 on read in usePodLapScheduler so the first pod surfaces
   * ~5 rounds in (gives the learner time to settle into speaking practice
   * before pods interleave). The growing-interval scheduler (2/2/3/3/4/4
   * /5/5/5/5...) lands separately. */
  roundInterval: 5,
  podActivationRound: 5,
}

const DEFAULT_SCRIPT_SHAPE: ScriptShapeConfig = {
  spacedRepOffsets: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
  maxBuildPhrases: 7,
  useConsolidationCount: 2,
  maxSpacedRepPhrases: 12,
  n1PhraseCount: 3,
}

const DEFAULT_RESUME: ResumeConfig = {
  cycleResetMinutes: 5,
  beltRegressionDays: 60,
}

/**
 * Adaptation v2 safety rails (`docs/adaptation/adaptation-v2-build-spec.md`
 * §6, WP-5). Two independent gates:
 *   - `enabled`: the kill switch. false ⇒ the whole v2 pipeline (evidence →
 *     curvature → RatePolicyEngine → shadow log) never even computes for a
 *     round boundary — not just "computes but doesn't apply". The v1 pause
 *     ladder keeps running untouched regardless.
 *   - `shadow`: when `enabled` is true, gates APPLICATION only. true ⇒ the
 *     engine computes a RoundPlan and logs it (`adaptation_plan` event) every
 *     round boundary, but never touches playback. false ⇒ the plan is
 *     actually applied via SimplePlayer's overrides surface.
 * Shipping default is `enabled:true, shadow:true` — "compute and log, never
 * apply" — which is exactly what "ship with the DB flag absent" needs to mean
 * (executive summary point 9). Flipping `enabled:false` later is the harder
 * kill switch for if the shadow logs themselves look wrong.
 */
export interface AdaptationV2Config {
  enabled: boolean
  shadow: boolean
  /** Stage 2 (envelope metadata, WP-6..9) — separately gated, off until that track ships. */
  stage2_enabled: boolean
  bounds: RatePolicyBounds
  /** Stage-2 delta-producer weights (§5.3) — unused until WP-8 lands; carried here so the shape is stable. */
  weights: { duration: number; peaks: number; shape: number }
}

const DEFAULT_ADAPTATION_V2: AdaptationV2Config = {
  enabled: true,
  shadow: true,
  stage2_enabled: false,
  bounds: DEFAULT_RATE_POLICY_BOUNDS,
  weights: { duration: 0.5, peaks: 0.3, shape: 0.2 },
}

const DEFAULT_META_COMMENTARY: MetaCommentaryConfig = {
  encouragementTaper: DEFAULT_ENCOURAGEMENT_TAPER,
}

/** Read the taper out of a loaded DB row, honouring only the known
 *  minute-denominated keys — see the call site for why. Exported for tests. */
export function pickTaper(loaded: any): EncouragementTaperConfig {
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return {
    taperStartMinutes: num(loaded?.taperStartMinutes, DEFAULT_ENCOURAGEMENT_TAPER.taperStartMinutes),
    offAtMinutes: num(loaded?.offAtMinutes, DEFAULT_ENCOURAGEMENT_TAPER.offAtMinutes),
  }
}

// Singleton cache - shared across all component instances
let configCache: AlgorithmConfigs | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function useAlgorithmConfig(supabase: Ref<any> | null) {
  const configs = ref<AlgorithmConfigs>({
    fast_mode: DEFAULT_FAST,
    easy_mode: DEFAULT_EASY,
    listening: DEFAULT_LISTENING,
    pods: DEFAULT_PODS,
    script_shape: DEFAULT_SCRIPT_SHAPE,
    resume: DEFAULT_RESUME,
    stage0: DEFAULT_STAGE0,
    adaptation_v2: DEFAULT_ADAPTATION_V2,
    meta_commentary: DEFAULT_META_COMMENTARY,
  })
  const isLoaded = ref(false)
  const loadError = ref<string | null>(null)

  // Load configs from Supabase (with caching)
  const loadConfigs = async (forceRefresh = false): Promise<void> => {
    // Check cache first
    const now = Date.now()
    if (!forceRefresh && configCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
      configs.value = configCache
      isLoaded.value = true
      return
    }

    if (!supabase?.value) {
      console.warn('[AlgorithmConfig] Supabase not available, using defaults')
      isLoaded.value = true
      return
    }

    try {
      const { data, error } = await supabase.value
        .from('algorithm_config')
        .select('key, config')

      if (error) {
        console.error('[AlgorithmConfig] Fetch error:', error)
        loadError.value = error.message
        // Fall back to defaults
        isLoaded.value = true
        return
      }

      if (data && data.length > 0) {
        const loaded: Record<string, any> = {}
        for (const row of data) {
          loaded[row.key] = row.config
        }

        // Merge with defaults (in case some keys are missing). Field-level
        // merge for keyed configs so a partial DB row doesn't drop fields.
        configs.value = {
          ...loaded,
          // Promotion-window read: 'fast_mode' is the new key, 'normal_mode'
          // is the live fallback alias it was copied from. An old bundle
          // reading a new DB and a new bundle reading an old DB both work —
          // whichever row exists wins, new key first. NOTE 'normal_mode' is
          // NOT retired-mode residue — it is fast_mode's live alias and must
          // stay until the promotion window closes.
          fast_mode: { ...DEFAULT_FAST, ...(loaded.fast_mode || loaded.normal_mode || {}) },
          easy_mode: { ...DEFAULT_EASY, ...(loaded.easy_mode || {}) },
          listening: { ...DEFAULT_LISTENING, ...(loaded.listening || {}) },
          pods: { ...DEFAULT_PODS, ...(loaded.pods || {}) },
          script_shape: { ...DEFAULT_SCRIPT_SHAPE, ...(loaded.script_shape || {}) },
          resume: { ...DEFAULT_RESUME, ...(loaded.resume || {}) },
          stage0: { ...DEFAULT_STAGE0, ...(loaded.stage0 || {}) },
          adaptation_v2: {
            ...DEFAULT_ADAPTATION_V2,
            ...(loaded.adaptation_v2 || {}),
            bounds: { ...DEFAULT_ADAPTATION_V2.bounds, ...(loaded.adaptation_v2?.bounds || {}) },
            weights: { ...DEFAULT_ADAPTATION_V2.weights, ...(loaded.adaptation_v2?.weights || {}) },
          },
          meta_commentary: {
            ...DEFAULT_META_COMMENTARY,
            ...(loaded.meta_commentary || {}),
            // Pick ONLY the known (minute-denominated) keys. A stale row still
            // carrying the pre-2026-08-06 seed keys (taperStartSeeds /
            // offAtSeeds) must not leak through — it would silently switch
            // encouragements off after 8 MINUTES. Unknown keys are ignored and
            // the new defaults stand.
            encouragementTaper: pickTaper(loaded.meta_commentary?.encouragementTaper),
          },
        }

        // Update cache
        configCache = configs.value
        cacheTimestamp = now

        console.log('[AlgorithmConfig] Loaded from Supabase:', Object.keys(loaded))
      }

      isLoaded.value = true
    } catch (err) {
      console.error('[AlgorithmConfig] Unexpected error:', err)
      loadError.value = String(err)
      isLoaded.value = true
    }
  }

  // Convenience getters
  const fastConfig = computed(() => configs.value.fast_mode as ModeConfig)
  const easyConfig = computed(() => configs.value.easy_mode as ModeConfig)
  /** The ModeConfig for a given learning mode. */
  const modeConfig = (mode: LearningMode): ModeConfig =>
    mode === 'easy' ? easyConfig.value : fastConfig.value
  const listeningConfig = computed(() => configs.value.listening as ListeningModeConfig)
  const podsConfig = computed(() => configs.value.pods as PodsConfig)
  const scriptShapeConfig = computed(() => configs.value.script_shape as ScriptShapeConfig)
  /** The effective script shape for a mode: the global `script_shape` row with
   *  that mode's `scriptShape` override layered on top. Fast carries no
   *  override, so it resolves to the global row unchanged. */
  const scriptShapeForMode = (mode: LearningMode): ScriptShapeConfig =>
    resolveScriptShape(scriptShapeConfig.value, modeConfig(mode))
  const resumeConfig = computed(() => configs.value.resume as ResumeConfig)
  const stage0Config = computed(() => configs.value.stage0 as Stage0Config)
  const adaptationV2Config = computed(() => configs.value.adaptation_v2 as AdaptationV2Config)
  const metaCommentaryConfig = computed(() => configs.value.meta_commentary as MetaCommentaryConfig)

  // Get any config by key
  const getConfig = (key: string): ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig | Stage0Config | AdaptationV2Config | MetaCommentaryConfig | null => {
    return configs.value[key] || null
  }

  // Calculate pause duration based on config and target audio length
  const calculatePause = (config: ModeConfig, targetDurationMs: number): number => {
    const calculated = config.pause_base_ms + (targetDurationMs * config.pause_multiplier)
    return Math.min(config.max_pause_ms, Math.max(config.min_pause_ms, calculated))
  }

  // Invalidate cache (call after admin updates)
  const invalidateCache = () => {
    configCache = null
    cacheTimestamp = 0
  }

  return {
    configs,
    isLoaded,
    loadError,
    loadConfigs,
    fastConfig,
    easyConfig,
    modeConfig,
    scriptShapeForMode,
    listeningConfig,
    podsConfig,
    scriptShapeConfig,
    resumeConfig,
    stage0Config,
    adaptationV2Config,
    metaCommentaryConfig,
    getConfig,
    calculatePause,
    invalidateCache,
    // Export defaults for reference
    DEFAULT_FAST,
    DEFAULT_EASY,
    DEFAULT_LISTENING,
    DEFAULT_PODS,
    DEFAULT_SCRIPT_SHAPE,
    DEFAULT_RESUME,
    DEFAULT_ADAPTATION_V2,
    DEFAULT_META_COMMENTARY,
  }
}
