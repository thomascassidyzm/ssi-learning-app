/**
 * SpeechTimingAnalyzer - Coordinates VAD with CycleOrchestrator for timing analysis
 *
 * This class wraps VoiceActivityDetector and provides a simpler interface for
 * the CycleOrchestrator to capture speech timing signals.
 *
 * Usage:
 *   const analyzer = new SpeechTimingAnalyzer(vad);
 *
 *   // When cycle starts (PROMPT phase begins)
 *   analyzer.startCycle();
 *
 *   // When phases change
 *   analyzer.onPhaseChange('PROMPT_END');
 *   analyzer.onPhaseChange('PAUSE');
 *   analyzer.onPhaseChange('VOICE_1');
 *   analyzer.onPhaseChange('VOICE_2');
 *
 *   // When cycle ends
 *   const result = analyzer.endCycle(modelDurationMs);
 */

import type { SpeechTimingResult, TimingPhase, ContinuousVADConfig } from './types';
import type { VoiceActivityDetector } from './VoiceActivityDetector';
import { createEmptySpeechTimingResult } from './types';

/**
 * Events emitted by SpeechTimingAnalyzer
 */
export type SpeechTimingEvent =
  | { type: 'speech_started'; timestamp_ms: number }
  | { type: 'speech_ended'; timestamp_ms: number; duration_ms: number }
  | { type: 'cycle_started' }
  | { type: 'cycle_ended'; result: SpeechTimingResult };

export type SpeechTimingEventListener = (event: SpeechTimingEvent) => void;

/**
 * SpeechTimingAnalyzer coordinates VoiceActivityDetector with learning cycle phases.
 *
 * Key responsibilities:
 * 1. Start/stop continuous VAD monitoring aligned with cycle phases
 * 2. Record phase transition timestamps
 * 3. Provide clean interface for CycleOrchestrator
 * 4. Emit events for UI feedback (optional)
 */
export class SpeechTimingAnalyzer {
  private vad: VoiceActivityDetector;
  private config: Partial<ContinuousVADConfig>;
  private listeners: Set<SpeechTimingEventListener> = new Set();
  private isActive = false;
  private lastResult: SpeechTimingResult | null = null;

  constructor(vad: VoiceActivityDetector, config?: Partial<ContinuousVADConfig>) {
    this.vad = vad;
    this.config = config ?? {};
  }

  /**
   * Start timing analysis for a new learning cycle.
   * Call this when PROMPT phase begins.
   */
  startCycle(): void {
    if (this.isActive) {
      console.warn('SpeechTimingAnalyzer: Cycle already active, stopping previous');
      this.reset();
    }

    if (!this.vad.isInitialized()) {
      console.warn('SpeechTimingAnalyzer: VAD not initialized');
      return;
    }

    this.isActive = true;
    this.lastResult = null;

    // Start continuous monitoring
    this.vad.startContinuousMonitoring(this.config);

    this.emit({ type: 'cycle_started' });
  }

  /**
   * Record a phase transition.
   * Call this when phases change during the cycle.
   *
   * @param phase The phase that is starting, or 'PROMPT_END' when prompt audio ends
   * @param timestamp Optional timestamp (defaults to now)
   */
  onPhaseChange(phase: TimingPhase | 'PROMPT_END', timestamp?: number): void {
    if (!this.isActive) {
      return; // Silently ignore if not active
    }

    this.vad.markPhaseTransition(phase, timestamp);
  }

  /**
   * End the timing analysis cycle and get results.
   *
   * @param modelDurationMs Duration of the target audio (for duration delta calculation)
   * @returns Full timing result with latency, overlap flags, etc.
   */
  endCycle(modelDurationMs: number): SpeechTimingResult {
    if (!this.isActive) {
      console.warn('SpeechTimingAnalyzer: No active cycle');
      return createEmptySpeechTimingResult(0, 0);
    }

    const result = this.vad.stopContinuousMonitoring(modelDurationMs);
    this.isActive = false;
    this.lastResult = result;

    this.emit({ type: 'cycle_ended', result });

    return result;
  }

  /**
   * Reset the analyzer (abort current cycle if active).
   */
  reset(): void {
    if (this.isActive && this.vad.isContinuousMonitoring()) {
      // Stop monitoring without getting results
      this.vad.stopContinuousMonitoring(0);
    }
    this.isActive = false;
    this.lastResult = null;
  }

  /**
   * Check if a timing cycle is currently active.
   */
  isAnalyzing(): boolean {
    return this.isActive;
  }

  /**
   * Get the last timing result (from previous cycle).
   */
  getLastResult(): SpeechTimingResult | null {
    return this.lastResult;
  }

  /**
   * Update configuration for future cycles.
   */
  updateConfig(config: Partial<ContinuousVADConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Add an event listener.
   */
  addEventListener(listener: SpeechTimingEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove an event listener.
   */
  removeEventListener(listener: SpeechTimingEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(event: SpeechTimingEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('SpeechTimingAnalyzer: Listener error', error);
      }
    }
  }
}

/**
 * Factory function to create a SpeechTimingAnalyzer.
 */
export function createSpeechTimingAnalyzer(
  vad: VoiceActivityDetector,
  config?: Partial<ContinuousVADConfig>
): SpeechTimingAnalyzer {
  return new SpeechTimingAnalyzer(vad, config);
}
