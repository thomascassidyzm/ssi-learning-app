/**
 * useAlgorithmConfig
 *
 * Fetches and caches admin-tweakable algorithm parameters from Supabase.
 * Follows "everything is a parameter" philosophy - no hardcoded algorithm values.
 *
 * Usage:
 *   const { getConfig, turboConfig, normalConfig, isLoaded } = useAlgorithmConfig(supabase)
 *   await loadConfigs()
 *   const pauseMs = turboConfig.value.pause_base_ms
 */

import { ref, computed, type Ref } from 'vue'
import { type Stage0Config, DEFAULT_STAGE0 } from '@ssi/core/pods'

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
  /** Turbo culling — fib-offset indices into spacedRepOffsets that Turbo
   * keeps. Optional on normal mode (no culling there). */
  fibKeep?: number[]
  /** Number of BUILD phrases per LEGO that Turbo keeps; rest are tagged
   * with turboOmit and skipped at play time. Optional on normal mode. */
  buildKeep?: number
  /** Number of CONSOLIDATE/USE phrases per LEGO that Turbo keeps. */
  useKeep?: number
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

export interface AlgorithmConfigs {
  normal_mode: ModeConfig
  turbo_boost: ModeConfig
  listening: ListeningModeConfig
  pods: PodsConfig
  script_shape: ScriptShapeConfig
  resume: ResumeConfig
  stage0: Stage0Config
  [key: string]: ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig | Stage0Config
}

// Default fallbacks (used if DB fetch fails)
//
// Normal-mode pause formula: clamp(min_pause_ms, max_pause_ms, pause_base_ms + (target1 + target2) × pause_multiplier).
// The previous fallback (base 1500, mul 1.0, ceiling 8000) was the legacy too-tight curve;
// values below match the formula deployed for SSi's generate-from-prompt loop, so when
// the DB algorithm_config row is missing the fallback gives the same answer.
export const DEFAULT_NORMAL: ModeConfig = {
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

export const DEFAULT_TURBO: ModeConfig = {
  playback_speed: 1.25,
  // Pause formula: clamp(min_pause_ms, max_pause_ms, pause_base_ms + (target1 + target2) × pause_multiplier).
  // Previous values (base 500, mul 0.5, max 2000) capped Turbo at 2s flat for
  // medium-or-longer phrases, which is below the floor of human speech production
  // for a 5+-LEGO sentence — those phrases became unanswerable. The defaults below
  // land Turbo at roughly 60% of Normal-mode pause across the curve, keeping it
  // a real time-saver while still letting the learner physically produce the
  // target from the L1 prompt. Tunable per-course via DB config.
  // Boot + assembly model: boot 2000 + 0.9×ref-past-1111ms reproduces the old
  // linear Turbo curve (base 1000, mult 0.9, floor 2000). No belt taper in Turbo
  // (it plays at native 1.0× regardless of belt), so the belt knobs are 1.0.
  pause_reference: 'avg',
  pause_boot_ms: 2000,
  pause_assembly_threshold_ms: 1111,
  pause_assembly_lin: 0.9,
  pause_assembly_quad: 0,
  pause_belt_boot: 1.0,
  pause_belt_assembly: 1.0,
  pause_base_ms: 1000,
  pause_multiplier: 0.9,
  min_pause_ms: 2000,
  max_pause_ms: 12000,
  spaced_rep_fraction: 0.33,
  debut_phrases_fraction: 0.5,
  skip_voice2: false,
  fibKeep: [0, 1, 2, 4, 6, 8],
  buildKeep: 3,
  useKeep: 2,
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

// Singleton cache - shared across all component instances
let configCache: AlgorithmConfigs | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function useAlgorithmConfig(supabase: Ref<any> | null) {
  const configs = ref<AlgorithmConfigs>({
    normal_mode: DEFAULT_NORMAL,
    turbo_boost: DEFAULT_TURBO,
    listening: DEFAULT_LISTENING,
    pods: DEFAULT_PODS,
    script_shape: DEFAULT_SCRIPT_SHAPE,
    resume: DEFAULT_RESUME,
    stage0: DEFAULT_STAGE0,
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
          normal_mode: { ...DEFAULT_NORMAL, ...(loaded.normal_mode || {}) },
          turbo_boost: { ...DEFAULT_TURBO, ...(loaded.turbo_boost || {}) },
          listening: { ...DEFAULT_LISTENING, ...(loaded.listening || {}) },
          pods: { ...DEFAULT_PODS, ...(loaded.pods || {}) },
          script_shape: { ...DEFAULT_SCRIPT_SHAPE, ...(loaded.script_shape || {}) },
          resume: { ...DEFAULT_RESUME, ...(loaded.resume || {}) },
          stage0: { ...DEFAULT_STAGE0, ...(loaded.stage0 || {}) },
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
  const normalConfig = computed(() => configs.value.normal_mode as ModeConfig)
  const turboConfig = computed(() => configs.value.turbo_boost as ModeConfig)
  const listeningConfig = computed(() => configs.value.listening as ListeningModeConfig)
  const podsConfig = computed(() => configs.value.pods as PodsConfig)
  const scriptShapeConfig = computed(() => configs.value.script_shape as ScriptShapeConfig)
  const resumeConfig = computed(() => configs.value.resume as ResumeConfig)
  const stage0Config = computed(() => configs.value.stage0 as Stage0Config)

  // Get any config by key
  const getConfig = (key: string): ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig | Stage0Config | null => {
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
    normalConfig,
    turboConfig,
    listeningConfig,
    podsConfig,
    scriptShapeConfig,
    resumeConfig,
    stage0Config,
    getConfig,
    calculatePause,
    invalidateCache,
    // Export defaults for reference
    DEFAULT_NORMAL,
    DEFAULT_TURBO,
    DEFAULT_LISTENING,
    DEFAULT_PODS,
    DEFAULT_SCRIPT_SHAPE,
    DEFAULT_RESUME,
  }
}
