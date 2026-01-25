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
// ROUND SYSTEM - Immutable Templates
// ============================================

export type RoundItemType =
  | 'intro'          // "The Spanish for X is..."
  | 'debut'          // First practice of the LEGO itself
  | 'practice'       // BUILD phase: drilling the new LEGO
  | 'spaced_rep'     // REVIEW phase: items from other threads
  | 'consolidation'  // Final reinforcement

export interface RoundItem {
  /** Unique identifier for this item */
  id: string
  /** Type of item in the round */
  type: RoundItemType
  /** Whether this item should be played (config-driven) */
  playable: boolean
  /** The cycle to play (null for intro which is audio-only) */
  cycle: Cycle | null
  /** For M-type intro: component pairs to display */
  components?: ComponentPair[]
  /** Original phrase data for tracking */
  phrase?: PracticePhrase
}

export interface ComponentPair {
  known: string
  target: string
}

export interface RoundTemplate {
  /** Round number in the session */
  roundNumber: number
  /** LEGO being introduced/practiced */
  legoId: string
  /** Thread this round belongs to */
  thread: ThreadId
  /** Ordered list of items in the round */
  items: RoundItem[]
  /** Total playable items (after config applied) */
  playableCount: number
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
  | 'item:started'
  | 'item:completed'

export interface SessionEventData {
  type: SessionEventType
  timestamp: number
  round?: RoundTemplate
  item?: RoundItem
  itemIndex?: number
  progress?: SessionProgress
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
