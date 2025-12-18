/**
 * Engine types for CycleOrchestrator and AudioController
 */

import type { LearningItem, AudioRef } from '../data/types';

// ============================================
// CYCLE PHASES
// ============================================

export enum CyclePhase {
  /** Not playing, waiting for next item */
  IDLE = 'IDLE',
  /** Show KNOWN text, play KNOWN audio */
  PROMPT = 'PROMPT',
  /** Learner attempts TARGET (KNOWN text stays visible, timed gap) */
  PAUSE = 'PAUSE',
  /** Play TARGET audio (voice A), NO target text yet */
  VOICE_1 = 'VOICE_1',
  /** Play TARGET audio (voice B), TARGET text NOW appears */
  VOICE_2 = 'VOICE_2',
  /** Brief transition between items */
  TRANSITION = 'TRANSITION',
}

// ============================================
// CYCLE STATE
// ============================================

export interface CycleState {
  /** Current phase in the cycle */
  phase: CyclePhase;
  /** Current learning item being practiced */
  currentItem: LearningItem | null;
  /** Pause duration in milliseconds */
  pauseDuration: number;
  /** When pause started (for latency measurement) */
  pauseStartTime: number | null;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Current item index in session */
  itemIndex: number;

  // ==========================================
  // Phase timestamps for timing analysis
  // (used by SpeechTimingAnalyzer)
  // ==========================================

  /** When PROMPT phase started (performance.now()) */
  promptStartTime: number | null;
  /** When PROMPT audio finished playing (performance.now()) */
  promptEndTime: number | null;
  /** When VOICE_1 phase started (performance.now()) */
  voice1StartTime: number | null;
}

// ============================================
// CYCLE EVENTS
// ============================================

export type CycleEventType =
  | 'phase_changed'
  | 'item_started'
  | 'item_completed'
  | 'pause_started'
  | 'audio_started'
  | 'audio_completed'
  | 'cycle_stopped'
  | 'error';

export interface CycleEvent {
  type: CycleEventType;
  phase: CyclePhase;
  item: LearningItem | null;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type CycleEventListener = (event: CycleEvent) => void;

// ============================================
// TEXT VISIBILITY
// ============================================

export interface TextVisibility {
  /** Whether to show known language text */
  known: boolean;
  /** Whether to show target language text */
  target: boolean;
}

/**
 * Text visibility rules per phase:
 * - IDLE: nothing
 * - PROMPT: known only
 * - PAUSE: known only
 * - VOICE_1: known only
 * - VOICE_2: known AND target
 * - TRANSITION: nothing
 */
export const TEXT_VISIBILITY: Record<CyclePhase, TextVisibility> = {
  [CyclePhase.IDLE]: { known: false, target: false },
  [CyclePhase.PROMPT]: { known: true, target: false },
  [CyclePhase.PAUSE]: { known: true, target: false },
  [CyclePhase.VOICE_1]: { known: true, target: false },
  [CyclePhase.VOICE_2]: { known: true, target: true },
  [CyclePhase.TRANSITION]: { known: false, target: false },
};

// ============================================
// AUDIO CONTROLLER INTERFACE
// ============================================

export interface IAudioController {
  /** Play a single audio file */
  play(audioRef: AudioRef): Promise<void>;
  /** Stop current playback */
  stop(): void;
  /** Preload audio files for smooth playback */
  preload(audioRefs: AudioRef[]): Promise<void>;
  /** Check if an audio file is preloaded */
  isPreloaded(audioRef: AudioRef): boolean;
  /** Check if currently playing */
  isPlaying(): boolean;
  /** Get current playback position in ms */
  getCurrentTime(): number;
  /** Add playback event listener */
  onEnded(callback: () => void): void;
  /** Remove playback event listener */
  offEnded(callback: () => void): void;
}

// ============================================
// CYCLE ORCHESTRATOR INTERFACE
// ============================================

export interface ICycleOrchestrator {
  /** Get current state */
  getState(): CycleState;
  /** Start playing an item */
  startItem(item: LearningItem): Promise<void>;
  /** Stop playback */
  stop(): void;
  /** Skip to next phase (user control) */
  skipPhase(): void;
  /** Add event listener */
  addEventListener(listener: CycleEventListener): void;
  /** Remove event listener */
  removeEventListener(listener: CycleEventListener): void;
  /** Get text visibility for current phase */
  getTextVisibility(): TextVisibility;
}
