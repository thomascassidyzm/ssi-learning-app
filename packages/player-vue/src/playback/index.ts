/**
 * Simplified Playback Architecture - Barrel Export
 *
 * Five focused components with well-defined interfaces:
 * 1. CyclePlayer - Event-driven 4-phase playback
 * 2. ThreadManager - Triple Helix with per-thread spaced rep
 * 3. RoundBuilder - Immutable round templates
 * 4. SessionController - Single orchestrator
 * 5. PlaybackConfig - Configuration types
 */

// Types
export * from './types'

// Configuration
export {
  type PlaybackConfig,
  DEFAULT_PLAYBACK_CONFIG,
  TURBO_CONFIG,
  BEGINNER_CONFIG,
  createPlaybackConfig,
  calculatePauseDuration,
} from './PlaybackConfig'

// CyclePlayer
export {
  type CyclePlayer,
  type CyclePlayerState,
  createCyclePlayer,
  useCyclePlayer,
} from './CyclePlayer'

// ThreadManager
export {
  type ThreadManager,
  createThreadManager,
  threadIdFromNumber,
  threadNumberFromId,
} from './ThreadManager'

// RoundBuilder
export {
  buildRound,
  buildRounds,
  calculateSpacedRepReviews,
  type BuildRoundOptions,
} from './RoundBuilder'

// SessionController
export {
  type SessionController,
  createSessionController,
  useSessionController,
} from './SessionController'

// PriorityRoundLoader
export {
  type Belt,
  type LoaderConfig,
  type LoaderProgress,
  PriorityRoundLoader,
  createPriorityRoundLoader,
  BELT_THRESHOLDS,
  BELT_NAMES,
} from './PriorityRoundLoader'
