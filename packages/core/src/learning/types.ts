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

  // ==========================================
  // Speech Timing Data (from VAD)
  // ==========================================

  /** Whether speech was detected during the cycle */
  speech_detected?: boolean;
  /** True response latency: prompt start → speech start (ms), null if no speech */
  true_latency_ms?: number | null;
  /** How long learner spoke (ms), null if no speech */
  learner_duration_ms?: number | null;
  /** Difference: learner duration - model duration (ms), null if no speech */
  duration_delta_ms?: number | null;
  /** Learner started speaking before prompt audio finished (anticipation) */
  started_during_prompt?: boolean;
  /** Learner was still speaking when VOICE_1 started (struggling) */
  still_speaking_at_voice1?: boolean;
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

export type SeverityLevel = 'none' | 'mild' | 'moderate' | 'severe';

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
  /** Latency differential (current_latency - rolling_average) */
  differential: number;
  /** Rolling standard deviation */
  stddev: number;
  /** Magnitude (how many standard deviations from mean) */
  magnitude: number;
  /** Severity level based on magnitude */
  severity: SeverityLevel;
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

// ============================================
// MASTERY STATE MACHINE
// ============================================

/**
 * Four-state mastery progression
 * Based on APML spec: adaptation-engine.apml
 *
 * States progress: acquisition → consolidating → confident → mastered
 * Each state has a typical_skip value (items until next practice)
 */
export type MasteryState = 'acquisition' | 'consolidating' | 'confident' | 'mastered';

/**
 * Discontinuity severity levels (reuses SeverityLevel but without 'none')
 * - mild: no change to state
 * - moderate: hold position (reset consecutive counters)
 * - severe: regress one state
 */
export type DiscontinuitySeverity = 'mild' | 'moderate' | 'severe';

/**
 * Per-LEGO mastery state tracking
 */
export interface LegoMasteryState {
  /** Unique identifier for this LEGO */
  lego_id: string;
  /** Current mastery state */
  current_state: MasteryState;
  /** Count of consecutive smooth responses (no discontinuity) */
  consecutive_smooth: number;
  /** Count of consecutive fast responses (faster than learner's pattern) */
  consecutive_fast: number;
  /** Total discontinuities detected for this LEGO */
  discontinuity_count: number;
  /** Timestamp of most recent discontinuity */
  last_discontinuity_at: Date | null;
  /** When this state was created */
  created_at: Date;
  /** When this state was last updated */
  updated_at: Date;
}

/**
 * Configuration for mastery state machine
 */
export interface MasteryConfig {
  /** Consecutive smooth responses needed to advance state (default: 3) */
  advancement_threshold: number;
  /** Consecutive fast responses needed to skip a state (default: 5) */
  fast_track_threshold: number;
}

/**
 * State transition result
 */
export interface MasteryTransition {
  /** Previous state */
  from_state: MasteryState;
  /** New state */
  to_state: MasteryState;
  /** Reason for transition */
  reason: 'advancement' | 'fast_track' | 'regression' | 'hold';
  /** Timestamp of transition */
  timestamp: Date;
}

/**
 * Pause extension state
 * Used by AdaptationEngine to extend pause duration after spike detection
 */
export interface PauseExtensionState {
  /** Whether pause is currently extended */
  isExtended: boolean;
  /** Number of items remaining with extended pause */
  itemsRemaining: number;
  /** The extension factor to apply (e.g., 0.3 for 30% longer) */
  factor: number;
}

// ============================================
// TIMING-BASED COMPETENCE SIGNALS
// ============================================

/**
 * Competence assessment based on speech timing signals.
 * Derived from SpeechTimingResult by the AdaptationEngine.
 */
export interface TimingCompetenceSignal {
  /** Overall competence level inferred from timing */
  competence: 'confident' | 'normal' | 'struggling' | 'unknown';

  /** Detailed flags */
  flags: {
    /** Low latency = quick recall = confident */
    quick_response: boolean;
    /** Duration close to model = good prosody intuition */
    good_prosody_match: boolean;
    /** Started during prompt = very familiar */
    anticipated: boolean;
    /** Still speaking at voice1 = struggling */
    overlapped_answer: boolean;
    /** No speech detected */
    no_speech: boolean;
  };

  /** Recommendation for adaptation */
  recommendation: 'fast_track' | 'standard' | 'extend_pause' | 'breakdown' | 'none';

  /** Human-readable reason */
  reason: string;
}

/**
 * Thresholds for timing-based competence assessment.
 * These can be tuned based on learner data.
 */
export interface TimingThresholds {
  /** Latency below this (ms) = quick response (default: 2000) */
  quick_response_ms: number;
  /** Latency above this (ms) = slow response (default: 5000) */
  slow_response_ms: number;
  /** Duration delta within this range (ms) = good prosody match (default: 500) */
  good_prosody_delta_ms: number;
  /** Duration delta above this (ms) = poor prosody match (default: 1500) */
  poor_prosody_delta_ms: number;
}

/**
 * Default timing thresholds
 */
export const DEFAULT_TIMING_THRESHOLDS: TimingThresholds = {
  quick_response_ms: 2000,
  slow_response_ms: 5000,
  good_prosody_delta_ms: 500,
  poor_prosody_delta_ms: 1500,
};

// ============================================
// CONTINUOUS PERFORMANCE SCORING
// ============================================

/**
 * Continuous performance score based on rolling averages.
 * All values are relative to the learner's own baseline.
 *
 * This replaces the discrete "confident/normal/struggling" categories
 * with continuous values that allow gradual, invisible adaptation.
 */
export interface ContinuousPerformanceScore {
  /**
   * Latency z-score: how many standard deviations from learner's rolling average.
   * Negative = faster than usual (good), Positive = slower than usual (struggling)
   * null if insufficient data
   */
  latencyZScore: number | null;

  /**
   * Duration delta z-score: how many standard deviations from learner's rolling average.
   * Values far from 0 (positive or negative) = inconsistent prosody
   * null if insufficient data
   */
  durationDeltaZScore: number | null;

  /**
   * Overall performance score from -1 (struggling) to +1 (confident)
   * 0 = exactly at baseline
   * Combines latency and prosody signals
   */
  overallScore: number;

  /**
   * Recommended pause multiplier: continuous value typically 0.8 to 1.4
   * < 1.0 = learner is confident, shorten pause
   * = 1.0 = learner is at baseline, normal pause
   * > 1.0 = learner is struggling, extend pause
   */
  pauseMultiplier: number;

  /**
   * Whether we have enough data for reliable scoring
   * (need at least half the rolling window)
   */
  hasReliableData: boolean;

  /**
   * Debug info for logging/visualization
   */
  debug: {
    rollingAvgLatency: number;
    rollingStdDevLatency: number;
    currentLatency: number | null;
    rollingAvgDurationDelta: number;
    rollingStdDevDurationDelta: number;
    currentDurationDelta: number | null;
  };
}

/**
 * Configuration for continuous adaptation.
 * These tune the responsiveness and bounds of the adaptation.
 */
export interface ContinuousAdaptationConfig {
  /**
   * How quickly to respond to performance changes (0.0 to 1.0)
   * Lower = more gradual, Higher = more responsive
   * Default: 0.3 (fairly gradual)
   */
  responsiveness: number;

  /**
   * Minimum pause multiplier (fastest pause)
   * Default: 0.8 (20% shorter than baseline)
   */
  minPauseMultiplier: number;

  /**
   * Maximum pause multiplier (slowest pause)
   * Default: 1.4 (40% longer than baseline)
   */
  maxPauseMultiplier: number;

  /**
   * Z-score threshold for "significantly" different from baseline
   * Default: 1.5 (1.5 standard deviations)
   */
  significantZScore: number;

  /**
   * Weight given to latency vs duration delta in overall score
   * Default: 0.7 (latency is 70%, duration delta is 30%)
   */
  latencyWeight: number;
}

/**
 * Default continuous adaptation config
 */
export const DEFAULT_CONTINUOUS_ADAPTATION_CONFIG: ContinuousAdaptationConfig = {
  responsiveness: 0.3,
  minPauseMultiplier: 0.8,
  maxPauseMultiplier: 1.4,
  significantZScore: 1.5,
  latencyWeight: 0.7,
};

// ============================================
// LEARNER BASELINE (Calibration)
// ============================================

/**
 * Calibrated baseline for a learner.
 * Established during an initial calibration phase and persisted across sessions.
 *
 * This captures the learner's "natural" timing patterns before adaptation,
 * so that z-scores are calculated relative to their personal baseline,
 * not arbitrary defaults.
 */
export interface LearnerBaseline {
  /**
   * When this baseline was established
   */
  calibrated_at: Date;

  /**
   * Number of items used to establish baseline
   */
  calibration_items: number;

  /**
   * Normalized latency statistics (ms per character)
   */
  latency: {
    mean: number;
    stdDev: number;
  };

  /**
   * Duration delta statistics (ms)
   * How much longer/shorter than model audio the learner typically speaks
   */
  durationDelta: {
    mean: number;
    stdDev: number;
  };

  /**
   * Whether the learner was in timing mode (had microphone) during calibration
   * If false, only latency data is reliable
   */
  hadTimingData: boolean;

  /**
   * Optional metadata
   */
  metadata?: {
    /** Course/content being learned during calibration */
    courseId?: string;
    /** Device type used */
    deviceType?: string;
    /** Any notes */
    notes?: string;
  };
}

/**
 * Configuration for calibration phase
 */
export interface CalibrationConfig {
  /**
   * Minimum items needed before calibration can complete
   * Default: 20
   */
  minItems: number;

  /**
   * Maximum items for calibration (auto-complete after this)
   * Default: 50
   */
  maxItems: number;

  /**
   * Minimum standard deviation to consider data reliable
   * If stdDev is below this, we may not have enough variance
   * Default: 5 (ms per character)
   */
  minStdDev: number;

  /**
   * Whether to auto-complete calibration when minItems is reached
   * If false, must call completeCalibration() manually
   * Default: true
   */
  autoComplete: boolean;
}

/**
 * Default calibration config
 */
export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  minItems: 20,
  maxItems: 50,
  minStdDev: 5,
  autoComplete: true,
};

/**
 * Calibration state
 */
export type CalibrationState = 'not_started' | 'in_progress' | 'completed' | 'skipped';

/**
 * Result of calibration phase
 */
export interface CalibrationResult {
  /** Whether calibration was successful */
  success: boolean;
  /** The established baseline (if successful) */
  baseline?: LearnerBaseline;
  /** Reason for failure (if not successful) */
  reason?: string;
  /** How many items were used */
  itemCount: number;
}
