/**
 * Master Configuration Schema - ALL parameters configurable
 * Three-tier hierarchy: System Defaults → Course/School Overrides → Learner Adaptive Overrides
 */

import type { VADConfig } from '../audio/types';

export interface LearningConfig {
  // === TRIPLE HELIX ===
  helix: HelixConfig;

  // === REPETITION ===
  repetition: RepetitionConfig;

  // === CYCLE TIMING ===
  cycle: CycleConfig;

  // === SPIKE DETECTION ===
  spike: SpikeConfig;

  // === LEGO INTRODUCTION ===
  lego_introduction: LegoIntroductionConfig;

  // === CONTENT INJECTION ===
  content_injection: ContentInjectionConfig;

  // === OFFLINE ===
  offline: OfflineConfig;

  // === SESSION ===
  session: SessionConfig;

  // === FEATURES ===
  features: FeaturesConfig;

  // === VOICE ACTIVITY DETECTION ===
  vad: VADConfig;
}

export interface HelixConfig {
  /** Number of parallel threads (default: 3) */
  thread_count: number;
  /** Number of SEEDs to distribute initially (default: 150) */
  initial_seed_count: number;
  /** How to distribute SEEDs across threads */
  distribution_method: 'card_deal' | 'sequential' | 'custom';
  /** Max threads that can receive injected content (default: 2) */
  content_injection_max_threads: number;
}

export interface RepetitionConfig {
  /** Initial repetitions for new LEGOs (default: 7) */
  initial_reps: number;
  /** Minimum reps even for fast learners (default: 3) */
  min_reps: number;
  /** Maximum reps for struggling learners (default: 15) */
  max_reps: number;
  /** Fibonacci sequence for spacing (default: [1,1,2,3,5,8,13,21,34,55,89]) */
  fibonacci_sequence: number[];
  /** Core sentences that never fully decay (default: 30) */
  core_sentence_count: number;
  /** Hours before core sentences refresh (default: 5) */
  core_refresh_hours: number;
  /** Whether reps adapt to learner performance (default: true) */
  adaptive_reps_enabled: boolean;
}

export interface CycleConfig {
  /** Default pause duration in ms (default: 3000) */
  pause_duration_ms: number;
  /** Minimum pause in ms (default: 1000) */
  min_pause_ms: number;
  /** Maximum pause in ms (default: 10000) */
  max_pause_ms: number;
  /** Gap between phases in ms (default: 500) */
  transition_gap_ms: number;
  /** Whether pause adapts to phrase length (default: true) */
  pause_adapts_to_phrase_length: boolean;
}

export interface SpikeConfig {
  /** Number of items in rolling window (default: 10) */
  rolling_window_size: number;
  /** Threshold as percentage of rolling average (default: 150) */
  threshold_percent: number;
  /** Strategy for responding to spikes */
  response_strategy: 'repeat' | 'breakdown' | 'alternate';
  /** Sequence for alternate strategy (default: ['repeat', 'breakdown']) */
  alternate_sequence: string[];
  /** Items to wait before next spike can trigger (default: 3) */
  cooldown_items: number;
  /** Use standard deviation-based discontinuity detection (default: true) */
  use_stddev_detection: boolean;
  /** Number of standard deviations for discontinuity threshold (default: 2.0, range: 1.5-3.0) */
  stddev_threshold: number;
  /** Whether to extend pause duration after spike (default: true) */
  pause_extension_enabled: boolean;
  /** Factor to extend pause by on spike: pause * (1 + factor) (default: 0.3, range: 0.1-0.5) */
  pause_extension_factor: number;
  /** Number of items to maintain extended pause after spike (default: 3) */
  pause_extension_duration: number;
}

export interface LegoIntroductionConfig {
  /** Number of ETERNAL phrases per LEGO (default: 5) */
  eternal_phrase_count: number;
  /** Whether M-types use breakdown/buildup (default: true) */
  molecular_breakdown_enabled: boolean;
  /** Whether DEBUT phrases repeat (default: false) */
  debut_phrases_repeat: boolean;
}

export interface ContentInjectionConfig {
  /** Whether content injection is enabled (default: true) */
  enabled: boolean;
  /** Max threads for injection (default: 2, B and C) */
  max_threads_for_injection: number;
  /** Available subject categories */
  subject_categories: string[];
}

export interface OfflineConfig {
  /** Minutes of content to auto-cache (default: 30) */
  auto_cache_minutes: number;
  /** Maximum hours to download (default: 8) */
  max_download_hours: number;
  /** Number of items to prefetch (default: 50) */
  prefetch_item_count: number;
}

export interface SessionConfig {
  /** Target session duration in minutes (default: 15) */
  target_duration_minutes: number;
  /** Number of warmup items (default: 5) */
  warmup_items: number;
  /** Minimum gap between in-flow questions in minutes (default: 5) */
  question_min_gap_minutes: number;
}

export interface FeaturesConfig {
  /** Triple helix enabled (default: true) */
  triple_helix_enabled: boolean;
  /** Adaptive difficulty enabled (default: true) */
  adaptive_difficulty_enabled: boolean;
  /** Spike detection enabled (default: true) */
  spike_detection_enabled: boolean;
  /** In-flow questions enabled (default: true) */
  in_flow_questions_enabled: boolean;
  /** Encouragements enabled (default: true) */
  encouragements_enabled: boolean;
  /** Turbo mode available (default: true) */
  turbo_mode_available: boolean;
  /** Listening mode available (default: true) */
  listening_mode_available: boolean;
  /** Voice activity detection enabled (default: false - requires mic permission) */
  vad_enabled: boolean;
}

export interface WeightedSelectionConfig {
  /**
   * Weight increase per day since last practice
   * Formula: staleness_factor = 1 + (days_since_practice * staleness_rate)
   * Default: 0.1
   * Range: [0.05, 0.3]
   */
  staleness_rate: number;

  /**
   * Weight boost per discontinuity detected
   * Formula: struggle_factor = 1 + (discontinuity_count * struggle_multiplier)
   * Default: 0.5
   * Range: [0.2, 1.0]
   */
  struggle_multiplier: number;

  /**
   * Minutes before recency penalty kicks in
   * Formula: recency_factor = max(0.5, 1 - (minutes_since_practice / recency_window))
   * Prevents "hammering" the same LEGO repeatedly
   * Default: 30
   * Range: [10, 60]
   */
  recency_window: number;
}

/**
 * Deep partial type for config overrides
 */
export type PartialLearningConfig = {
  [K in keyof LearningConfig]?: Partial<LearningConfig[K]>;
};
