/**
 * AdaptationEngine - Orchestrates adaptive learning responses
 *
 * Responsibilities:
 * - Integrates MetricsTracker and SpikeDetector
 * - Determines how to respond to learning patterns
 * - Manages breakdown/repeat sequences for M-type LEGOs
 * - Provides hooks for the TripleHelixEngine to adapt
 */

import type { LearningConfig } from '../config/types';
import type { LegoPair, LearningItem } from '../data/types';
import type { AdaptedItem, SpikeResponse } from './types';
import { MetricsTracker, createMetricsTracker } from './MetricsTracker';
import { SpikeDetector, createSpikeDetector } from './SpikeDetector';

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

export class AdaptationEngine {
  private config: LearningConfig;
  private metricsTracker: MetricsTracker;
  private spikeDetector: SpikeDetector;
  private breakdownState: BreakdownState | null = null;
  private enabled: boolean;

  constructor({ config }: AdaptationEngineConfig) {
    this.config = config;
    this.enabled = config.features.spike_detection_enabled;

    // Create metrics tracker
    this.metricsTracker = createMetricsTracker({
      spike: config.spike,
    });

    // Create spike detector
    this.spikeDetector = createSpikeDetector(
      { spike: config.spike },
      this.metricsTracker
    );
  }

  /**
   * Start a new session
   */
  startSession(sessionId: string): void {
    this.metricsTracker.startSession(sessionId);
    this.spikeDetector.resetState();
    this.breakdownState = null;
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
   * @returns What to do next (continue, repeat, or breakdown)
   */
  processCompletion(
    item: LearningItem,
    responseLatencyMs: number
  ): AdaptedItem {
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

    // If spike detection is disabled, just continue
    if (!this.enabled) {
      return {
        original_lego_id: lego.id,
        action: 'continue',
        reason: 'Spike detection disabled',
      };
    }

    // Process through spike detector
    const { response, spike } = this.spikeDetector.processResponse(
      lego.id,
      metric.normalized_latency,
      lego.type,
      thread_id
    );

    // Handle the response
    return this.handleSpikeResponse(response, lego, spike);
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
}

/**
 * Factory function
 */
export function createAdaptationEngine(config: LearningConfig): AdaptationEngine {
  return new AdaptationEngine({ config });
}
