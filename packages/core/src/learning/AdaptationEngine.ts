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
import type { SpeechTimingResult } from '../audio/types';
import type {
  AdaptedItem,
  SpikeResponse,
  PauseExtensionState,
  MasteryTransition,
  DiscontinuitySeverity,
  SeverityLevel,
  LegoMasteryState,
  TimingCompetenceSignal,
  TimingThresholds,
  ContinuousPerformanceScore,
  ContinuousAdaptationConfig,
  LearnerBaseline,
  CalibrationConfig,
  CalibrationState,
  CalibrationResult,
} from './types';
import {
  DEFAULT_TIMING_THRESHOLDS,
  DEFAULT_CONTINUOUS_ADAPTATION_CONFIG,
  DEFAULT_CALIBRATION_CONFIG,
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
  private timingThresholds: TimingThresholds;

  // Continuous adaptation state
  private continuousAdaptationConfig: ContinuousAdaptationConfig;
  private currentPauseMultiplier: number = 1.0;
  private lastPerformanceScore: ContinuousPerformanceScore | null = null;

  // Calibration state
  private calibrationConfig: CalibrationConfig;
  private calibrationState: CalibrationState = 'not_started';
  private calibrationItemCount: number = 0;
  private learnerBaseline: LearnerBaseline | null = null;

  constructor({ config }: AdaptationEngineConfig) {
    this.config = config;
    this.enabled = config.features.spike_detection_enabled;

    // Initialize pause extension state (legacy discrete system)
    this.pauseExtensionState = {
      isExtended: false,
      itemsRemaining: 0,
      factor: config.spike.pause_extension_factor,
    };

    // Initialize timing thresholds with defaults (legacy discrete system)
    this.timingThresholds = { ...DEFAULT_TIMING_THRESHOLDS };

    // Initialize continuous adaptation config
    this.continuousAdaptationConfig = { ...DEFAULT_CONTINUOUS_ADAPTATION_CONFIG };

    // Initialize calibration config
    this.calibrationConfig = { ...DEFAULT_CALIBRATION_CONFIG };

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

    // Reset continuous adaptation to baseline for new session
    this.resetContinuousAdaptation();
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
   * @param responseLatencyMs - How long the learner took to respond (legacy: pause duration)
   * @param wasFastOrTiming - Either boolean wasFast (legacy) or SpeechTimingResult
   * @returns What to do next (continue, repeat, or breakdown) plus competence signal and performance score
   */
  processCompletion(
    item: LearningItem,
    responseLatencyMs: number,
    wasFastOrTiming?: boolean | SpeechTimingResult
  ): AdaptedItem & {
    masteryTransition?: MasteryTransition | null;
    timingSignal?: TimingCompetenceSignal;
    performanceScore?: ContinuousPerformanceScore;
  } {
    // Decrement pause extension counter at start of each item
    this.decrementPauseExtension();

    // If we're in a breakdown sequence, continue it
    if (this.breakdownState) {
      return this.continueBreakdown();
    }

    // Parse arguments - support both legacy (boolean) and new (timing) signatures
    let wasFast = false;
    let timing: SpeechTimingResult | undefined;

    if (typeof wasFastOrTiming === 'boolean') {
      wasFast = wasFastOrTiming;
    } else if (wasFastOrTiming && typeof wasFastOrTiming === 'object') {
      timing = wasFastOrTiming;
      // Derive wasFast from timing data
      if (timing.response_latency_ms !== null) {
        wasFast = timing.response_latency_ms < this.timingThresholds.quick_response_ms;
      }
    }

    const { lego, phrase, thread_id } = item;

    // Record the metric (with timing data if available)
    const metric = this.metricsTracker.recordResponse(
      lego.id,
      responseLatencyMs,
      phrase.phrase.target.length,
      thread_id,
      item.mode,
      timing
    );

    // Update weighted selector - record practice
    this.weightedSelector.updateAfterPractice(lego.id);

    // Track calibration progress
    if (this.calibrationState === 'in_progress') {
      this.calibrationItemCount++;
      const calibrationResult = this.checkCalibrationAutoComplete();
      if (calibrationResult?.success) {
        // Calibration just completed - baseline is now available
        console.log(`Calibration complete after ${calibrationResult.itemCount} items`);
      }
    }

    // Assess competence from timing data (legacy discrete system)
    const timingSignal = timing ? this.assessTimingCompetence(timing) : undefined;

    // Calculate continuous performance score (new smooth system)
    // During calibration, this will return neutral values (multiplier = 1.0)
    const performanceScore = this.calculateContinuousPerformance(timing);

    // If spike detection is disabled, use continuous adaptation only
    if (!this.enabled) {
      const transition = this.masteryStateMachine.recordSmooth(lego.id, wasFast);

      // Note: pause extension is now handled by continuous adaptation
      // (getPauseDurationMultiplier uses currentPauseMultiplier)

      return {
        original_lego_id: lego.id,
        action: 'continue',
        reason: performanceScore.hasReliableData
          ? `Spike detection disabled. Performance score: ${performanceScore.overallScore.toFixed(2)}, pause: ${performanceScore.pauseMultiplier.toFixed(2)}x`
          : 'Spike detection disabled (building baseline)',
        masteryTransition: transition,
        timingSignal,
        performanceScore,
      };
    }

    // Process through spike detector
    const { detection, response, spike } = this.spikeDetector.processResponse(
      lego.id,
      metric.normalized_latency,
      lego.type,
      thread_id
    );

    // Combine spike detection with timing-based assessment
    const isStruggling = spike || timingSignal?.competence === 'struggling';
    const isConfident = !spike && timingSignal?.competence === 'confident';

    // Update mastery state based on combined assessment
    let masteryTransition: MasteryTransition | null = null;
    if (isStruggling) {
      // Map severity to discontinuity severity
      const severity = spike
        ? this.mapSeverityToDiscontinuity(detection.severity)
        : 'mild'; // Timing-only struggle is mild
      masteryTransition = this.masteryStateMachine.recordDiscontinuity(lego.id, severity);

      // Record discontinuity in weighted selector
      this.weightedSelector.recordDiscontinuity(lego.id);
    } else {
      // No spike - record smooth response (fast if confident)
      masteryTransition = this.masteryStateMachine.recordSmooth(lego.id, isConfident || wasFast);
    }

    // Extend pause if spike detected OR timing indicates struggling
    if ((spike && response.action !== 'none' && !response.in_cooldown) ||
        timingSignal?.recommendation === 'extend_pause') {
      this.triggerPauseExtension();
    }

    // Handle the response
    const result = this.handleSpikeResponse(response, lego, spike);
    return {
      ...result,
      masteryTransition,
      timingSignal,
      performanceScore,
    };
  }

  /**
   * Assess competence from speech timing data
   */
  assessTimingCompetence(timing: SpeechTimingResult): TimingCompetenceSignal {
    const { response_latency_ms, duration_delta_ms, started_during_prompt, still_speaking_at_voice1, speech_detected } = timing;

    // Build flags
    const flags = {
      quick_response: response_latency_ms !== null && response_latency_ms < this.timingThresholds.quick_response_ms,
      good_prosody_match: duration_delta_ms !== null && Math.abs(duration_delta_ms) < this.timingThresholds.good_prosody_delta_ms,
      anticipated: started_during_prompt,
      overlapped_answer: still_speaking_at_voice1,
      no_speech: !speech_detected,
    };

    // Determine competence level
    let competence: TimingCompetenceSignal['competence'] = 'normal';
    let recommendation: TimingCompetenceSignal['recommendation'] = 'standard';
    let reason = 'Normal response';

    if (flags.no_speech) {
      competence = 'unknown';
      recommendation = 'none';
      reason = 'No speech detected';
    } else if (flags.overlapped_answer) {
      // Struggling: still speaking when answer played
      competence = 'struggling';
      recommendation = 'extend_pause';
      reason = 'Still speaking when answer started - needs more time';
    } else if (flags.anticipated && flags.quick_response && flags.good_prosody_match) {
      // Very confident: anticipated, quick, good prosody
      competence = 'confident';
      recommendation = 'fast_track';
      reason = 'Anticipated phrase with good timing - very confident';
    } else if (flags.quick_response && flags.good_prosody_match) {
      // Confident: quick response with good prosody
      competence = 'confident';
      recommendation = 'fast_track';
      reason = 'Quick response with good prosody match';
    } else if (response_latency_ms !== null && response_latency_ms > this.timingThresholds.slow_response_ms) {
      // Slow response indicates hesitation
      competence = 'struggling';
      recommendation = 'extend_pause';
      reason = 'Slow to respond - may need more practice';
    } else if (duration_delta_ms !== null && Math.abs(duration_delta_ms) > this.timingThresholds.poor_prosody_delta_ms) {
      // Poor prosody match
      competence = 'struggling';
      recommendation = 'extend_pause';
      reason = 'Speech duration significantly different from model';
    }

    return { competence, flags, recommendation, reason };
  }

  // ============================================
  // CONTINUOUS ADAPTATION (Rolling Averages)
  // ============================================

  /**
   * Calculate continuous performance score based on rolling averages.
   * This is the core of the "invisible" adaptation system.
   *
   * Instead of fixed thresholds, we compare the current response to
   * the learner's own baseline (if calibrated) or rolling averages.
   *
   * During calibration mode, returns neutral values (multiplier = 1.0)
   * to avoid adapting before we know the learner's baseline.
   *
   * @param timing - Optional speech timing data from current response
   * @returns ContinuousPerformanceScore with z-scores and smooth pause multiplier
   */
  calculateContinuousPerformance(timing?: SpeechTimingResult): ContinuousPerformanceScore {
    const config = this.continuousAdaptationConfig;

    // During calibration, return neutral values - don't adapt yet
    if (this.calibrationState === 'in_progress') {
      return this.createNeutralPerformanceScore(timing);
    }

    // Determine which baseline to use:
    // 1. If calibrated, use learner baseline (blended with session data)
    // 2. Otherwise, use session rolling averages
    const baseline = this.learnerBaseline;
    const sessionAvgLatency = this.metricsTracker.getRollingAverage();
    const sessionStdDevLatency = this.metricsTracker.getRollingStdDev();
    const sessionAvgDurationDelta = this.metricsTracker.getRollingAvgLengthDelta();
    const sessionStdDevDurationDelta = this.metricsTracker.getRollingStdDevLengthDelta();
    const hasSessionData = this.metricsTracker.hasEnoughData();

    // Use baseline if available, blending with session data for recency
    let effectiveAvgLatency: number;
    let effectiveStdDevLatency: number;
    let effectiveAvgDurationDelta: number;
    let effectiveStdDevDurationDelta: number;

    if (baseline && hasSessionData) {
      // Blend baseline (70%) with session data (30%) for smooth adaptation
      const baselineWeight = 0.7;
      const sessionWeight = 0.3;

      effectiveAvgLatency = baseline.latency.mean * baselineWeight + sessionAvgLatency * sessionWeight;
      effectiveStdDevLatency = baseline.latency.stdDev * baselineWeight + sessionStdDevLatency * sessionWeight;
      effectiveAvgDurationDelta = baseline.durationDelta.mean * baselineWeight + sessionAvgDurationDelta * sessionWeight;
      effectiveStdDevDurationDelta = baseline.durationDelta.stdDev * baselineWeight + sessionStdDevDurationDelta * sessionWeight;
    } else if (baseline) {
      // Use baseline only (no session data yet)
      effectiveAvgLatency = baseline.latency.mean;
      effectiveStdDevLatency = baseline.latency.stdDev;
      effectiveAvgDurationDelta = baseline.durationDelta.mean;
      effectiveStdDevDurationDelta = baseline.durationDelta.stdDev;
    } else {
      // No baseline, use session data only
      effectiveAvgLatency = sessionAvgLatency;
      effectiveStdDevLatency = sessionStdDevLatency;
      effectiveAvgDurationDelta = sessionAvgDurationDelta;
      effectiveStdDevDurationDelta = sessionStdDevDurationDelta;
    }

    const hasReliableData = hasSessionData || baseline !== null;

    // Get current values from timing (or null if not available)
    const currentLatency = timing?.response_latency_ms ?? null;
    const currentDurationDelta = timing?.duration_delta_ms ?? null;

    // Calculate z-scores (if we have data)
    let latencyZScore: number | null = null;
    let durationDeltaZScore: number | null = null;

    if (hasReliableData && effectiveStdDevLatency > 0) {
      // For latency: positive z-score = slower than average (bad)
      // We use normalized latency from the most recent metric
      const window = this.metricsTracker.getRollingWindow();
      const lastMetric = window[window.length - 1];
      if (lastMetric) {
        latencyZScore = (lastMetric.normalized_latency - effectiveAvgLatency) / effectiveStdDevLatency;
      }
    }

    if (hasReliableData && currentDurationDelta !== null && effectiveStdDevDurationDelta > 0) {
      // For duration delta: we care about absolute deviation from learner's norm
      // High absolute z-score = inconsistent prosody
      durationDeltaZScore = (currentDurationDelta - effectiveAvgDurationDelta) / effectiveStdDevDurationDelta;
    }

    // Calculate overall score from -1 (struggling) to +1 (confident)
    let overallScore = 0;

    if (hasReliableData) {
      // Latency contribution: negative z-score (faster) = positive score
      const latencyContribution = latencyZScore !== null
        ? -latencyZScore * config.latencyWeight
        : 0;

      // Duration delta contribution: close to zero = good
      // We penalize absolute deviation
      const durationContribution = durationDeltaZScore !== null
        ? -(Math.abs(durationDeltaZScore) - 1) * (1 - config.latencyWeight) // Baseline at 1 std dev
        : 0;

      overallScore = latencyContribution + durationContribution;

      // Clamp to [-1, 1]
      overallScore = Math.max(-1, Math.min(1, overallScore));

      // Check for overlap flags which override z-scores
      if (timing?.still_speaking_at_voice1) {
        // Definite struggle signal - push score negative
        overallScore = Math.min(overallScore, -0.5);
      }
      if (timing?.started_during_prompt && latencyZScore !== null && latencyZScore < -1) {
        // Anticipated + fast = confident - push score positive
        overallScore = Math.max(overallScore, 0.5);
      }
    }

    // Calculate target pause multiplier from overall score
    // score -1 → maxPauseMultiplier (struggling, need more time)
    // score 0  → 1.0 (baseline)
    // score +1 → minPauseMultiplier (confident, can go faster)
    const targetPauseMultiplier = this.scoreToMultiplier(overallScore, config);

    // Smooth the pause multiplier toward target (exponential moving average)
    this.currentPauseMultiplier = this.smoothValue(
      this.currentPauseMultiplier,
      targetPauseMultiplier,
      config.responsiveness
    );

    const score: ContinuousPerformanceScore = {
      latencyZScore,
      durationDeltaZScore,
      overallScore,
      pauseMultiplier: this.currentPauseMultiplier,
      hasReliableData,
      debug: {
        rollingAvgLatency: effectiveAvgLatency,
        rollingStdDevLatency: effectiveStdDevLatency,
        currentLatency,
        rollingAvgDurationDelta: effectiveAvgDurationDelta,
        rollingStdDevDurationDelta: effectiveStdDevDurationDelta,
        currentDurationDelta,
      },
    };

    this.lastPerformanceScore = score;
    return score;
  }

  /**
   * Create a neutral performance score (used during calibration)
   */
  private createNeutralPerformanceScore(timing?: SpeechTimingResult): ContinuousPerformanceScore {
    const currentLatency = timing?.response_latency_ms ?? null;
    const currentDurationDelta = timing?.duration_delta_ms ?? null;

    return {
      latencyZScore: null,
      durationDeltaZScore: null,
      overallScore: 0,
      pauseMultiplier: 1.0, // Neutral - no adaptation during calibration
      hasReliableData: false,
      debug: {
        rollingAvgLatency: 0,
        rollingStdDevLatency: 0,
        currentLatency,
        rollingAvgDurationDelta: 0,
        rollingStdDevDurationDelta: 0,
        currentDurationDelta,
      },
    };
  }

  /**
   * Convert overall score to pause multiplier.
   * Uses a sigmoid-like curve for smooth transitions.
   */
  private scoreToMultiplier(score: number, config: ContinuousAdaptationConfig): number {
    // Linear interpolation with clamping
    // score -1 → max multiplier (struggling)
    // score 0  → 1.0 (baseline)
    // score +1 → min multiplier (confident)
    if (score >= 0) {
      // Confident: interpolate from 1.0 to minPauseMultiplier
      return 1.0 - (score * (1.0 - config.minPauseMultiplier));
    } else {
      // Struggling: interpolate from 1.0 to maxPauseMultiplier
      return 1.0 + (-score * (config.maxPauseMultiplier - 1.0));
    }
  }

  /**
   * Exponential moving average for smooth transitions.
   * @param current - Current value
   * @param target - Target value to move toward
   * @param responsiveness - How quickly to move (0-1)
   */
  private smoothValue(current: number, target: number, responsiveness: number): number {
    return current + (target - current) * responsiveness;
  }

  /**
   * Get the last calculated performance score
   */
  getLastPerformanceScore(): ContinuousPerformanceScore | null {
    return this.lastPerformanceScore;
  }

  /**
   * Get the current continuous adaptation config
   */
  getContinuousAdaptationConfig(): ContinuousAdaptationConfig {
    return { ...this.continuousAdaptationConfig };
  }

  /**
   * Update continuous adaptation config
   */
  updateContinuousAdaptationConfig(config: Partial<ContinuousAdaptationConfig>): void {
    this.continuousAdaptationConfig = { ...this.continuousAdaptationConfig, ...config };
  }

  /**
   * Reset the continuous adaptation state (e.g., for new session)
   */
  resetContinuousAdaptation(): void {
    this.currentPauseMultiplier = 1.0;
    this.lastPerformanceScore = null;
  }

  // ============================================
  // CALIBRATION (Learner Baseline)
  // ============================================

  /**
   * Start calibration mode.
   * During calibration, we gather data but don't adapt (multiplier stays at 1.0).
   * Call this at the start of a learner's first session.
   */
  startCalibration(): void {
    this.calibrationState = 'in_progress';
    this.calibrationItemCount = 0;
    // Keep any existing baseline as fallback
  }

  /**
   * Check if calibration should auto-complete and do so if needed.
   * Called internally after each item during calibration.
   */
  private checkCalibrationAutoComplete(): CalibrationResult | null {
    if (this.calibrationState !== 'in_progress') return null;

    const config = this.calibrationConfig;

    // Check if we should auto-complete
    if (config.autoComplete && this.calibrationItemCount >= config.minItems) {
      return this.completeCalibration();
    }

    // Check if we hit max items (force complete)
    if (this.calibrationItemCount >= config.maxItems) {
      return this.completeCalibration();
    }

    return null;
  }

  /**
   * Complete calibration and establish baseline.
   * Can be called manually or auto-triggered based on config.
   */
  completeCalibration(): CalibrationResult {
    if (this.calibrationState !== 'in_progress') {
      return {
        success: false,
        reason: 'Calibration not in progress',
        itemCount: this.calibrationItemCount,
      };
    }

    const itemCount = this.calibrationItemCount;

    // Check minimum items
    if (itemCount < this.calibrationConfig.minItems) {
      return {
        success: false,
        reason: `Not enough items (${itemCount}/${this.calibrationConfig.minItems})`,
        itemCount,
      };
    }

    // Get stats from metrics tracker
    const rollingAvgLatency = this.metricsTracker.getRollingAverage();
    const rollingStdDevLatency = this.metricsTracker.getRollingStdDev();
    const rollingAvgDurationDelta = this.metricsTracker.getRollingAvgLengthDelta();
    const rollingStdDevDurationDelta = this.metricsTracker.getRollingStdDevLengthDelta();

    // Check if we have meaningful variance
    const hasTimingData = rollingStdDevDurationDelta > 0;
    const latencyStdDev = Math.max(rollingStdDevLatency, this.calibrationConfig.minStdDev);

    // Create baseline
    const baseline: LearnerBaseline = {
      calibrated_at: new Date(),
      calibration_items: itemCount,
      latency: {
        mean: rollingAvgLatency,
        stdDev: latencyStdDev,
      },
      durationDelta: {
        mean: rollingAvgDurationDelta,
        stdDev: Math.max(rollingStdDevDurationDelta, 100), // Minimum 100ms stddev
      },
      hadTimingData: hasTimingData,
    };

    this.learnerBaseline = baseline;
    this.calibrationState = 'completed';

    return {
      success: true,
      baseline,
      itemCount,
    };
  }

  /**
   * Skip calibration and use defaults or provided baseline.
   * Use this for returning learners with a stored baseline.
   */
  skipCalibration(existingBaseline?: LearnerBaseline): void {
    this.calibrationState = 'skipped';
    if (existingBaseline) {
      this.learnerBaseline = existingBaseline;
    }
  }

  /**
   * Get current calibration state
   */
  getCalibrationState(): CalibrationState {
    return this.calibrationState;
  }

  /**
   * Get calibration progress
   */
  getCalibrationProgress(): { current: number; min: number; max: number } {
    return {
      current: this.calibrationItemCount,
      min: this.calibrationConfig.minItems,
      max: this.calibrationConfig.maxItems,
    };
  }

  /**
   * Check if calibration is complete (or skipped with baseline)
   */
  isCalibrated(): boolean {
    return (
      (this.calibrationState === 'completed' || this.calibrationState === 'skipped') &&
      this.learnerBaseline !== null
    );
  }

  /**
   * Get the learner's baseline (if calibrated)
   */
  getLearnerBaseline(): LearnerBaseline | null {
    return this.learnerBaseline ? { ...this.learnerBaseline } : null;
  }

  /**
   * Import a baseline (e.g., from storage).
   * Use this to restore a learner's baseline from persistence.
   */
  importBaseline(baseline: LearnerBaseline): void {
    this.learnerBaseline = { ...baseline };
    if (this.calibrationState === 'not_started' || this.calibrationState === 'in_progress') {
      this.calibrationState = 'skipped';
    }
  }

  /**
   * Export the baseline for persistence.
   * Returns null if not calibrated.
   */
  exportBaseline(): LearnerBaseline | null {
    return this.getLearnerBaseline();
  }

  /**
   * Update calibration config
   */
  updateCalibrationConfig(config: Partial<CalibrationConfig>): void {
    this.calibrationConfig = { ...this.calibrationConfig, ...config };
  }

  /**
   * Get calibration config
   */
  getCalibrationConfig(): CalibrationConfig {
    return { ...this.calibrationConfig };
  }

  /**
   * Get current timing thresholds
   */
  getTimingThresholds(): TimingThresholds {
    return { ...this.timingThresholds };
  }

  /**
   * Update timing thresholds
   */
  updateTimingThresholds(thresholds: Partial<TimingThresholds>): void {
    this.timingThresholds = { ...this.timingThresholds, ...thresholds };
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
   * NEW BEHAVIOR (continuous adaptation):
   * Returns the smoothed pause multiplier from continuous performance tracking.
   * Typically ranges from 0.8 (confident) to 1.4 (struggling).
   *
   * LEGACY BEHAVIOR (discrete spikes):
   * If a discrete spike triggered pause extension, that takes precedence.
   *
   * Use this to adjust pause timing in CycleOrchestrator:
   *   effectivePause = basePause * getPauseDurationMultiplier()
   */
  getPauseDurationMultiplier(): number {
    // Legacy discrete pause extension takes precedence if active
    if (
      this.config.spike.pause_extension_enabled &&
      this.pauseExtensionState.isExtended &&
      this.pauseExtensionState.itemsRemaining > 0
    ) {
      // Use the higher of legacy extension or continuous multiplier
      const legacyMultiplier = 1 + this.pauseExtensionState.factor;
      return Math.max(legacyMultiplier, this.currentPauseMultiplier);
    }

    // Use continuous adaptation multiplier
    return this.currentPauseMultiplier;
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
