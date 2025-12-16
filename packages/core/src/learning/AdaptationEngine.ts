/**
 * AdaptationEngine - Orchestrates adaptive learning responses
 *
 * Responsibilities:
 * - Integrates MetricsTracker, SpikeDetector, MasteryStateMachine, and WeightedSelector
 * - Determines how to respond to learning patterns
 * - Manages breakdown/repeat sequences for M-type LEGOs
 * - Provides hooks for the TripleHelixEngine to adapt
 * - Tracks mastery state progression per LEGO
 * - Provides weighted selection for LEGO prioritization
 */

import type { LearningConfig, WeightedSelectionConfig } from '../config/types';
import type { LegoPair, LearningItem } from '../data/types';
import type {
  AdaptedItem,
  SpikeResponse,
  PauseExtensionState,
  MasteryTransition,
  DiscontinuitySeverity,
  SeverityLevel,
  LegoMasteryState,
} from './types';
import { MetricsTracker, createMetricsTracker } from './MetricsTracker';
import { SpikeDetector, createSpikeDetector } from './SpikeDetector';
import { MasteryStateMachine, createMasteryStateMachine } from './MasteryStateMachine';
import {
  WeightedSelector,
  createWeightedSelector,
  type LegoCandidate,
  type LegoSelectionData,
} from './WeightedSelector';

export interface AdaptationEngineConfig {
  config: LearningConfig;
}

interface BreakdownState {
  /** LEGO being broken down */
  legoId: string;
  /** Components to practice */
  componentIds: string[];
  /** Current component index */
  currentIndex: number;
  /** Whether we've started buildup */
  inBuildup: boolean;
}

/**
 * Default weighted selection config
 */
const DEFAULT_WEIGHTED_SELECTION_CONFIG: WeightedSelectionConfig = {
  staleness_rate: 0.1,
  struggle_multiplier: 0.5,
  recency_window: 30,
};

export class AdaptationEngine {
  private config: LearningConfig;
  private metricsTracker: MetricsTracker;
  private spikeDetector: SpikeDetector;
  private masteryStateMachine: MasteryStateMachine;
  private weightedSelector: WeightedSelector;
  private breakdownState: BreakdownState | null = null;
  private pauseExtensionState: PauseExtensionState;
  private enabled: boolean;

  constructor({ config }: AdaptationEngineConfig) {
    this.config = config;
    this.enabled = config.features.spike_detection_enabled;

    // Initialize pause extension state
    this.pauseExtensionState = {
      isExtended: false,
      itemsRemaining: 0,
      factor: config.spike.pause_extension_factor,
    };

    // Create metrics tracker
    this.metricsTracker = createMetricsTracker({
      spike: config.spike,
    });

    // Create spike detector
    this.spikeDetector = createSpikeDetector(
      { spike: config.spike },
      this.metricsTracker
    );

    // Create mastery state machine
    this.masteryStateMachine = createMasteryStateMachine();

    // Create weighted selector
    this.weightedSelector = createWeightedSelector(DEFAULT_WEIGHTED_SELECTION_CONFIG);
  }

  /**
   * Start a new session
   */
  startSession(sessionId: string): void {
    this.metricsTracker.startSession(sessionId);
    this.spikeDetector.resetState();
    this.breakdownState = null;
    this.pauseExtensionState = {
      isExtended: false,
      itemsRemaining: 0,
      factor: this.config.spike.pause_extension_factor,
    };
  }

  /**
   * End the current session
   */
  endSession() {
    return this.metricsTracker.endSession();
  }

  /**
   * Process a completed learning cycle and determine next action
   *
   * @param item - The item that was just practiced
   * @param responseLatencyMs - How long the learner took to respond
   * @param wasFast - Whether response was faster than learner's pattern (optional)
   * @returns What to do next (continue, repeat, or breakdown)
   */
  processCompletion(
    item: LearningItem,
    responseLatencyMs: number,
    wasFast: boolean = false
  ): AdaptedItem & { masteryTransition?: MasteryTransition | null } {
    // Decrement pause extension counter at start of each item
    this.decrementPauseExtension();

    // If we're in a breakdown sequence, continue it
    if (this.breakdownState) {
      return this.continueBreakdown();
    }

    const { lego, phrase, thread_id } = item;

    // Record the metric
    const metric = this.metricsTracker.recordResponse(
      lego.id,
      responseLatencyMs,
      phrase.phrase.target.length,
      thread_id,
      item.mode
    );

    // Update weighted selector - record practice
    this.weightedSelector.updateAfterPractice(lego.id);

    // If spike detection is disabled, record smooth and continue
    if (!this.enabled) {
      const transition = this.masteryStateMachine.recordSmooth(lego.id, wasFast);
      return {
        original_lego_id: lego.id,
        action: 'continue',
        reason: 'Spike detection disabled',
        masteryTransition: transition,
      };
    }

    // Process through spike detector
    const { detection, response, spike } = this.spikeDetector.processResponse(
      lego.id,
      metric.normalized_latency,
      lego.type,
      thread_id
    );

    // Update mastery state based on spike detection
    let masteryTransition: MasteryTransition | null = null;
    if (spike) {
      // Map severity to discontinuity severity (get from detection, not spike)
      const severity = this.mapSeverityToDiscontinuity(detection.severity);
      masteryTransition = this.masteryStateMachine.recordDiscontinuity(lego.id, severity);

      // Record discontinuity in weighted selector (increases priority for this LEGO)
      this.weightedSelector.recordDiscontinuity(lego.id);
    } else {
      // No spike - record smooth response
      masteryTransition = this.masteryStateMachine.recordSmooth(lego.id, wasFast);
    }

    // If a spike was detected and we're taking action, extend pause
    if (spike && response.action !== 'none' && !response.in_cooldown) {
      this.triggerPauseExtension();
    }

    // Handle the response
    const result = this.handleSpikeResponse(response, lego, spike);
    return {
      ...result,
      masteryTransition,
    };
  }

  /**
   * Map SeverityLevel to DiscontinuitySeverity
   */
  private mapSeverityToDiscontinuity(severity: SeverityLevel): DiscontinuitySeverity {
    switch (severity) {
      case 'none':
        return 'mild'; // Should not happen, but default to mild
      case 'mild':
        return 'mild';
      case 'moderate':
        return 'moderate';
      case 'severe':
        return 'severe';
      default:
        return 'mild';
    }
  }

  /**
   * Trigger pause extension when spike detected
   */
  private triggerPauseExtension(): void {
    if (this.config.spike.pause_extension_enabled) {
      this.pauseExtensionState.isExtended = true;
      this.pauseExtensionState.itemsRemaining =
        this.config.spike.pause_extension_duration;
    }
  }

  /**
   * Decrement pause extension counter
   */
  private decrementPauseExtension(): void {
    if (this.pauseExtensionState.isExtended && this.pauseExtensionState.itemsRemaining > 0) {
      this.pauseExtensionState.itemsRemaining--;
      if (this.pauseExtensionState.itemsRemaining <= 0) {
        this.pauseExtensionState.isExtended = false;
      }
    }
  }

  /**
   * Check if we're currently in a breakdown sequence
   */
  isInBreakdown(): boolean {
    return this.breakdownState !== null;
  }

  /**
   * Get the current breakdown state (if any)
   */
  getBreakdownState(): BreakdownState | null {
    return this.breakdownState ? { ...this.breakdownState } : null;
  }

  /**
   * Get the metrics tracker for external monitoring
   */
  getMetricsTracker(): MetricsTracker {
    return this.metricsTracker;
  }

  /**
   * Get the spike detector for external monitoring
   */
  getSpikeDetector(): SpikeDetector {
    return this.spikeDetector;
  }

  /**
   * Enable or disable spike detection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if spike detection is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the recommended pause duration multiplier
   *
   * Returns 1.0 for normal pause, or (1 + extension_factor) if extended.
   * Example: if extension_factor is 0.3, returns 1.3 when extended.
   *
   * Use this to adjust pause timing in CycleOrchestrator:
   *   effectivePause = basePause * getPauseDurationMultiplier()
   */
  getPauseDurationMultiplier(): number {
    if (
      this.config.spike.pause_extension_enabled &&
      this.pauseExtensionState.isExtended &&
      this.pauseExtensionState.itemsRemaining > 0
    ) {
      return 1 + this.pauseExtensionState.factor;
    }
    return 1.0;
  }

  /**
   * Get the current pause extension state
   */
  getPauseExtensionState(): PauseExtensionState {
    return { ...this.pauseExtensionState };
  }

  /**
   * Manually extend pause (for testing or external control)
   */
  extendPause(durationItems?: number): void {
    this.pauseExtensionState.isExtended = true;
    this.pauseExtensionState.itemsRemaining =
      durationItems ?? this.config.spike.pause_extension_duration;
  }

  /**
   * Clear pause extension
   */
  clearPauseExtension(): void {
    this.pauseExtensionState.isExtended = false;
    this.pauseExtensionState.itemsRemaining = 0;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LearningConfig>): void {
    if (config.spike) {
      this.config.spike = { ...this.config.spike, ...config.spike };
      this.metricsTracker.updateConfig({ spike: this.config.spike });
      this.spikeDetector.updateConfig({ spike: this.config.spike });
    }

    if (config.features?.spike_detection_enabled !== undefined) {
      this.enabled = config.features.spike_detection_enabled;
    }
  }

  /**
   * Handle the spike response
   */
  private handleSpikeResponse(
    response: SpikeResponse,
    lego: LegoPair,
    _spike?: unknown
  ): AdaptedItem {
    switch (response.action) {
      case 'none':
        return {
          original_lego_id: lego.id,
          action: 'continue',
          reason: response.reason,
        };

      case 'repeat':
        return {
          original_lego_id: lego.id,
          action: 'repeat',
          reason: response.reason,
        };

      case 'breakdown':
        // Start breakdown sequence for M-type
        if (lego.type === 'M' && lego.components && lego.components.length > 0) {
          this.startBreakdown(lego);
          return {
            original_lego_id: lego.id,
            action: 'breakdown',
            breakdown_components: lego.components.map((_, i) => `${lego.id}_C${i}`),
            reason: response.reason,
          };
        } else {
          // Fall back to repeat if no components
          return {
            original_lego_id: lego.id,
            action: 'repeat',
            reason: `${response.reason} (no components for breakdown)`,
          };
        }

      default:
        return {
          original_lego_id: lego.id,
          action: 'continue',
          reason: 'Unknown response',
        };
    }
  }

  /**
   * Start a breakdown sequence
   */
  private startBreakdown(lego: LegoPair): void {
    if (!lego.components) return;

    this.breakdownState = {
      legoId: lego.id,
      componentIds: lego.components.map((_, i) => `${lego.id}_C${i}`),
      currentIndex: 0,
      inBuildup: false,
    };
  }

  /**
   * Continue the current breakdown sequence
   */
  private continueBreakdown(): AdaptedItem {
    if (!this.breakdownState) {
      return {
        original_lego_id: null,
        action: 'continue',
        reason: 'No breakdown in progress',
      };
    }

    const state = this.breakdownState;

    if (!state.inBuildup) {
      // Still breaking down
      state.currentIndex++;

      if (state.currentIndex >= state.componentIds.length) {
        // Done breaking down, start buildup
        state.inBuildup = true;
        state.currentIndex = 0;

        return {
          original_lego_id: state.legoId,
          action: 'breakdown',
          breakdown_components: state.componentIds,
          reason: 'Starting buildup after breakdown',
        };
      }

      return {
        original_lego_id: state.legoId,
        action: 'breakdown',
        breakdown_components: [state.componentIds[state.currentIndex]],
        reason: `Breakdown component ${state.currentIndex + 1}/${state.componentIds.length}`,
      };
    } else {
      // In buildup
      state.currentIndex++;

      if (state.currentIndex >= state.componentIds.length) {
        // Done with buildup, clear state
        const legoId = state.legoId;
        this.breakdownState = null;

        return {
          original_lego_id: legoId,
          action: 'continue',
          reason: 'Breakdown/buildup complete',
        };
      }

      return {
        original_lego_id: state.legoId,
        action: 'breakdown',
        breakdown_components: state.componentIds.slice(0, state.currentIndex + 1),
        reason: `Buildup ${state.currentIndex + 1}/${state.componentIds.length}`,
      };
    }
  }

  // ============================================
  // Mastery State Machine Integration
  // ============================================

  /**
   * Get the mastery state machine for external access
   */
  getMasteryStateMachine(): MasteryStateMachine {
    return this.masteryStateMachine;
  }

  /**
   * Get mastery state for a specific LEGO
   */
  getMasteryState(legoId: string): LegoMasteryState | undefined {
    return this.masteryStateMachine.getState(legoId);
  }

  /**
   * Get typical skip value for a LEGO based on mastery state
   * Returns the central skip value for the LEGO's current mastery level
   */
  getTypicalSkip(legoId: string): number {
    return this.masteryStateMachine.getTypicalSkip(legoId);
  }

  /**
   * Get all LEGOs in a specific mastery state
   */
  getLegosByMasteryState(
    state: 'acquisition' | 'consolidating' | 'confident' | 'mastered'
  ): string[] {
    return this.masteryStateMachine.getLegosByState(state);
  }

  /**
   * Get mastery statistics across all tracked LEGOs
   */
  getMasteryStats(): {
    acquisition: number;
    consolidating: number;
    confident: number;
    mastered: number;
    total: number;
  } {
    const stats = this.masteryStateMachine.getStats();
    return {
      acquisition: stats.by_state.acquisition,
      consolidating: stats.by_state.consolidating,
      confident: stats.by_state.confident,
      mastered: stats.by_state.mastered,
      total: stats.total,
    };
  }

  // ============================================
  // Weighted Selection Integration
  // ============================================

  /**
   * Get the weighted selector for external access
   */
  getWeightedSelector(): WeightedSelector {
    return this.weightedSelector;
  }

  /**
   * Select the next LEGO from candidates using weighted selection
   *
   * @param candidates - Array of candidate LEGOs with their data
   * @returns The selected LEGO ID, or null if no candidates
   */
  selectFromCandidates(candidates: LegoCandidate[]): string | null {
    if (candidates.length === 0) return null;
    const selected = this.weightedSelector.selectFromCandidates(candidates);
    return selected.lego_id;
  }

  /**
   * Get selection data for a specific LEGO
   * Useful for debugging or UI feedback
   */
  getSelectionData(legoId: string): LegoSelectionData {
    return this.weightedSelector.getLegoData(legoId);
  }

  /**
   * Get selection weight for a LEGO
   * Higher weight = more likely to be selected
   */
  getSelectionWeight(legoId: string): number {
    const data = this.weightedSelector.getLegoData(legoId);
    const calc = this.weightedSelector.calculateWeight(legoId, data);
    return calc.weight;
  }

  /**
   * Initialize selection data for a new LEGO
   * Call this when a LEGO is first introduced
   */
  initializeLego(legoId: string): void {
    this.weightedSelector.initializeLego(legoId);
    // Mastery state machine auto-initializes on first interaction
  }

  /**
   * Get weighted selection for all candidates with their weights
   * Useful for debugging or showing selection probabilities
   */
  getCandidateWeights(candidates: LegoCandidate[]): Array<{ lego_id: string; weight: number }> {
    return candidates.map((candidate) => {
      const calc = this.weightedSelector.calculateWeight(candidate.lego_id, candidate.data);
      return {
        lego_id: candidate.lego_id,
        weight: calc.weight,
      };
    });
  }

  // ============================================
  // Combined Mastery + Selection Helpers
  // ============================================

  /**
   * Get LEGOs that need attention (struggling or stale)
   * Combines mastery state with selection priority
   */
  getLegosNeedingAttention(): string[] {
    // Get LEGOs still in acquisition
    const inAcquisition = this.masteryStateMachine.getLegosByState('acquisition');

    // Get LEGOs that have had discontinuities (from weighted selector)
    const allData = this.weightedSelector.getAllLegoData();
    const struggling: string[] = [];
    allData.forEach((data, legoId) => {
      if (data.discontinuity_count > 0) {
        struggling.push(legoId);
      }
    });

    // Combine and deduplicate
    const needsAttention = new Set([...inAcquisition, ...struggling]);
    return Array.from(needsAttention);
  }

  /**
   * Reset tracking for a specific LEGO
   * Use when content changes or for testing
   */
  resetLegoTracking(legoId: string): void {
    this.masteryStateMachine.resetState(legoId);
    this.weightedSelector.resetLego(legoId);
  }
}

/**
 * Factory function
 */
export function createAdaptationEngine(config: LearningConfig): AdaptationEngine {
  return new AdaptationEngine({ config });
}
