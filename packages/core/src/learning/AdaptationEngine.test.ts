/**
 * Tests for AdaptationEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptationEngine, createAdaptationEngine } from './AdaptationEngine';
import type { LearningConfig } from '../config/types';
import type { LearningItem, LegoPair, SeedPair, PracticePhrase } from '../data/types';

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
});
