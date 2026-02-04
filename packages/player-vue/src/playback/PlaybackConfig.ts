/**
 * Simplified Playback Architecture - Configuration
 *
 * Config changes flip `playable` flags on RoundTemplates, never rebuild them.
 */

export interface PlaybackConfig {
  /** Turbo mode: faster transitions (shorter pauses) */
  turboMode: boolean

  /** Pause duration multiplier: 0.5 (fast) to 2.0 (slow) */
  pauseMultiplier: number

  /** Adjust pause duration based on performance */
  adaptivePause: boolean

  /** Number of spaced rep items to interleave per round */
  spacedRepCount: number

  /** Number of consolidation items at round end */
  consolidationCount: number

  /** Maximum BUILD phase phrases per round */
  maxBuildPhrases: number
}

export const DEFAULT_PLAYBACK_CONFIG: PlaybackConfig = {
  turboMode: false,
  pauseMultiplier: 1.0,
  adaptivePause: true,
  spacedRepCount: 3,
  consolidationCount: 2,
  maxBuildPhrases: 7,
}

/**
 * Turbo mode preset: for experienced learners who want fast drilling
 */
export const TURBO_CONFIG: Partial<PlaybackConfig> = {
  turboMode: true,
  pauseMultiplier: 0.75,
  adaptivePause: false,
}

/**
 * Beginner mode preset: slower pace, full intros
 */
export const BEGINNER_CONFIG: Partial<PlaybackConfig> = {
  turboMode: false,
  pauseMultiplier: 1.25,
  adaptivePause: true,
}

/**
 * Create a config by merging overrides with defaults
 */
export function createPlaybackConfig(overrides?: Partial<PlaybackConfig>): PlaybackConfig {
  return {
    ...DEFAULT_PLAYBACK_CONFIG,
    ...overrides,
  }
}

/**
 * Calculate actual pause duration based on config and base duration
 */
export function calculatePauseDuration(
  baseDurationMs: number,
  config: PlaybackConfig
): number {
  return Math.round(baseDurationMs * config.pauseMultiplier)
}
