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

// Type definitions for algorithm configs
export interface ModeConfig {
  playback_speed: number      // 1.0 = normal, 1.25 = 25% faster
  pause_base_ms: number       // Base pause before multiplier
  pause_multiplier: number    // Multiplied by target audio duration
  min_pause_ms: number        // Floor for pause duration
  max_pause_ms: number        // Ceiling for pause duration
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

/** Layer 2 (Listening Pod) scheduler — gap matrix + stage progression. */
export interface PodsConfig {
  stagePlaylist: Record<string, ListeningSlotRole[]>  // keyed by stage number as string
  stageDuration: number       // pod-rounds per transitional stage; highest key = eternal
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
   *  resumes the exact cycle; a real break restarts the round. ~2 min cutoff. */
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
  l1ActiveSize: number        // sliding window size of recent graduated seeds
  l1ReserveSize: number       // older graduated seeds beyond active (fixed window)
  /** Sentences pulled per URN draw for RESERVE and RETIRED. Consumed
   * by Listening MODE — L1 is no longer interleaved with main flow. */
  l1UrnPullCount: number
  /** Legacy / fallback flat playlist — used when layer1StagePlaylist is empty. */
  layer1Playlist: ListeningSlotRole[]
  /** Staged Layer 1 playlist — keys are stage numbers, values are the
   * playlist for that stage. Per-seed fire counter advances each L1
   * emission; stage = floor((fireCount-1)/layer1StageDuration)+1, capped
   * at the highest key (eternal hold). Aran 2026-05-07 spec: seeds
   * decay to a single 2× rep over time. */
  layer1StagePlaylist: Record<string, ListeningSlotRole[]>
  /** L1 fires spent in each transitional stage before promoting. */
  layer1StageDuration: number
  /** @deprecated Moved to PodsConfig.podActivationRound (2026-05-17).
   *  Optional/read-only here for legacy rows whose `pods` config hasn't
   *  been re-saved yet. The dashboard backfills on next load. */
  podActivationRound?: number
}

export interface AlgorithmConfigs {
  normal_mode: ModeConfig
  turbo_boost: ModeConfig
  listening: ListeningModeConfig
  pods: PodsConfig
  script_shape: ScriptShapeConfig
  resume: ResumeConfig
  [key: string]: ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig
}

// Default fallbacks (used if DB fetch fails)
//
// Normal-mode pause formula: clamp(min_pause_ms, max_pause_ms, pause_base_ms + (target1 + target2) × pause_multiplier).
// The previous fallback (base 1500, mul 1.0, ceiling 8000) was the legacy too-tight curve;
// values below match the formula deployed for SSi's generate-from-prompt loop, so when
// the DB algorithm_config row is missing the fallback gives the same answer.
export const DEFAULT_NORMAL: ModeConfig = {
  playback_speed: 1.0,
  pause_base_ms: 2000,
  pause_multiplier: 1.5,
  min_pause_ms: 3000,
  max_pause_ms: 22000,
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
  l1ActiveSize: 10,
  l1ReserveSize: 50,
  l1UrnPullCount: 10,
  layer1Playlist: ['ps', 'ps2x', 'ps2x'],
  layer1StagePlaylist: {
    '1': ['ps', 'ps2x', 'ps2x'],
    '2': ['ps2x', 'ps2x', 'ps2x'],
    '3': ['ps2x', 'ps2x'],
    '4': ['ps2x'],
  },
  layer1StageDuration: 3,
}

const DEFAULT_PODS: PodsConfig = {
  // Stage count is dynamic — the runtime reads the key count, the
  // highest-numbered key is the eternal hold. Aran's 2026-05-07 spec
  // adds a new stage 2 to bridge "no 2×" → "all 2×".
  stagePlaylist: {
    '1': ['ps', 'trans', 'ps', 'ps'],
    '2': ['ps', 'trans', 'ps', 'ps2x'],
    '3': ['ps', 'trans', 'ps2x', 'ps2x'],
    '4': ['ps', 'trans', 'ps2x'],
    '5': ['ps2x', 'trans', 'ps2x'],
    '6': ['ps', 'ps2x'],
    '7': ['ps2x', 'ps2x'],
    '8': ['ps2x'],
  },
  stageDuration: 5,
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
  cycleResetMinutes: 2,
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

  // Get any config by key
  const getConfig = (key: string): ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig | null => {
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
