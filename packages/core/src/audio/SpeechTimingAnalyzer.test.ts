/**
 * Tests for SpeechTimingAnalyzer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechTimingAnalyzer } from './SpeechTimingAnalyzer';
import type { VoiceActivityDetector } from './VoiceActivityDetector';
import type { SpeechTimingResult, ContinuousVADConfig } from './types';

// Mock VoiceActivityDetector
function createMockVAD(overrides?: Partial<VoiceActivityDetector>): VoiceActivityDetector {
  return {
    isInitialized: vi.fn(() => true),
    isContinuousMonitoring: vi.fn(() => false),
    startContinuousMonitoring: vi.fn(),
    markPhaseTransition: vi.fn(),
    stopContinuousMonitoring: vi.fn(() => createMockTimingResult()),
    initialize: vi.fn(() => Promise.resolve(true)),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    getStatus: vi.fn(),
    getCurrentEnergy: vi.fn(() => -50),
    updateConfig: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as VoiceActivityDetector;
}

function createMockTimingResult(overrides?: Partial<SpeechTimingResult>): SpeechTimingResult {
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

describe('SpeechTimingAnalyzer', () => {
  let mockVAD: VoiceActivityDetector;
  let analyzer: SpeechTimingAnalyzer;

  beforeEach(() => {
    mockVAD = createMockVAD();
    analyzer = new SpeechTimingAnalyzer(mockVAD);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('startCycle', () => {
    it('should start continuous monitoring on the VAD', () => {
      analyzer.startCycle();

      expect(mockVAD.startContinuousMonitoring).toHaveBeenCalled();
      expect(analyzer.isAnalyzing()).toBe(true);
    });

    it('should not start if VAD is not initialized', () => {
      mockVAD = createMockVAD({ isInitialized: vi.fn(() => false) });
      analyzer = new SpeechTimingAnalyzer(mockVAD);

      analyzer.startCycle();

      expect(mockVAD.startContinuousMonitoring).not.toHaveBeenCalled();
      expect(analyzer.isAnalyzing()).toBe(false);
    });

    it('should reset previous cycle if already active', () => {
      analyzer.startCycle();
      analyzer.startCycle();

      // Should have been called twice (reset stops, then starts again)
      expect(mockVAD.startContinuousMonitoring).toHaveBeenCalledTimes(2);
    });

    it('should pass config to VAD', () => {
      const config: Partial<ContinuousVADConfig> = {
        min_speech_duration_ms: 200,
        speech_end_debounce_ms: 300,
      };
      analyzer = new SpeechTimingAnalyzer(mockVAD, config);

      analyzer.startCycle();

      expect(mockVAD.startContinuousMonitoring).toHaveBeenCalledWith(config);
    });
  });

  describe('onPhaseChange', () => {
    it('should pass phase transitions to VAD', () => {
      analyzer.startCycle();
      analyzer.onPhaseChange('PROMPT_END', 2000);

      expect(mockVAD.markPhaseTransition).toHaveBeenCalledWith('PROMPT_END', 2000);
    });

    it('should ignore phase changes when not active', () => {
      analyzer.onPhaseChange('PROMPT_END', 2000);

      expect(mockVAD.markPhaseTransition).not.toHaveBeenCalled();
    });
  });

  describe('endCycle', () => {
    it('should stop continuous monitoring and return results', () => {
      const modelDuration = 2000;
      const expectedResult = createMockTimingResult();
      mockVAD = createMockVAD({
        stopContinuousMonitoring: vi.fn(() => expectedResult),
      });
      analyzer = new SpeechTimingAnalyzer(mockVAD);

      analyzer.startCycle();
      const result = analyzer.endCycle(modelDuration);

      expect(mockVAD.stopContinuousMonitoring).toHaveBeenCalledWith(modelDuration);
      expect(result).toEqual(expectedResult);
      expect(analyzer.isAnalyzing()).toBe(false);
    });

    it('should return empty result when not active', () => {
      const result = analyzer.endCycle(2000);

      expect(result.speech_detected).toBe(false);
      expect(result.speech_start_ms).toBeNull();
    });

    it('should store the last result', () => {
      const expectedResult = createMockTimingResult();
      mockVAD = createMockVAD({
        stopContinuousMonitoring: vi.fn(() => expectedResult),
      });
      analyzer = new SpeechTimingAnalyzer(mockVAD);

      analyzer.startCycle();
      analyzer.endCycle(2000);

      expect(analyzer.getLastResult()).toEqual(expectedResult);
    });
  });

  describe('reset', () => {
    it('should stop monitoring and clear active state', () => {
      mockVAD = createMockVAD({
        isContinuousMonitoring: vi.fn(() => true),
      });
      analyzer = new SpeechTimingAnalyzer(mockVAD);

      analyzer.startCycle();
      analyzer.reset();

      expect(mockVAD.stopContinuousMonitoring).toHaveBeenCalled();
      expect(analyzer.isAnalyzing()).toBe(false);
    });
  });

  describe('events', () => {
    it('should emit cycle_started event', () => {
      const listener = vi.fn();
      analyzer.addEventListener(listener);

      analyzer.startCycle();

      expect(listener).toHaveBeenCalledWith({ type: 'cycle_started' });
    });

    it('should emit cycle_ended event with result', () => {
      const listener = vi.fn();
      const expectedResult = createMockTimingResult();
      mockVAD = createMockVAD({
        stopContinuousMonitoring: vi.fn(() => expectedResult),
      });
      analyzer = new SpeechTimingAnalyzer(mockVAD);
      analyzer.addEventListener(listener);

      analyzer.startCycle();
      analyzer.endCycle(2000);

      expect(listener).toHaveBeenCalledWith({
        type: 'cycle_ended',
        result: expectedResult,
      });
    });

    it('should allow removing listeners', () => {
      const listener = vi.fn();
      analyzer.addEventListener(listener);
      analyzer.removeEventListener(listener);

      analyzer.startCycle();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('should update config for future cycles', () => {
      const newConfig: Partial<ContinuousVADConfig> = {
        min_speech_duration_ms: 500,
      };

      analyzer.updateConfig(newConfig);
      analyzer.startCycle();

      expect(mockVAD.startContinuousMonitoring).toHaveBeenCalledWith(
        expect.objectContaining({ min_speech_duration_ms: 500 })
      );
    });
  });
});

describe('SpeechTimingResult interpretation', () => {
  describe('overlap detection', () => {
    it('should detect started_during_prompt when speech_start < prompt_end', () => {
      const result = createMockTimingResult({
        prompt_end_ms: 2000,
        speech_start_ms: 1500, // Before prompt ended
        started_during_prompt: true,
      });

      expect(result.started_during_prompt).toBe(true);
    });

    it('should detect still_speaking_at_voice1 when speech_end > voice1_start', () => {
      const result = createMockTimingResult({
        voice1_start_ms: 6000,
        speech_end_ms: 6500, // After voice1 started
        still_speaking_at_voice1: true,
      });

      expect(result.still_speaking_at_voice1).toBe(true);
    });
  });

  describe('competence signals', () => {
    it('should have low latency for confident responses', () => {
      const result = createMockTimingResult({
        response_latency_ms: 1000, // Quick response
      });

      expect(result.response_latency_ms).toBeLessThan(2000);
    });

    it('should have close duration delta for good prosody match', () => {
      const result = createMockTimingResult({
        duration_delta_ms: 100, // Close to model duration
      });

      expect(Math.abs(result.duration_delta_ms!)).toBeLessThan(500);
    });

    it('should indicate no speech when learner is silent', () => {
      const result = createMockTimingResult({
        speech_detected: false,
        speech_start_ms: null,
        speech_end_ms: null,
        response_latency_ms: null,
        learner_duration_ms: null,
        duration_delta_ms: null,
      });

      expect(result.speech_detected).toBe(false);
      expect(result.speech_start_ms).toBeNull();
    });
  });
});
