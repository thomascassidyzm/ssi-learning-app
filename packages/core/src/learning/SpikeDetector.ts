/**
 * SpikeDetector - Detects when a learner is struggling based on response latency
 *
 * Strategy:
 * - Maintains a rolling window of normalized response latencies
 * - Detects spikes when latency exceeds threshold_percent of rolling average
 * - Threshold is relative to learner's OWN average (not absolute)
 * - Respects cooldown period to avoid over-triggering
 */

import type { SpikeConfig } from '../config/types';
import type {
  SpikeDetectionResult,
  SpikeResponse,
  SpikeEvent,
  AdaptationState,
} from './types';
import { MetricsTracker } from './MetricsTracker';

export interface SpikeDetectorConfig {
  spike: SpikeConfig;
}

export class SpikeDetector {
  private config: SpikeDetectorConfig;
  private metricsTracker: MetricsTracker;
  private adaptationState: AdaptationState;

  constructor(config: SpikeDetectorConfig, metricsTracker: MetricsTracker) {
    this.config = config;
    this.metricsTracker = metricsTracker;
    this.adaptationState = {
      alternate_index: 0,
      items_since_spike: Infinity, // Start with no cooldown
      next_response: config.spike.alternate_sequence[0] as 'repeat' | 'breakdown',
    };
  }

  /**
   * Analyze a response and determine if it's a spike
   */
  detectSpike(normalizedLatency: number): SpikeDetectionResult {
    const rollingAverage = this.metricsTracker.getRollingAverage();

    // If we don't have enough data, no spike
    if (!this.metricsTracker.hasEnoughData()) {
      return {
        is_spike: false,
        latency: normalizedLatency,
        rolling_average: rollingAverage,
        threshold: 0,
        ratio: 0,
      };
    }

    const threshold = rollingAverage * (this.config.spike.threshold_percent / 100);
    const ratio = rollingAverage > 0 ? normalizedLatency / rollingAverage : 0;
    const isSpike = normalizedLatency > threshold;

    return {
      is_spike: isSpike,
      latency: normalizedLatency,
      rolling_average: rollingAverage,
      threshold,
      ratio,
    };
  }

  /**
   * Determine what response to take for a spike
   */
  getSpikeResponse(detection: SpikeDetectionResult, legoType: 'A' | 'M'): SpikeResponse {
    // Not a spike? No action
    if (!detection.is_spike) {
      return { action: 'none', reason: 'No spike detected', in_cooldown: false };
    }

    // In cooldown?
    if (this.adaptationState.items_since_spike < this.config.spike.cooldown_items) {
      return {
        action: 'none',
        reason: `In cooldown (${this.adaptationState.items_since_spike}/${this.config.spike.cooldown_items} items)`,
        in_cooldown: true,
      };
    }

    // Determine response based on strategy
    let action: 'repeat' | 'breakdown';

    switch (this.config.spike.response_strategy) {
      case 'repeat':
        action = 'repeat';
        break;

      case 'breakdown':
        // Can only breakdown M-types
        action = legoType === 'M' ? 'breakdown' : 'repeat';
        break;

      case 'alternate':
        // Get next in sequence, but respect type
        const nextResponse = this.adaptationState.next_response;
        if (nextResponse === 'breakdown' && legoType === 'A') {
          // Can't breakdown atomic, use repeat instead
          action = 'repeat';
        } else {
          action = nextResponse;
        }
        break;

      default:
        action = 'repeat';
    }

    return {
      action,
      reason: `Spike detected (ratio: ${detection.ratio.toFixed(2)}x average)`,
      in_cooldown: false,
    };
  }

  /**
   * Process a complete response and return what to do
   */
  processResponse(
    legoId: string,
    normalizedLatency: number,
    legoType: 'A' | 'M',
    threadId: number
  ): { detection: SpikeDetectionResult; response: SpikeResponse; spike?: SpikeEvent } {
    // Increment items since last spike
    this.adaptationState.items_since_spike++;

    // Detect spike
    const detection = this.detectSpike(normalizedLatency);

    // Get response
    const response = this.getSpikeResponse(detection, legoType);

    let spike: SpikeEvent | undefined;

    // If we're taking action, record spike and update state
    if (response.action !== 'none' && !response.in_cooldown) {
      spike = {
        id: `spike-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        lego_id: legoId,
        timestamp: new Date(),
        latency: detection.latency,
        rolling_average: detection.rolling_average,
        spike_ratio: detection.ratio,
        response: response.action,
        thread_id: threadId,
      };

      // Record in metrics tracker
      this.metricsTracker.recordSpike(spike);

      // Reset cooldown
      this.adaptationState.items_since_spike = 0;

      // Advance alternate sequence if using alternate strategy
      if (this.config.spike.response_strategy === 'alternate') {
        this.advanceAlternateSequence();
      }
    }

    return { detection, response, spike };
  }

  /**
   * Get current adaptation state
   */
  getAdaptationState(): AdaptationState {
    return { ...this.adaptationState };
  }

  /**
   * Reset adaptation state (e.g., at session start)
   */
  resetState(): void {
    this.adaptationState = {
      alternate_index: 0,
      items_since_spike: Infinity,
      next_response: this.config.spike.alternate_sequence[0] as 'repeat' | 'breakdown',
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SpikeDetectorConfig>): void {
    if (config.spike) {
      this.config.spike = { ...this.config.spike, ...config.spike };

      // Reset alternate sequence if it changed
      if (config.spike.alternate_sequence) {
        this.adaptationState.alternate_index = 0;
        this.adaptationState.next_response = this.config.spike.alternate_sequence[0] as 'repeat' | 'breakdown';
      }
    }
  }

  /**
   * Advance to next item in alternate sequence
   */
  private advanceAlternateSequence(): void {
    const sequence = this.config.spike.alternate_sequence;
    this.adaptationState.alternate_index =
      (this.adaptationState.alternate_index + 1) % sequence.length;
    this.adaptationState.next_response =
      sequence[this.adaptationState.alternate_index] as 'repeat' | 'breakdown';
  }
}

/**
 * Factory function
 */
export function createSpikeDetector(
  config: SpikeDetectorConfig,
  metricsTracker: MetricsTracker
): SpikeDetector {
  return new SpikeDetector(config, metricsTracker);
}
