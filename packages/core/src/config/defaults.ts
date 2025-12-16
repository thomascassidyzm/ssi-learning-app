import type { LearningConfig } from './types';
import type { VADConfig } from '../audio/types';

/**
 * Default VAD configuration
 */
export const DEFAULT_VAD_CONFIG: VADConfig = {
  energy_threshold_db: -45,
  min_frames_above: 3,
  fft_size: 2048,
  smoothing: 0.8,
};

/**
 * System-level default configuration
 * All values are sensible defaults that can be overridden
 */
export const DEFAULT_CONFIG: LearningConfig = {
  helix: {
    thread_count: 3,
    initial_seed_count: 150,
    distribution_method: 'card_deal',
    content_injection_max_threads: 2,
  },

  repetition: {
    initial_reps: 7,
    min_reps: 3,
    max_reps: 15,
    fibonacci_sequence: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
    core_sentence_count: 30,
    core_refresh_hours: 5,
    adaptive_reps_enabled: true,
  },

  cycle: {
    pause_duration_ms: 3000,
    min_pause_ms: 1000,
    max_pause_ms: 10000,
    transition_gap_ms: 500,
    pause_adapts_to_phrase_length: true,
  },

  spike: {
    rolling_window_size: 10,
    threshold_percent: 150,
    response_strategy: 'alternate',
    alternate_sequence: ['repeat', 'breakdown'],
    cooldown_items: 3,
    use_stddev_detection: true,
    stddev_threshold: 2.0,
    pause_extension_enabled: true,
    pause_extension_factor: 0.3,
    pause_extension_duration: 3,
  },

  lego_introduction: {
    eternal_phrase_count: 5,
    molecular_breakdown_enabled: true,
    debut_phrases_repeat: false,
  },

  content_injection: {
    enabled: true,
    max_threads_for_injection: 2,
    subject_categories: ['medical', 'hospitality', 'legal', 'business', 'travel'],
  },

  offline: {
    auto_cache_minutes: 30,
    max_download_hours: 8,
    prefetch_item_count: 50,
  },

  session: {
    target_duration_minutes: 15,
    warmup_items: 5,
    question_min_gap_minutes: 5,
  },

  features: {
    triple_helix_enabled: true,
    adaptive_difficulty_enabled: true,
    spike_detection_enabled: true,
    in_flow_questions_enabled: true,
    encouragements_enabled: true,
    turbo_mode_available: true,
    listening_mode_available: true,
    vad_enabled: false, // Disabled by default - requires microphone permission
  },

  vad: DEFAULT_VAD_CONFIG,
};
