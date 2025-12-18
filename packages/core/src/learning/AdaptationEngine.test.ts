/**
 * Tests for AdaptationEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptationEngine, createAdaptationEngine } from './AdaptationEngine';
import type { LearningConfig } from '../config/types';
import type { LearningItem, LegoPair, SeedPair, PracticePhrase } from '../data/types';
import type { SpeechTimingResult } from '../audio/types';

describe('AdaptationEngine', () => {
  const defaultConfig: LearningConfig = {
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
      pause_extension_enabled: true,
      pause_extension_factor: 0.3,
      pause_extension_duration: 5,
    },
    lego_introduction: {
      eternal_phrase_count: 5,
      molecular_breakdown_enabled: true,
      debut_phrases_repeat: false,
    },
    content_injection: {
      enabled: true,
      max_threads_for_injection: 2,
      subject_categories: ['travel', 'food', 'work'],
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
    },
  };

  let engine: AdaptationEngine;

  function createMockLego(id: string, type: 'A' | 'M', withComponents: boolean = false): LegoPair {
    return {
      id,
      type,
      new: true,
      lego: { known: 'test', target: 'prueba' },
      components: withComponents ? [
        { known: 'te', target: 'prue' },
        { known: 'st', target: 'eba' },
      ] : undefined,
      audioRefs: {
        known: { id: 'audio-k', url: 'http://test.com/k.mp3' },
        target: {
          voice1: { id: 'audio-t1', url: 'http://test.com/t1.mp3' },
          voice2: { id: 'audio-t2', url: 'http://test.com/t2.mp3' },
        },
      },
    };
  }

  function createMockSeed(id: string, legos: LegoPair[]): SeedPair {
    return {
      seed_id: id,
      seed_pair: { known: 'full test', target: 'prueba completa' },
      legos,
    };
  }

  function createMockPhrase(legoId: string): PracticePhrase {
    return {
      id: `phrase-${legoId}`,
      phraseType: 'practice',
      phrase: { known: 'test phrase', target: 'frase de prueba' },
      audioRefs: {
        known: { id: 'audio-k', url: 'http://test.com/k.mp3' },
        target: {
          voice1: { id: 'audio-t1', url: 'http://test.com/t1.mp3' },
          voice2: { id: 'audio-t2', url: 'http://test.com/t2.mp3' },
        },
      },
      wordCount: 3,
      containsLegos: [legoId],
    };
  }

  function createMockItem(legoId: string, legoType: 'A' | 'M', withComponents: boolean = false): LearningItem {
    const lego = createMockLego(legoId, legoType, withComponents);
    const seed = createMockSeed('seed-1', [lego]);
    return {
      lego,
      phrase: createMockPhrase(legoId),
      seed,
      thread_id: 1,
      mode: 'practice',
    };
  }

  beforeEach(() => {
    engine = createAdaptationEngine(defaultConfig);
    engine.startSession('test-session');
  });

  describe('session management', () => {
    it('should start a session', () => {
      const tracker = engine.getMetricsTracker();
      const session = tracker.getCurrentSession();

      expect(session).not.toBeNull();
      expect(session?.session_id).toBe('test-session');
    });

    it('should end a session', () => {
      const session = engine.endSession();

      expect(session).not.toBeNull();
      expect(session?.ended_at).not.toBeNull();
    });
  });

  describe('processCompletion', () => {
    it('should return continue for normal response', () => {
      // Fill up rolling window with normal responses
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Normal response
      const item = createMockItem('lego-normal', 'A');
      const result = engine.processCompletion(item, 1000);

      expect(result.action).toBe('continue');
      expect(result.original_lego_id).toBe('lego-normal');
    });

    it('should return repeat for spike on A-type', () => {
      // Fill rolling window (normalized latency = 100)
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000); // 1000ms / 10 chars = 100
      }

      // Spike response (2000ms / 10 chars = 200 > 150 threshold)
      const item = createMockItem('lego-spike', 'A');
      const result = engine.processCompletion(item, 2000);

      expect(result.action).toBe('repeat');
    });

    it('should return breakdown for M-type with components', () => {
      // Set strategy to breakdown
      engine.updateConfig({
        spike: { ...defaultConfig.spike, response_strategy: 'breakdown' },
      });

      // Fill rolling window
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Spike on M-type with components
      const item = createMockItem('lego-molecular', 'M', true);
      const result = engine.processCompletion(item, 2000);

      expect(result.action).toBe('breakdown');
      expect(result.breakdown_components).toBeDefined();
      expect(result.breakdown_components?.length).toBeGreaterThan(0);
    });
  });

  describe('breakdown sequence', () => {
    beforeEach(() => {
      engine.updateConfig({
        spike: { ...defaultConfig.spike, response_strategy: 'breakdown' },
      });

      // Fill rolling window
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }
    });

    it('should track breakdown state', () => {
      const item = createMockItem('lego-molecular', 'M', true);
      engine.processCompletion(item, 2000); // Triggers breakdown

      expect(engine.isInBreakdown()).toBe(true);
      expect(engine.getBreakdownState()).not.toBeNull();
    });

    it('should continue breakdown sequence', () => {
      const item = createMockItem('lego-molecular', 'M', true);
      engine.processCompletion(item, 2000); // Triggers breakdown

      // Continue breakdown
      const result = engine.processCompletion(item, 1000);

      expect(result.action).toBe('breakdown');
    });

    it('should complete breakdown and buildup', () => {
      const item = createMockItem('lego-molecular', 'M', true);
      engine.processCompletion(item, 2000); // Triggers breakdown

      // Complete breakdown (2 components) and buildup
      for (let i = 0; i < 10; i++) {
        const result = engine.processCompletion(item, 1000);
        if (result.action === 'continue') {
          expect(result.reason).toContain('complete');
          break;
        }
      }

      expect(engine.isInBreakdown()).toBe(false);
    });
  });

  describe('enabled state', () => {
    it('should skip spike detection when disabled', () => {
      engine.setEnabled(false);

      // Fill rolling window
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Spike would trigger, but disabled
      const item = createMockItem('lego-spike', 'A');
      const result = engine.processCompletion(item, 2000);

      expect(result.action).toBe('continue');
      expect(result.reason).toContain('disabled');
    });

    it('should report enabled state', () => {
      expect(engine.isEnabled()).toBe(true);

      engine.setEnabled(false);
      expect(engine.isEnabled()).toBe(false);
    });
  });

  describe('config updates', () => {
    it('should update spike config', () => {
      engine.updateConfig({
        spike: { ...defaultConfig.spike, threshold_percent: 200 },
      });

      // Fill rolling window
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // 160% wouldn't trigger at 200% threshold
      const item = createMockItem('lego-spike', 'A');
      const result = engine.processCompletion(item, 1600);

      expect(result.action).toBe('continue');
    });

    it('should update enabled state via features config', () => {
      engine.updateConfig({
        features: { ...defaultConfig.features, spike_detection_enabled: false },
      });

      expect(engine.isEnabled()).toBe(false);
    });
  });

  describe('component access', () => {
    it('should provide metrics tracker', () => {
      const tracker = engine.getMetricsTracker();
      expect(tracker).toBeDefined();
    });

    it('should provide spike detector', () => {
      const detector = engine.getSpikeDetector();
      expect(detector).toBeDefined();
    });
  });

  describe('factory function', () => {
    it('should create engine via factory', () => {
      const eng = createAdaptationEngine(defaultConfig);
      expect(eng).toBeInstanceOf(AdaptationEngine);
    });
  });

  // ============================================
  // TIMING-BASED COMPETENCE ASSESSMENT
  // ============================================

  describe('timing-based adaptation', () => {
    function createMockTiming(overrides?: Partial<SpeechTimingResult>): SpeechTimingResult {
      return {
        prompt_start_ms: 0,
        prompt_end_ms: 2000,
        voice1_start_ms: 6000,
        speech_start_ms: 2500,
        speech_end_ms: 5000,
        response_latency_ms: 2500,
        learner_duration_ms: 2500,
        duration_delta_ms: 500,
        started_during_prompt: false,
        still_speaking_at_voice1: false,
        speech_detected: true,
        peak_energy_db: -30,
        average_energy_db: -40,
        ...overrides,
      };
    }

    it('should assess confident response from quick timing', () => {
      const timing = createMockTiming({
        response_latency_ms: 1500, // Under 2000ms threshold
        duration_delta_ms: 200, // Under 500ms threshold
      });

      const signal = engine.assessTimingCompetence(timing);

      expect(signal.competence).toBe('confident');
      expect(signal.flags.quick_response).toBe(true);
      expect(signal.flags.good_prosody_match).toBe(true);
      expect(signal.recommendation).toBe('fast_track');
    });

    it('should assess struggling response from voice1 overlap', () => {
      const timing = createMockTiming({
        still_speaking_at_voice1: true,
      });

      const signal = engine.assessTimingCompetence(timing);

      expect(signal.competence).toBe('struggling');
      expect(signal.flags.overlapped_answer).toBe(true);
      expect(signal.recommendation).toBe('extend_pause');
    });

    it('should assess confident response from anticipation', () => {
      const timing = createMockTiming({
        started_during_prompt: true,
        response_latency_ms: 1500, // Quick
        duration_delta_ms: 200, // Good prosody
      });

      const signal = engine.assessTimingCompetence(timing);

      expect(signal.competence).toBe('confident');
      expect(signal.flags.anticipated).toBe(true);
      expect(signal.reason).toContain('Anticipated');
    });

    it('should assess struggling response from slow latency', () => {
      const timing = createMockTiming({
        response_latency_ms: 6000, // Over 5000ms threshold
      });

      const signal = engine.assessTimingCompetence(timing);

      expect(signal.competence).toBe('struggling');
      expect(signal.recommendation).toBe('extend_pause');
    });

    it('should assess struggling response from poor prosody', () => {
      const timing = createMockTiming({
        response_latency_ms: 3000, // Normal
        duration_delta_ms: 2000, // Over 1500ms threshold
      });

      const signal = engine.assessTimingCompetence(timing);

      expect(signal.competence).toBe('struggling');
      expect(signal.reason).toContain('duration');
    });

    it('should handle no speech detected', () => {
      const timing = createMockTiming({
        speech_detected: false,
        speech_start_ms: null,
        speech_end_ms: null,
        response_latency_ms: null,
        learner_duration_ms: null,
        duration_delta_ms: null,
      });

      const signal = engine.assessTimingCompetence(timing);

      expect(signal.competence).toBe('unknown');
      expect(signal.flags.no_speech).toBe(true);
      expect(signal.recommendation).toBe('none');
    });
  });

  describe('processCompletion with timing', () => {
    function createMockTiming(overrides?: Partial<SpeechTimingResult>): SpeechTimingResult {
      return {
        prompt_start_ms: 0,
        prompt_end_ms: 2000,
        voice1_start_ms: 6000,
        speech_start_ms: 2500,
        speech_end_ms: 5000,
        response_latency_ms: 2500,
        learner_duration_ms: 2500,
        duration_delta_ms: 500,
        started_during_prompt: false,
        still_speaking_at_voice1: false,
        speech_detected: true,
        peak_energy_db: -30,
        average_energy_db: -40,
        ...overrides,
      };
    }

    it('should include timing signal in result', () => {
      const item = createMockItem('lego-timing', 'A');
      const timing = createMockTiming();

      const result = engine.processCompletion(item, 3000, timing);

      expect(result.timingSignal).toBeDefined();
      expect(result.timingSignal?.competence).toBeDefined();
    });

    it('should fast-track confident responses', () => {
      // Fill rolling window
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      const item = createMockItem('lego-confident', 'A');
      const timing = createMockTiming({
        response_latency_ms: 1500,
        duration_delta_ms: 200,
      });

      const result = engine.processCompletion(item, 3000, timing);

      expect(result.timingSignal?.competence).toBe('confident');
      // Confident response should be recorded as "fast" for mastery
      expect(result.masteryTransition).toBeDefined();
    });

    it('should extend pause for struggling responses', () => {
      // Fill rolling window
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      const item = createMockItem('lego-struggling', 'A');
      const timing = createMockTiming({
        still_speaking_at_voice1: true,
      });

      engine.processCompletion(item, 3000, timing);

      // Pause should be extended
      expect(engine.getPauseDurationMultiplier()).toBeGreaterThan(1);
    });

    it('should store timing data in metrics', () => {
      const item = createMockItem('lego-metrics', 'A');
      const timing = createMockTiming({
        response_latency_ms: 2500,
        duration_delta_ms: 300,
        started_during_prompt: true,
      });

      engine.processCompletion(item, 3000, timing);

      const tracker = engine.getMetricsTracker();
      const window = tracker.getRollingWindow();
      const lastMetric = window[window.length - 1];

      expect(lastMetric.true_latency_ms).toBe(2500);
      expect(lastMetric.duration_delta_ms).toBe(300);
      expect(lastMetric.started_during_prompt).toBe(true);
    });

    it('should support legacy boolean wasFast parameter', () => {
      const item = createMockItem('lego-legacy', 'A');

      // Legacy call with boolean
      const result = engine.processCompletion(item, 1000, true);

      expect(result.action).toBe('continue');
      // Should not have timing signal since no timing data provided
      expect(result.timingSignal).toBeUndefined();
    });
  });

  describe('timing thresholds', () => {
    it('should get default timing thresholds', () => {
      const thresholds = engine.getTimingThresholds();

      expect(thresholds.quick_response_ms).toBe(2000);
      expect(thresholds.slow_response_ms).toBe(5000);
      expect(thresholds.good_prosody_delta_ms).toBe(500);
      expect(thresholds.poor_prosody_delta_ms).toBe(1500);
    });

    it('should update timing thresholds', () => {
      engine.updateTimingThresholds({
        quick_response_ms: 1500,
        slow_response_ms: 4000,
      });

      const thresholds = engine.getTimingThresholds();

      expect(thresholds.quick_response_ms).toBe(1500);
      expect(thresholds.slow_response_ms).toBe(4000);
      // Unchanged values should persist
      expect(thresholds.good_prosody_delta_ms).toBe(500);
    });

    it('should use updated thresholds for assessment', () => {
      // Lower the quick response threshold
      engine.updateTimingThresholds({ quick_response_ms: 1000 });

      const timing: SpeechTimingResult = {
        prompt_start_ms: 0,
        prompt_end_ms: 2000,
        voice1_start_ms: 6000,
        speech_start_ms: 2500,
        speech_end_ms: 5000,
        response_latency_ms: 1500, // Would be quick at 2000, but not at 1000
        learner_duration_ms: 2500,
        duration_delta_ms: 200,
        started_during_prompt: false,
        still_speaking_at_voice1: false,
        speech_detected: true,
        peak_energy_db: -30,
        average_energy_db: -40,
      };

      const signal = engine.assessTimingCompetence(timing);

      // Should NOT be quick response since 1500 > 1000
      expect(signal.flags.quick_response).toBe(false);
      expect(signal.competence).toBe('normal');
    });
  });

  describe('continuous adaptation', () => {
    function createMockTiming(overrides?: Partial<SpeechTimingResult>): SpeechTimingResult {
      return {
        prompt_start_ms: 0,
        prompt_end_ms: 2000,
        voice1_start_ms: 6000,
        speech_start_ms: 2500,
        speech_end_ms: 5000,
        response_latency_ms: 2500,
        learner_duration_ms: 2500,
        duration_delta_ms: 500,
        started_during_prompt: false,
        still_speaking_at_voice1: false,
        speech_detected: true,
        peak_energy_db: -30,
        average_energy_db: -40,
        ...overrides,
      };
    }

    it('should return performance score from processCompletion', () => {
      engine.startSession('continuous-test');

      const item = createMockItem('lego-1', 'A');
      const result = engine.processCompletion(item, 1000);

      expect(result.performanceScore).toBeDefined();
      expect(result.performanceScore?.pauseMultiplier).toBe(1.0); // Baseline
    });

    it('should calculate z-scores from rolling averages', () => {
      engine.startSession('zscore-test');

      // Build up a baseline with consistent responses
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Now the engine has reliable data
      const score = engine.getLastPerformanceScore();
      expect(score?.hasReliableData).toBe(true);
    });

    it('should smoothly adjust pause multiplier', () => {
      engine.startSession('smooth-test');

      // Set responsiveness high for faster convergence in test
      engine.updateContinuousAdaptationConfig({ responsiveness: 0.5 });

      // Use calibration to establish baseline (multiplier stays at 1.0 during calibration)
      engine.updateCalibrationConfig({ minItems: 10 });
      engine.startCalibration();

      // Build baseline with consistent responses during calibration
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        // All 1000ms responses with same phrase length creates stable baseline
        engine.processCompletion(item, 1000);
      }

      // Calibration should auto-complete, baseline established
      expect(engine.getCalibrationState()).toBe('completed');
      const baselineMultiplier = engine.getPauseDurationMultiplier();
      expect(baselineMultiplier).toBeCloseTo(1.0, 1);

      // Now record a slower response (should push multiplier up)
      const slowItem = createMockItem('lego-slow', 'A');
      // Much longer latency should trigger higher multiplier
      engine.processCompletion(slowItem, 5000);

      const newMultiplier = engine.getPauseDurationMultiplier();
      // Should be higher than baseline (struggling)
      expect(newMultiplier).toBeGreaterThan(baselineMultiplier);
    });

    it('should reset continuous adaptation on new session', () => {
      engine.startSession('session-1');

      // Build up some state
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Verify state exists
      expect(engine.getLastPerformanceScore()).not.toBeNull();

      // Start new session
      engine.startSession('session-2');

      // State should be reset
      expect(engine.getPauseDurationMultiplier()).toBe(1.0);
    });

    it('should use continuous adaptation config', () => {
      const config = engine.getContinuousAdaptationConfig();

      expect(config.responsiveness).toBe(0.3);
      expect(config.minPauseMultiplier).toBe(0.8);
      expect(config.maxPauseMultiplier).toBe(1.4);
      expect(config.significantZScore).toBe(1.5);
      expect(config.latencyWeight).toBe(0.7);
    });

    it('should update continuous adaptation config', () => {
      engine.updateContinuousAdaptationConfig({
        responsiveness: 0.5,
        minPauseMultiplier: 0.7,
      });

      const config = engine.getContinuousAdaptationConfig();

      expect(config.responsiveness).toBe(0.5);
      expect(config.minPauseMultiplier).toBe(0.7);
      // Unchanged values should persist
      expect(config.maxPauseMultiplier).toBe(1.4);
    });

    it('should provide debug info in performance score', () => {
      engine.startSession('debug-test');

      // Build baseline
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      const score = engine.getLastPerformanceScore();

      expect(score?.debug).toBeDefined();
      expect(score?.debug.rollingAvgLatency).toBeGreaterThan(0);
      expect(score?.debug.rollingStdDevLatency).toBeGreaterThanOrEqual(0);
    });

    it('should include timing data in z-score calculation', () => {
      engine.startSession('timing-zscore-test');

      // Build baseline with consistent timing
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        const timing = createMockTiming({
          response_latency_ms: 2500,
          duration_delta_ms: 300,
        });
        engine.processCompletion(item, 1000, timing);
      }

      // Now send a much faster response
      const fastItem = createMockItem('lego-fast', 'A');
      const fastTiming = createMockTiming({
        response_latency_ms: 1000, // Much faster
        duration_delta_ms: 100,
      });
      const result = engine.processCompletion(fastItem, 500, fastTiming);

      // Should have calculated a latency z-score
      expect(result.performanceScore?.latencyZScore).toBeDefined();
      // Faster than average = negative z-score
      if (result.performanceScore?.latencyZScore !== null) {
        expect(result.performanceScore.latencyZScore).toBeLessThan(0);
      }
    });

    it('should clamp overall score to [-1, 1]', () => {
      engine.startSession('clamp-test');

      // Build baseline
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      const score = engine.getLastPerformanceScore();

      expect(score?.overallScore).toBeGreaterThanOrEqual(-1);
      expect(score?.overallScore).toBeLessThanOrEqual(1);
    });

    it('should push score negative for still_speaking_at_voice1', () => {
      engine.startSession('overlap-test');

      // Build baseline
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Now send struggling response
      const item = createMockItem('lego-struggle', 'A');
      const timing = createMockTiming({
        still_speaking_at_voice1: true,
      });
      const result = engine.processCompletion(item, 1000, timing);

      // Overall score should be negative (struggling)
      expect(result.performanceScore?.overallScore).toBeLessThanOrEqual(-0.5);
    });
  });

  describe('calibration', () => {
    it('should start in not_started state', () => {
      expect(engine.getCalibrationState()).toBe('not_started');
      expect(engine.isCalibrated()).toBe(false);
    });

    it('should track calibration progress', () => {
      engine.startSession('calibration-test');
      engine.startCalibration();

      expect(engine.getCalibrationState()).toBe('in_progress');

      // Record some items
      for (let i = 0; i < 5; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      const progress = engine.getCalibrationProgress();
      expect(progress.current).toBe(5);
      expect(progress.min).toBe(20); // Default minItems
      expect(progress.max).toBe(50); // Default maxItems
    });

    it('should not adapt during calibration', () => {
      engine.startSession('no-adapt-test');
      engine.startCalibration();

      // Record items with varying latencies
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        // Alternate fast and slow
        engine.processCompletion(item, i % 2 === 0 ? 500 : 5000);
      }

      // Multiplier should stay at 1.0 during calibration
      expect(engine.getPauseDurationMultiplier()).toBe(1.0);
    });

    it('should auto-complete calibration when minItems reached', () => {
      engine.startSession('auto-complete-test');
      engine.updateCalibrationConfig({ minItems: 10, maxItems: 50 });
      engine.startCalibration();

      // Record 10 items (should auto-complete)
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      expect(engine.getCalibrationState()).toBe('completed');
      expect(engine.isCalibrated()).toBe(true);
      expect(engine.getLearnerBaseline()).not.toBeNull();
    });

    it('should establish baseline with correct statistics', () => {
      engine.startSession('baseline-stats-test');
      engine.updateCalibrationConfig({ minItems: 10 });
      engine.startCalibration();

      // Record 10 items with same latency
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      const baseline = engine.getLearnerBaseline();
      expect(baseline).not.toBeNull();
      expect(baseline?.calibration_items).toBe(10);
      expect(baseline?.latency.mean).toBeGreaterThan(0);
    });

    it('should skip calibration with existing baseline', () => {
      const existingBaseline = {
        calibrated_at: new Date(),
        calibration_items: 30,
        latency: { mean: 100, stdDev: 20 },
        durationDelta: { mean: 200, stdDev: 150 },
        hadTimingData: true,
      };

      engine.skipCalibration(existingBaseline);

      expect(engine.getCalibrationState()).toBe('skipped');
      expect(engine.isCalibrated()).toBe(true);
      expect(engine.getLearnerBaseline()?.latency.mean).toBe(100);
    });

    it('should import and export baseline', () => {
      const baseline = {
        calibrated_at: new Date(),
        calibration_items: 25,
        latency: { mean: 80, stdDev: 15 },
        durationDelta: { mean: 100, stdDev: 80 },
        hadTimingData: false,
      };

      engine.importBaseline(baseline);

      const exported = engine.exportBaseline();
      expect(exported?.calibration_items).toBe(25);
      expect(exported?.latency.mean).toBe(80);
    });

    it('should use baseline for z-score calculation after calibration', () => {
      // Set up with imported baseline
      const baseline = {
        calibrated_at: new Date(),
        calibration_items: 30,
        latency: { mean: 100, stdDev: 20 }, // Normalized latency baseline
        durationDelta: { mean: 0, stdDev: 200 },
        hadTimingData: true,
      };

      engine.importBaseline(baseline);
      engine.startSession('baseline-zscore-test');

      // Record an item
      const item = createMockItem('lego-1', 'A');
      engine.processCompletion(item, 1000);

      // Should have reliable data because we have a baseline
      const score = engine.getLastPerformanceScore();
      expect(score?.hasReliableData).toBe(true);
    });

    it('should blend baseline with session data', () => {
      // Import a baseline
      const baseline = {
        calibrated_at: new Date(),
        calibration_items: 30,
        latency: { mean: 100, stdDev: 20 },
        durationDelta: { mean: 0, stdDev: 200 },
        hadTimingData: true,
      };

      engine.importBaseline(baseline);
      engine.startSession('blend-test');

      // Build up session data
      for (let i = 0; i < 10; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Debug values should reflect blended baseline + session
      const score = engine.getLastPerformanceScore();
      expect(score?.debug.rollingAvgLatency).toBeGreaterThan(0);
    });

    it('should fail to complete calibration if not enough items', () => {
      engine.startSession('fail-calibration-test');
      engine.updateCalibrationConfig({ minItems: 20, autoComplete: false });
      engine.startCalibration();

      // Record only 5 items
      for (let i = 0; i < 5; i++) {
        const item = createMockItem(`lego-${i}`, 'A');
        engine.processCompletion(item, 1000);
      }

      // Try to complete manually
      const result = engine.completeCalibration();
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Not enough items');
    });

    it('should update calibration config', () => {
      engine.updateCalibrationConfig({
        minItems: 15,
        maxItems: 30,
      });

      const config = engine.getCalibrationConfig();
      expect(config.minItems).toBe(15);
      expect(config.maxItems).toBe(30);
      // Unchanged values should persist
      expect(config.autoComplete).toBe(true);
    });
  });
});
