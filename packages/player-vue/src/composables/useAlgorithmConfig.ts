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
  spaced_rep_fraction: number // 1.0 = full, 0.33 = skip 2/3
  debut_phrases_fraction: number // 1.0 = all, 0.5 = half
  skip_voice2: boolean        // Skip second target voice?
  /** Per-mode overrides on the global `script_shape` row — the "how many
   *  repetitions of each new item" half of a mode. Applied at
   *  script-generation time, so a change lands on the next round built.
   *  Absent (Fast) ⇒ the global script_shape is used unchanged. */
  script_shape?: Partial<ScriptShapeConfig>
  /** Which practice phrase a mode reaches for first when it has a choice.
   *  'shortest' (default, Fast) walks BUILD/USE shortest-first; 'longest'
   *  (Easy) reverses both sorts so the learner gets the fullest phrase
   *  available. */
  phrase_length_preference?: 'shortest' | 'longest'
}

/** The two learner-facing modes. Fast is the default and is behaviourally
 *  identical to the pre-2026-08-06 "normal" mode; Easy is the gentler one. */
export type LearningMode = 'easy' | 'fast'

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
// Fast-mode pause formula: clamp(min_pause_ms, max_pause_ms, pause_base_ms + (target1 + target2) × pause_multiplier).
// The previous fallback (base 1500, mul 1.0, ceiling 8000) was the legacy too-tight curve;
// values below match the formula deployed for SSi's generate-from-prompt loop, so when
// the DB algorithm_config row is missing the fallback gives the same answer.
//
// FAST is the former "normal" mode, byte-for-byte. Renamed 2026-08-06 (Aran's
// ruling, relayed by Tom): two learner-facing modes only — easy and fast —
// with Turbo retired. A learner who never touches the toggle gets exactly
// what they got before.
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
  spaced_rep_fraction: 1.0,
  debut_phrases_fraction: 1.0,
  skip_voice2: false
}

/**
 * EASY mode — the gentler of the two modes (new 2026-08-06).
 *
 * Tom's shape, verbatim: "doubling time, doubling the reps. Having the
 * longest possible phrase." Read as three things, each an independent knob
 * so it can be retuned from the admin side without a deploy:
 *
 *   1. TIME  — every pause term is exactly 2× the Fast value (boot, assembly
 *      slope, floor, ceiling, multiplier). The belt taper is switched OFF
 *      (both belt knobs 1.0, vs Fast's 0.8 assembly taper), so an advancing
 *      learner keeps the full gentle pause instead of having it shortened.
 *   2. REPS  — `script_shape` below doubles every phrase-count knob.
 *   3. LENGTH — `phrase_length_preference: 'longest'` reverses the
 *      shortest-first BUILD/USE sorts in generateLearningScript.
 *
 * Audio playback speed stays at native 1.0× — "doubling time" is about the
 * learner's thinking gap, not about slowing the speaker down.
 */
export const DEFAULT_EASY: ModeConfig = {
  playback_speed: 1.0,
  pause_reference: 'avg',
  pause_boot_ms: 2000,             // 2× fast (1000)
  pause_assembly_threshold_ms: 1000, // same threshold — below it there is no assembly cost either way
  pause_assembly_lin: 5.0,         // 2× fast (2.5)
  pause_assembly_quad: 0,
  pause_belt_boot: 1.0,            // no belt taper in Easy…
  pause_belt_assembly: 1.0,        // …vs Fast's 0.8: long phrases keep the full gap at every belt
  pause_base_ms: 0,
  pause_multiplier: 2.1,           // 2× fast (1.05)
  min_pause_ms: 1400,              // 2× fast (700)
  max_pause_ms: 30000,             // 2× fast (15000)
  spaced_rep_fraction: 1.0,
  debut_phrases_fraction: 1.0,
  skip_voice2: false,
  // Doubled reps. Overlays the global `script_shape` row; Fast carries no
  // overlay and so uses that row unchanged. `spacedRepOffsets` is deliberately
  // NOT doubled — the Fibonacci ladder is the schedule of WHEN a review fires,
  // not how many reps it gives; the count knobs below are the reps.
  script_shape: {
    maxBuildPhrases: 14,       // 2× fast (7)
    useConsolidationCount: 4,  // 2× fast (2)
    maxSpacedRepPhrases: 24,   // 2× fast (12)
    n1PhraseCount: 6,          // 2× fast (3)
  },
  phrase_length_preference: 'longest',
}

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

export const DEFAULT_SCRIPT_SHAPE: ScriptShapeConfig = {
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
        // Mode rows, backward-compatible. dev/staging/prod share ONE DB and
        // the Popty side authors the rows in its own lane, so this code must
        // survive `fast_mode`/`easy_mode` not existing yet:
        //   fast_mode → falls back to the legacy `normal_mode` row (same shape,
        //               same meaning — Fast IS the old normal mode).
        //   easy_mode → falls back to DEFAULT_EASY, and inherits any pause
        //               fields the admin has tuned on fast/normal so a hand-set
        //               course curve isn't silently thrown away; the doubled
        //               Easy knobs then win over that inheritance.
        // A missing row can never break playback — worst case is built-in defaults.
        const fastRow = loaded.fast_mode || loaded.normal_mode || {}
        const easyRow = loaded.easy_mode || {}
        configs.value = {
          ...loaded,
          fast_mode: { ...DEFAULT_FAST, ...fastRow },
          easy_mode: { ...DEFAULT_FAST, ...fastRow, ...DEFAULT_EASY, ...easyRow },
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
  /** The ModeConfig for a given learner mode. */
  const configForMode = (mode: LearningMode): ModeConfig =>
    mode === 'easy' ? easyConfig.value : fastConfig.value
  /** Effective script shape for a mode: the global `script_shape` row with the
   *  mode's own overlay applied. Fast carries no overlay ⇒ unchanged. */
  const scriptShapeForMode = (mode: LearningMode): ScriptShapeConfig => ({
    ...(configs.value.script_shape as ScriptShapeConfig),
    ...(configForMode(mode).script_shape || {}),
  })
  const listeningConfig = computed(() => configs.value.listening as ListeningModeConfig)
  const podsConfig = computed(() => configs.value.pods as PodsConfig)
  const scriptShapeConfig = computed(() => configs.value.script_shape as ScriptShapeConfig)
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
    configForMode,
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
