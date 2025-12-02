/**
 * Types for the adaptive learning system
 */

// ============================================
// METRICS
// ============================================

export interface ResponseMetric {
  /** Unique identifier for this metric */
  id: string;
  /** LEGO ID that was practiced */
  lego_id: string;
  /** Timestamp when cycle started */
  timestamp: Date;
  /** Response latency in ms (time from pause end to voice_1 start is the "attempt") */
  response_latency_ms: number;
  /** Length of target phrase in characters */
  phrase_length: number;
  /** Normalized latency (latency / phrase_length) for fair comparison */
  normalized_latency: number;
  /** Thread this came from */
  thread_id: number;
  /** Whether this triggered a spike */
  triggered_spike: boolean;
  /** What mode the item was in */
  mode: string;
}

export interface SpikeEvent {
  /** Unique identifier */
  id: string;
  /** LEGO ID that spiked */
  lego_id: string;
  /** Timestamp */
  timestamp: Date;
  /** The normalized latency that triggered the spike */
  latency: number;
  /** The rolling average at time of spike */
  rolling_average: number;
  /** Ratio: latency / rolling_average */
  spike_ratio: number;
  /** Response taken: 'repeat' | 'breakdown' */
  response: 'repeat' | 'breakdown';
  /** Thread ID */
  thread_id: number;
}

export interface SessionMetrics {
  /** Session identifier */
  session_id: string;
  /** Session start time */
  started_at: Date;
  /** Session end time (null if ongoing) */
  ended_at: Date | null;
  /** Total items practiced */
  items_practiced: number;
  /** Number of spikes detected */
  spikes_detected: number;
  /** Rolling average at end of session */
  final_rolling_average: number;
  /** All response metrics */
  metrics: ResponseMetric[];
  /** All spike events */
  spikes: SpikeEvent[];
}

// ============================================
// SPIKE DETECTION
// ============================================

export interface SpikeDetectionResult {
  /** Whether a spike was detected */
  is_spike: boolean;
  /** The normalized latency that was analyzed */
  latency: number;
  /** Current rolling average */
  rolling_average: number;
  /** Threshold value (rolling_average * threshold_percent / 100) */
  threshold: number;
  /** Ratio of latency to rolling average */
  ratio: number;
}

export interface SpikeResponse {
  /** What action to take */
  action: 'none' | 'repeat' | 'breakdown';
  /** Reason for this action */
  reason: string;
  /** Whether this is within cooldown period */
  in_cooldown: boolean;
}

// ============================================
// ADAPTATION
// ============================================

export interface AdaptationState {
  /** Current position in alternate sequence (for 'alternate' strategy) */
  alternate_index: number;
  /** Items since last spike (for cooldown) */
  items_since_spike: number;
  /** Whether next spike should breakdown (for alternate) */
  next_response: 'repeat' | 'breakdown';
}

export interface AdaptedItem {
  /** The original learning item (or null if no item) */
  original_lego_id: string | null;
  /** What to show: the same item, a breakdown, or null */
  action: 'continue' | 'repeat' | 'breakdown';
  /** If breakdown, the component LEGOs to practice */
  breakdown_components?: string[];
  /** Reason for adaptation */
  reason: string;
}

// ============================================
// TRACKER EVENTS
// ============================================

export type MetricsEvent =
  | { type: 'item_completed'; metric: ResponseMetric }
  | { type: 'spike_detected'; spike: SpikeEvent }
  | { type: 'session_started'; session_id: string }
  | { type: 'session_ended'; session: SessionMetrics };

export type MetricsListener = (event: MetricsEvent) => void;
