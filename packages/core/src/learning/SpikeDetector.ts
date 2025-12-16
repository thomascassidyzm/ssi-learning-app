/**
 * SpikeDetector - Detects when a learner is struggling based on response latency
 *
 * Strategy:
 * - Maintains a rolling window of normalized response latencies
 * - NEW: Differential-based discontinuity detection per APML spec
 *   - Calculates latency_differential = current_latency - rolling_average
 *   - Detects discontinuity when: abs(differential) > (stddev_threshold * rolling_stddev)
 *   - Classifies severity: mild, moderate, severe based on magnitude (sigmas)
 * - FALLBACK: Uses threshold_percent of rolling average (legacy approach)
 * - Threshold is relative to learner's OWN average (not absolute)
 * - Respects cooldown period to avoid over-triggering
 */

import type { SpikeConfig } from '../config/types';
import type {
  SpikeDetectionResult,
  SpikeResponse,
  SpikeEvent,
  AdaptationState,
  SeverityLevel,
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
   *
   * Uses differential-based discontinuity detection per APML spec:
   * 1. Calculate latency_differential = current_latency - rolling_average
   * 2. Detect discontinuity when: abs(differential) > (stddev_threshold * rolling_stddev)
   * 3. Calculate magnitude = abs(differential) / stddev (how many sigmas)
   * 4. Classify severity: mild (<2.5σ), moderate (≥2.5σ), severe (>4.0σ)
   *
   * Falls back to threshold_percent approach if use_stddev_detection is false
   */
  detectSpike(normalizedLatency: number): SpikeDetectionResult {
    const rollingAverage = this.metricsTracker.getRollingAverage();
    const rollingStdDev = this.metricsTracker.getRollingStdDev();

    // Calculate differential (always computed for reporting)
    const differential = normalizedLatency - rollingAverage;

    // If we don't have enough data, no spike
    if (!this.metricsTracker.hasEnoughData()) {
      return {
        is_spike: false,
        latency: normalizedLatency,
        rolling_average: rollingAverage,
        threshold: 0,
        ratio: 0,
        differential,
        stddev: rollingStdDev,
        magnitude: 0,
        severity: 'none',
      };
    }

    let isSpike = false;
    let magnitude = 0;
    let severity: SeverityLevel = 'none';

    // Determine spike using configured detection method
    if (this.config.spike.use_stddev_detection && rollingStdDev > 0) {
      // NEW: Standard deviation-based discontinuity detection
      magnitude = Math.abs(differential) / rollingStdDev;
      const threshold = this.config.spike.stddev_threshold * rollingStdDev;
      isSpike = Math.abs(differential) > threshold;

      // Classify severity based on magnitude
      if (magnitude >= 4.0) {
        severity = 'severe';
      } else if (magnitude >= 2.5) {
        severity = 'moderate';
      } else if (isSpike) {
        severity = 'mild';
      }
    } else {
      // FALLBACK: Legacy threshold_percent approach
      const threshold = rollingAverage * (this.config.spike.threshold_percent / 100);
      isSpike = normalizedLatency > threshold;

      // For backwards compatibility, calculate approximate magnitude
      if (rollingStdDev > 0) {
        magnitude = Math.abs(differential) / rollingStdDev;
        if (magnitude >= 4.0) {
          severity = 'severe';
        } else if (magnitude >= 2.5) {
          severity = 'moderate';
        } else if (isSpike) {
          severity = 'mild';
        }
      } else {
        // No stddev available, use ratio-based severity
        const ratio = rollingAverage > 0 ? normalizedLatency / rollingAverage : 0;
        if (ratio > 2.5) {
          severity = 'severe';
        } else if (ratio > 1.8) {
          severity = 'moderate';
        } else if (isSpike) {
          severity = 'mild';
        }
      }
    }

    const threshold = this.config.spike.use_stddev_detection && rollingStdDev > 0
      ? this.config.spike.stddev_threshold * rollingStdDev
      : rollingAverage * (this.config.spike.threshold_percent / 100);

    const ratio = rollingAverage > 0 ? normalizedLatency / rollingAverage : 0;

    return {
      is_spike: isSpike,
      latency: normalizedLatency,
      rolling_average: rollingAverage,
      threshold,
      ratio,
      differential,
      stddev: rollingStdDev,
      magnitude,
      severity,
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
