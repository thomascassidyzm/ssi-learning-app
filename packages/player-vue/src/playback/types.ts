/**
 * Simplified Playback Architecture - Shared Types
 *
 * Core principle: Audio drives everything. UI is pure reaction to events.
 */

import type { Cycle, CycleType } from '../types/Cycle'
import type { LegoPair, SeedPair, PracticePhrase, LegoProgress, ClassifiedBasket } from '@ssi/core'

// ============================================
// CYCLE EVENTS - Audio-driven, UI reacts
// ============================================

export type CyclePhase = 'idle' | 'prompt' | 'pause' | 'voice1' | 'voice2'

export type CycleEventType =
  | 'phase:prompt'   // Known audio starting
  | 'phase:pause'    // Learner speaks (pause starting)
  | 'phase:voice1'   // Target voice1 starting
  | 'phase:voice2'   // Target voice2 starting (text appears!)
  | 'cycle:complete' // Cycle done
  | 'cycle:error'    // Error occurred

export interface CycleEventData {
  type: CycleEventType
  cycle: Cycle
  phase: CyclePhase
  timestamp: number
  error?: string
}

export type CycleEventHandler = (event: CycleEventData) => void

// ============================================
// THREAD SYSTEM - Triple Helix
// ============================================

export type ThreadId = 'A' | 'B' | 'C'

export interface ThreadState {
  /** LEGOs assigned to this thread (card-dealt) */
  legos: LegoPair[]
  /** Progress for each LEGO in this thread */
  progress: Map<string, LegoProgress>
  /** Current position in the thread's LEGO sequence */
  currentIndex: number
}

export interface ThreadManagerState {
  threads: Map<ThreadId, ThreadState>
  activeThread: ThreadId
  /** Serializable snapshot for persistence */
  toJSON(): SerializedThreadState
}

export interface SerializedThreadState {
  activeThread: ThreadId
  threads: {
    [K in ThreadId]?: {
      legoIds: string[]
      currentIndex: number
      progress: Array<{ legoId: string; progress: LegoProgress }>
    }
  }
}

// ============================================
// SCRIPT ITEMS - Direct LearningPlayer format
// ============================================

/**
 * ScriptItem - exactly what LearningPlayer expects
 * No bridge needed, this IS the output format
 */
export type ScriptItemType = 'intro' | 'debut' | 'debut_phrase' | 'spaced_rep' | 'consolidation'

export interface ScriptItem {
  type: ScriptItemType
  roundNumber: number
  legoId: string
  legoIndex: number  // 1-based position in course
  seedId: string
  knownText: string
  targetText: string
  audioRefs: {
    known: { id: string; url: string }
    target: {
      voice1: { id: string; url: string }
      voice2: { id: string; url: string }
    }
  }
  audioDurations?: {
    source: number
    target1: number
    target2: number
  }
  /** For spaced_rep: which LEGO is being reviewed (1-based index) */
  reviewOf?: number
  /** For spaced_rep: which Fibonacci position triggered this */
  fibonacciPosition?: number
  /** For INTRO items: presentation audio ("The Welsh for X is...") */
  presentationAudio?: { id: string; url: string }
  /** For INTRO items on M-type LEGOs: visual component breakdown */
  components?: Array<{ known: string; target: string }>
}

/**
 * Round - exactly what LearningPlayer expects
 */
export interface Round {
  roundNumber: number
  legoId: string
  legoIndex: number
  seedId: string
  items: ScriptItem[]
  spacedRepReviews: number[]  // LEGO indices being reviewed
}

// ============================================
// SESSION SYSTEM - Single Controller
// ============================================

export type SessionState =
  | 'idle'      // Not started
  | 'loading'   // Initializing data
  | 'playing'   // Active playback
  | 'paused'    // User paused
  | 'complete'  // Session finished

export type SessionEventType =
  | 'session:started'
  | 'session:paused'
  | 'session:resumed'
  | 'session:complete'
  | 'round:started'
  | 'round:completed'
  | 'round:loaded'    // Round added via lazy loading
  | 'round:loading'   // Waiting for round to load
  | 'item:started'
  | 'item:completed'

export interface SessionEventData {
  type: SessionEventType
  timestamp: number
  round?: Round
  item?: ScriptItem
  itemIndex?: number
  progress?: SessionProgress
  /** For round:loaded and round:loading events */
  roundNumber?: number
}

export type SessionEventHandler = (event: SessionEventData) => void

export interface SessionProgress {
  /** Current round number (1-based for display) */
  roundNumber: number
  /** Current item index within round (0-based) */
  itemIndex: number
  /** Total items in current round */
  totalItemsInRound: number
  /** Total rounds completed */
  roundsCompleted: number
  /** Total rounds in session */
  totalRounds: number
  /** LEGOs mastered this session */
  legosMastered: number
}

// ============================================
// RESUME SUPPORT
// ============================================

export interface ResumePoint {
  /** Course ID */
  courseId: string
  /** Round to resume from */
  roundNumber: number
  /** Seed number to resume from (usually same as roundNumber for lazy loading) */
  seedNumber?: number
  /** Thread state at resume point */
  threadState: SerializedThreadState
  /** Timestamp of last activity */
  timestamp: number
}

// ============================================
// AUDIO SOURCE RESOLUTION
// ============================================

export type AudioSource =
  | { type: 'blob'; blob: Blob }
  | { type: 'url'; url: string }

export type GetAudioSourceFn = (audioId: string) => Promise<AudioSource | null>

// ============================================
// ROUND TEMPLATES - SessionController format
// ============================================

/**
 * RoundItem - A playable item within a round
 * Extends ScriptItem with optional Cycle for 4-phase playback
 */
export interface RoundItem extends ScriptItem {
  /** The Cycle to play (null for intro items that only have presentation audio) */
  cycle?: Cycle | null
  /** Whether this item should be played (can be toggled by config) */
  playable?: boolean
}

/**
 * RoundTemplate - A round with playable items
 * Used by SessionController for playback orchestration
 */
export interface RoundTemplate {
  roundNumber: number
  legoId: string
  legoIndex: number
  seedId: string
  /** Items with optional cycle data for playback */
  items: RoundItem[]
  spacedRepReviews: number[]
}

/**
 * Get playable items from a round template
 * Filters out items where playable is explicitly false
 */
export function getPlayableItems(round: RoundTemplate): RoundItem[] {
  return round.items.filter(item => item.playable !== false)
}

/**
 * Apply config to a round template
 * Sets playable flags based on configuration
 */
export function applyConfig(round: RoundTemplate, config: { skipIntros?: boolean; turboMode?: boolean }): RoundTemplate {
  return {
    ...round,
    items: round.items.map(item => ({
      ...item,
      playable: item.type === 'intro'
        ? !(config.skipIntros || config.turboMode)
        : item.playable !== false,
    })),
  }
}
