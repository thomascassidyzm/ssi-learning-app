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
  l1ActiveInterval: number    // active fires every N rounds
  l1ReserveSize: number       // older graduated seeds beyond active
  l1ReserveInterval: number   // reserve fires every N rounds (coprime with active)
  layer1Playlist: ('ps' | 'ps2x' | 'trans')[]
  podActivationRound: number  // global default; per-learner pin still wins
}

export interface AlgorithmConfigs {
  normal_mode: ModeConfig
  turbo_boost: ModeConfig
  listening: ListeningModeConfig
  [key: string]: ModeConfig | ListeningModeConfig   // Allow future configs
}

// Default fallbacks (used if DB fetch fails)
const DEFAULT_NORMAL: ModeConfig = {
  playback_speed: 1.0,
  pause_base_ms: 1500,
  pause_multiplier: 1.0,
  min_pause_ms: 3000,
  max_pause_ms: 8000,
  spaced_rep_fraction: 1.0,
  debut_phrases_fraction: 1.0,
  skip_voice2: false
}

const DEFAULT_TURBO: ModeConfig = {
  playback_speed: 1.25,
  pause_base_ms: 500,
  pause_multiplier: 0.5,
  min_pause_ms: 800,
  max_pause_ms: 2000,
  spaced_rep_fraction: 0.33,
  debut_phrases_fraction: 0.5,
  skip_voice2: false
}

const DEFAULT_LISTENING: ListeningModeConfig = {
  enabled: true,
  offset: 56,
  l1ActiveSize: 10,
  l1ActiveInterval: 3,
  l1ReserveSize: 50,
  l1ReserveInterval: 13,
  layer1Playlist: ['ps', 'ps2x', 'ps2x'],
  podActivationRound: 6,
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

        // Merge with defaults (in case some keys are missing)
        configs.value = {
          normal_mode: loaded.normal_mode || DEFAULT_NORMAL,
          turbo_boost: loaded.turbo_boost || DEFAULT_TURBO,
          // Field-level merge for listening so a partial DB row (e.g. only
          // layer1Playlist set) doesn't drop the rest of the defaults.
          listening: { ...DEFAULT_LISTENING, ...(loaded.listening || {}) },
          ...loaded
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

  // Get any config by key
  const getConfig = (key: string): ModeConfig | ListeningModeConfig | null => {
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
    getConfig,
    calculatePause,
    invalidateCache,
    // Export defaults for reference
    DEFAULT_NORMAL,
    DEFAULT_TURBO,
    DEFAULT_LISTENING,
  }
}
