/**
 * Audio analysis types for Voice Activity Detection (VAD) and Prosody Analysis
 *
 * Phase 1: VAD - Real-time voice activity detection during PAUSE phase
 * Phase 2: Prosody - Future peak detection and gradient analysis
 */

import type { EnvelopeMetadata } from './envelopeMetadata';

// ============================================
// PHASE 1: VOICE ACTIVITY DETECTION
// ============================================

/**
 * Configuration for Voice Activity Detection
 */
export interface VADConfig {
  /** RMS energy threshold in dB to consider "speaking" (default: -45) */
  energy_threshold_db: number;
  /** Minimum consecutive frames above threshold to confirm speech (default: 3) */
  min_frames_above: number;
  /** FFT size for frequency analysis (default: 2048) */
  fft_size: number;
  /** Smoothing factor for energy calculation, 0-1 (default: 0.8) */
  smoothing: number;
}

/**
 * Result of Voice Activity Detection for a single PAUSE phase
 */
export interface VADResult {
  /** Whether voice activity was detected */
  speech_detected: boolean;
  /** Duration of detected speech in ms */
  speech_duration_ms: number;
  /** Peak energy level during monitoring (dB) */
  peak_energy_db: number;
  /** Average energy level during monitoring (dB) */
  average_energy_db: number;
  /** Percentage of PAUSE duration with detected speech (0-1) */
  activity_ratio: number;
  /** Start time of monitoring (timestamp) */
  start_time: number;
  /** End time of monitoring (timestamp) */
  end_time: number;
}

/**
 * Real-time VAD status for UI feedback
 */
export interface VADStatus {
  /** Whether currently detecting speech */
  is_speaking: boolean;
  /** Current energy level (dB) */
  current_energy_db: number;
  /** Whether VAD is initialized and monitoring */
  is_active: boolean;
}

// ============================================
// CONTINUOUS VAD & SPEECH TIMING
// ============================================

/**
 * Phase names for marking transitions during continuous monitoring.
 * Matches CyclePhase enum values from engine/types.ts
 */
export type TimingPhase = 'IDLE' | 'PROMPT' | 'PAUSE' | 'VOICE_1' | 'VOICE_2' | 'TRANSITION';

/**
 * Configuration for continuous VAD monitoring across full learning cycle.
 * Extends VADConfig with timing-specific settings.
 */
export interface ContinuousVADConfig extends VADConfig {
  /** Minimum speech duration (ms) to register as valid speech (default: 100) */
  min_speech_duration_ms: number;
  /** Debounce time (ms) before speech_end is confirmed (default: 200) */
  speech_end_debounce_ms: number;

  // ==========================================
  // Playback rejection (2026-08-20)
  // ==========================================
  // The window opens at PROMPT START, so the mic is live while the app plays
  // prompt/voice1/voice2 audio through the same device's speaker. A bare
  // absolute threshold cannot tell that apart from a learner: on the live
  // corpus 83% of real rows had speech "starting" ~32ms in and "ending" 17.5s
  // later, i.e. spanning the whole cycle — the app hearing itself.
  //
  // The absolute threshold cannot be tuned out of this, because
  // `energy_threshold_db` is not on an acoustic scale: getCurrentEnergy()
  // re-logs bytes that getByteFrequencyData already log-mapped over
  // [minDecibels, maxDecibels]. So -45 there means "near digital silence
  // across the whole spectrum", which ordinary room tone clears. The fix must
  // be RELATIVE — a margin above a floor measured on this device, at this
  // volume, in this room — which is scale-independent by construction.

  /** Measure the playback+ambient floor from the head of the prompt and
   *  require the learner to clear it by a margin (default: true). */
  adaptive_floor_enabled: boolean;
  /** Length of the calibration slice at the head of the prompt, in ms
   *  (default: 400). Ends early if PROMPT_END arrives first. No onset can be
   *  CONFIRMED inside it, because there is no measured floor to judge it
   *  against yet — but once the floor closes the slice is re-read backwards
   *  and an onset already in progress is back-dated to where it really began.
   *  The window therefore costs the earliest speakers nothing; before that
   *  back-date it silently credited them at ~400ms (measured 2026-08-20: a
   *  learner starting at 200ms was reported at 432ms). */
  calibration_window_ms: number;
  /** Minimum samples needed before the measured floor is trusted; below this
   *  (rAF throttled, tab backgrounded) it falls back to the absolute
   *  threshold rather than to a floor built on noise (default: 6). */
  calibration_min_samples: number;
  /** Which quantile of the calibration slice is taken as the floor
   *  (default: 0.25 — the lower quartile).
   *
   *  NOT the median, and the reason is the direction of the contamination.
   *  A learner speaking during the slice can only push samples UP: speech is
   *  additive on top of playback, never subtractive. So the estimator has to
   *  be robust against upward contamination only, and a low quantile is
   *  robust to far more of it than the median. Measured: with a learner
   *  talking from 150ms, ~64% of a 400ms slice is contaminated, the median
   *  lands on their own voice, the floor rises above them and their entire
   *  utterance is discarded. The lower quartile still lands on playback.
   *
   *  The floor this yields is a little lower than a median floor even on a
   *  clean slice; `adaptive_margin_db` absorbs that, and prompt-window onsets
   *  are backstopped by the prompt-boundary test below. */
  calibration_percentile: number;
  /** How far above the measured floor the learner must be, in dB
   *  (default: 9). Speech ADDS to playback, so a real utterance over the
   *  prompt still clears it — which is what keeps `started_during_prompt` an
   *  honest signal rather than a suppressed one. */
  adaptive_margin_db: number;
  /** How far past VOICE_1 a still-running utterance may be attributed to the
   *  learner, in ms (default: 1500). Beyond that the app's own target audio
   *  is the likelier source, and an unclamped end is what produced the
   *  whole-cycle 17.5s spans. */
  post_voice1_grace_ms: number;
  /** Half-width, in ms, of the ambiguous zone either side of PROMPT_END used
   *  to tell prompt bleed from a genuine early speaker (default: 250).
   *  Set to 0 to disable the boundary test entirely.
   *
   *  The energy margin alone is not sufficient here, which is measurable: a
   *  prompt whose audio has a quiet head and a louder body gets its floor
   *  measured on the head, so the body clears margin on its own and the app
   *  records itself as a learner responding at ~430ms — with no learner in
   *  the room at all.
   *
   *  What separates them is not level but the PROMPT-END BOUNDARY, because
   *  bleed IS the prompt audio:
   *    - a run still above the floor at PROMPT_END + guard outlived the
   *      prompt, so it is not the prompt        → learner;
   *    - a run that fell back to the floor before PROMPT_END - guard stopped
   *      while the prompt was still playing, so it is not the prompt either
   *      → learner (this is the short early answer, and it must be kept);
   *    - a run that dies WITH the prompt, inside the guard band, is the
   *      prompt → discarded, and the detector re-arms for a real response.
   *  Only the last case is genuinely ambiguous, and given a live base rate of
   *  83% bleed it is right to read it as bleed there.
   *
   *  Applies to onsets inside the prompt window ONLY. An onset after
   *  PROMPT_END has already outlived the prompt and needs no such test. */
  prompt_boundary_guard_ms: number;
}

/**
 * Result of continuous VAD monitoring across a full learning cycle.
 * Captures when the learner spoke relative to cycle phases.
 *
 * All timestamps are relative to prompt_start_ms = 0.
 * This allows easy comparison: "did they start before prompt ended?"
 */
export interface SpeechTimingResult {
  // ==========================================
  // Core timestamps (relative to prompt start)
  // ==========================================

  /** Always 0 - reference point for all other timestamps */
  prompt_start_ms: 0;
  /** When PROMPT audio finished playing */
  prompt_end_ms: number;
  /** When VOICE_1 phase started */
  voice1_start_ms: number;

  /** When learner started speaking (null if no speech detected) */
  speech_start_ms: number | null;
  /** When learner stopped speaking (null if no speech detected) */
  speech_end_ms: number | null;

  // ==========================================
  // Derived metrics
  // ==========================================

  /** Time from prompt start to speech start (null if no speech) */
  response_latency_ms: number | null;
  /** How long the learner spoke (null if no speech) */
  learner_duration_ms: number | null;
  /** learner_duration - model_duration (null if no speech) */
  duration_delta_ms: number | null;

  // ==========================================
  // Overlap flags (key competence signals)
  // ==========================================

  /** Learner started speaking before prompt audio finished (anticipation) */
  started_during_prompt: boolean;
  /** Learner was still speaking when VOICE_1 started (struggling) */
  still_speaking_at_voice1: boolean;

  // ==========================================
  // Raw VAD data (for debugging/analysis)
  // ==========================================

  /** Whether any speech was detected */
  speech_detected: boolean;
  /** Peak energy level during monitoring (dB) */
  peak_energy_db: number;
  /** Average energy level during monitoring (dB) */
  average_energy_db: number;

  // ==========================================
  // Stage 2: volume-envelope metadata (adaptation v2, WP-6)
  // ==========================================

  /** Derived envelope numbers only (duration/peakCount/peakToMeanRatio/meanPeakWidthMs/
   *  sampleCount/weight) — undefined when no speech was captured. Raw samples
   *  never reach this result; see `audio/envelopeMetadata.ts`. */
  envelope?: EnvelopeMetadata;
}

/**
 * Default values for ContinuousVADConfig
 */
export const DEFAULT_CONTINUOUS_VAD_CONFIG: ContinuousVADConfig = {
  energy_threshold_db: -45,
  min_frames_above: 3,
  fft_size: 2048,
  smoothing: 0.8,
  min_speech_duration_ms: 100,
  speech_end_debounce_ms: 200,
  adaptive_floor_enabled: true,
  calibration_window_ms: 400,
  calibration_min_samples: 6,
  calibration_percentile: 0.25,
  adaptive_margin_db: 9,
  post_voice1_grace_ms: 1500,
  prompt_boundary_guard_ms: 250,
};

/**
 * Create an empty SpeechTimingResult (no speech detected)
 */
export function createEmptySpeechTimingResult(
  promptEndMs: number,
  voice1StartMs: number
): SpeechTimingResult {
  return {
    prompt_start_ms: 0,
    prompt_end_ms: promptEndMs,
    voice1_start_ms: voice1StartMs,
    speech_start_ms: null,
    speech_end_ms: null,
    response_latency_ms: null,
    learner_duration_ms: null,
    duration_delta_ms: null,
    started_during_prompt: false,
    still_speaking_at_voice1: false,
    speech_detected: false,
    peak_energy_db: -100,
    average_energy_db: -100,
  };
}

// ============================================
// PHASE 2: PROSODY ANALYSIS (FUTURE-PROOFED)
// ============================================

/**
 * Configuration for prosody analysis (Phase 2)
 */
export interface ProsodyConfig {
  /** Minimum peak prominence to detect (0-1, default: 0.1) */
  min_peak_prominence: number;
  /** Minimum time between peaks in ms (default: 80) */
  min_peak_distance_ms: number;
  /** Window size for gradient calculation in samples (default: 5) */
  gradient_window: number;
  /** Sample rate for analysis (default: 44100) */
  sample_rate: number;
}

/**
 * A detected prosody peak (roughly corresponds to a syllable)
 */
export interface ProsodyPeak {
  /** Time offset from recording start in ms */
  time_ms: number;
  /** Peak amplitude (normalized 0-1) */
  amplitude: number;
  /** Rising gradient (rate of amplitude increase before peak) */
  gradient_rise: number;
  /** Falling gradient (rate of amplitude decrease after peak) */
  gradient_fall: number;
  /** Peak prominence relative to surrounding signal */
  prominence: number;
}

/**
 * Complete prosody profile for an audio segment
 */
export interface ProsodyProfile {
  /** Detected peaks (syllables) */
  peaks: ProsodyPeak[];
  /** Overall rhythm regularity score (0-1, 1=perfectly regular) */
  rhythm_score: number;
  /** Speech rate (estimated syllables per second) */
  speech_rate: number;
  /** Energy variance across the segment */
  energy_variance: number;
  /** Total duration in ms */
  duration_ms: number;
  /** Average gradient sharpness (crispness indicator) */
  average_gradient_sharpness: number;
}

/**
 * Pre-computed prosody profile for a model voice
 * Used for comparison against learner prosody
 */
export interface ModelProsodyProfile {
  /** Audio reference identifier */
  audio_ref: string;
  /** Pre-computed prosody profile */
  profile: ProsodyProfile;
  /** When this profile was computed */
  computed_at: Date;
}

/**
 * Comparison result between learner and model prosody
 */
export interface ProsodyComparison {
  /** Learner's prosody profile */
  learner: ProsodyProfile;
  /** Model's prosody profile */
  model: ProsodyProfile;
  /** Speech rate differential (learner - model, positive = faster) */
  rate_differential: number;
  /** Rhythm similarity score (0-1) */
  rhythm_similarity: number;
  /** Gradient sharpness differential (positive = crisper) */
  sharpness_differential: number;
  /** Overall similarity score (0-1) */
  overall_similarity: number;
}

// ============================================
// ROLLING METRICS FOR ADAPTATION
// ============================================

/**
 * Rolling prosody metrics for slow adaptation
 * (consistent with spike detection's rolling window approach)
 */
export interface RollingProsodyMetrics {
  /** Rolling average activity ratio from VAD */
  rolling_activity_ratio: number;
  /** Rolling average speech rate (when prosody is available) */
  rolling_speech_rate: number | null;
  /** Rolling average sharpness (when prosody is available) */
  rolling_sharpness: number | null;
  /** Number of samples in the rolling window */
  sample_count: number;
}
