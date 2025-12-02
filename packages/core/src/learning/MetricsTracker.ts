/**
 * MetricsTracker - Captures and stores response metrics for adaptive learning
 *
 * Tracks:
 * - Response latency (normalized by phrase length)
 * - Rolling averages for spike detection
 * - Session-level statistics
 */

import type { SpikeConfig } from '../config/types';
import type {
  ResponseMetric,
  SessionMetrics,
  SpikeEvent,
  MetricsEvent,
  MetricsListener,
} from './types';

export interface MetricsTrackerConfig {
  /** Config for spike-related parameters */
  spike: SpikeConfig;
}

export class MetricsTracker {
  private config: MetricsTrackerConfig;
  private rollingWindow: ResponseMetric[] = [];
  private currentSession: SessionMetrics | null = null;
  private listeners: MetricsListener[] = [];

  constructor(config: MetricsTrackerConfig) {
    this.config = config;
  }

  /**
   * Start a new session
   */
  startSession(sessionId: string): void {
    // End current session if exists
    if (this.currentSession) {
      this.endSession();
    }

    this.currentSession = {
      session_id: sessionId,
      started_at: new Date(),
      ended_at: null,
      items_practiced: 0,
      spikes_detected: 0,
      final_rolling_average: 0,
      metrics: [],
      spikes: [],
    };

    this.rollingWindow = [];

    this.emit({ type: 'session_started', session_id: sessionId });
  }

  /**
   * End the current session
   */
  endSession(): SessionMetrics | null {
    if (!this.currentSession) return null;

    this.currentSession.ended_at = new Date();
    this.currentSession.final_rolling_average = this.getRollingAverage();

    const session = { ...this.currentSession };
    this.emit({ type: 'session_ended', session });

    this.currentSession = null;
    return session;
  }

  /**
   * Record a response metric
   */
  recordResponse(
    legoId: string,
    responseLatencyMs: number,
    phraseLength: number,
    threadId: number,
    mode: string
  ): ResponseMetric {
    const normalizedLatency = this.normalizeLatency(responseLatencyMs, phraseLength);

    const metric: ResponseMetric = {
      id: `metric-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      lego_id: legoId,
      timestamp: new Date(),
      response_latency_ms: responseLatencyMs,
      phrase_length: phraseLength,
      normalized_latency: normalizedLatency,
      thread_id: threadId,
      triggered_spike: false, // Will be updated by SpikeDetector
      mode,
    };

    // Add to rolling window
    this.rollingWindow.push(metric);
    if (this.rollingWindow.length > this.config.spike.rolling_window_size) {
      this.rollingWindow.shift();
    }

    // Add to session
    if (this.currentSession) {
      this.currentSession.metrics.push(metric);
      this.currentSession.items_practiced++;
    }

    this.emit({ type: 'item_completed', metric });

    return metric;
  }

  /**
   * Record a spike event
   */
  recordSpike(spike: SpikeEvent): void {
    if (this.currentSession) {
      this.currentSession.spikes.push(spike);
      this.currentSession.spikes_detected++;
    }

    // Mark the last metric as having triggered a spike
    if (this.rollingWindow.length > 0) {
      this.rollingWindow[this.rollingWindow.length - 1].triggered_spike = true;
    }

    this.emit({ type: 'spike_detected', spike });
  }

  /**
   * Get the current rolling average (normalized latency)
   */
  getRollingAverage(): number {
    if (this.rollingWindow.length === 0) return 0;

    const sum = this.rollingWindow.reduce((acc, m) => acc + m.normalized_latency, 0);
    return sum / this.rollingWindow.length;
  }

  /**
   * Get the current rolling window
   */
  getRollingWindow(): ResponseMetric[] {
    return [...this.rollingWindow];
  }

  /**
   * Check if we have enough data for spike detection
   * Need at least half the window to avoid false positives
   */
  hasEnoughData(): boolean {
    return this.rollingWindow.length >= Math.floor(this.config.spike.rolling_window_size / 2);
  }

  /**
   * Get the current session (if any)
   */
  getCurrentSession(): SessionMetrics | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Add a listener for metrics events
   */
  addListener(listener: MetricsListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener
   */
  removeListener(listener: MetricsListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MetricsTrackerConfig>): void {
    if (config.spike) {
      this.config.spike = { ...this.config.spike, ...config.spike };

      // Trim window if new size is smaller
      const newSize = this.config.spike.rolling_window_size;
      while (this.rollingWindow.length > newSize) {
        this.rollingWindow.shift();
      }
    }
  }

  /**
   * Normalize latency by phrase length
   * This allows fair comparison between short and long phrases
   *
   * Formula: latency_per_character = latency_ms / phrase_length
   * Minimum phrase length of 5 to avoid division issues
   */
  private normalizeLatency(latencyMs: number, phraseLength: number): number {
    const effectiveLength = Math.max(phraseLength, 5);
    return latencyMs / effectiveLength;
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: MetricsEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('MetricsTracker listener error:', error);
      }
    }
  }
}

/**
 * Factory function
 */
export function createMetricsTracker(config: MetricsTrackerConfig): MetricsTracker {
  return new MetricsTracker(config);
}
