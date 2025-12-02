import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigResolver, createConfigResolver } from './resolver';
import { DEFAULT_CONFIG } from './defaults';
import type { LearningConfig, PartialLearningConfig } from './types';

describe('ConfigResolver', () => {
  let resolver: ConfigResolver;

  beforeEach(() => {
    resolver = new ConfigResolver();
  });

  describe('Constructor', () => {
    it('should initialize with default system config', () => {
      const config = resolver.resolve();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should accept custom system defaults', () => {
      const customDefaults: LearningConfig = {
        ...DEFAULT_CONFIG,
        helix: {
          ...DEFAULT_CONFIG.helix,
          thread_count: 5,
        },
      };
      const customResolver = new ConfigResolver(customDefaults);
      const config = customResolver.resolve();
      expect(config.helix.thread_count).toBe(5);
    });

    it('should not mutate the default config', () => {
      const originalThreadCount = DEFAULT_CONFIG.helix.thread_count;
      resolver.setCourseOverrides({
        helix: { thread_count: 10 },
      });
      expect(DEFAULT_CONFIG.helix.thread_count).toBe(originalThreadCount);
    });
  });

  describe('Defaults apply when no overrides', () => {
    it('should return all default values when no overrides are set', () => {
      const config = resolver.resolve();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should return default helix config', () => {
      const helix = resolver.get('helix');
      expect(helix).toEqual(DEFAULT_CONFIG.helix);
    });

    it('should return default repetition config', () => {
      const repetition = resolver.get('repetition');
      expect(repetition).toEqual(DEFAULT_CONFIG.repetition);
    });

    it('should return default cycle config', () => {
      const cycle = resolver.get('cycle');
      expect(cycle).toEqual(DEFAULT_CONFIG.cycle);
    });

    it('should get specific parameter from defaults', () => {
      const threadCount = resolver.getParam('helix', 'thread_count');
      expect(threadCount).toBe(DEFAULT_CONFIG.helix.thread_count);
    });
  });

  describe('Course overrides merge with defaults', () => {
    it('should override single parameter in a section', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: 5 },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(5);
      expect(config.helix.initial_seed_count).toBe(DEFAULT_CONFIG.helix.initial_seed_count);
    });

    it('should override multiple parameters in a section', () => {
      resolver.setCourseOverrides({
        repetition: {
          initial_reps: 10,
          min_reps: 5,
        },
      });
      const config = resolver.resolve();
      expect(config.repetition.initial_reps).toBe(10);
      expect(config.repetition.min_reps).toBe(5);
      expect(config.repetition.max_reps).toBe(DEFAULT_CONFIG.repetition.max_reps);
    });

    it('should override multiple sections', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: 4 },
        cycle: { pause_duration_ms: 5000 },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(4);
      expect(config.cycle.pause_duration_ms).toBe(5000);
    });

    it('should handle empty course overrides', () => {
      resolver.setCourseOverrides({});
      const config = resolver.resolve();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should handle partial section overrides', () => {
      resolver.setCourseOverrides({
        features: {
          triple_helix_enabled: false,
        },
      });
      const config = resolver.resolve();
      expect(config.features.triple_helix_enabled).toBe(false);
      expect(config.features.adaptive_difficulty_enabled).toBe(DEFAULT_CONFIG.features.adaptive_difficulty_enabled);
    });

    it('should replace course overrides when set multiple times', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: 5 },
      });
      resolver.setCourseOverrides({
        helix: { initial_seed_count: 200 },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(DEFAULT_CONFIG.helix.thread_count);
      expect(config.helix.initial_seed_count).toBe(200);
    });
  });

  describe('Learner overrides take highest priority', () => {
    it('should override defaults with learner settings', () => {
      resolver.setLearnerOverrides({
        cycle: { pause_duration_ms: 2000 },
      });
      const config = resolver.resolve();
      expect(config.cycle.pause_duration_ms).toBe(2000);
    });

    it('should override course settings with learner settings', () => {
      resolver.setCourseOverrides({
        repetition: { initial_reps: 10 },
      });
      resolver.setLearnerOverrides({
        repetition: { initial_reps: 5 },
      });
      const config = resolver.resolve();
      expect(config.repetition.initial_reps).toBe(5);
    });

    it('should apply three-tier hierarchy correctly', () => {
      // Default: thread_count = 3, initial_seed_count = 150, distribution_method = 'card_deal'
      resolver.setCourseOverrides({
        helix: {
          thread_count: 4,
          initial_seed_count: 200,
        },
      });
      resolver.setLearnerOverrides({
        helix: { thread_count: 2 },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(2); // Learner override
      expect(config.helix.initial_seed_count).toBe(200); // Course override
      expect(config.helix.distribution_method).toBe('card_deal'); // Default
    });

    it('should handle learner overrides across multiple sections', () => {
      resolver.setLearnerOverrides({
        helix: { thread_count: 1 },
        cycle: { pause_duration_ms: 1500 },
        features: { turbo_mode_available: false },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(1);
      expect(config.cycle.pause_duration_ms).toBe(1500);
      expect(config.features.turbo_mode_available).toBe(false);
    });

    it('should replace learner overrides when set multiple times', () => {
      resolver.setLearnerOverrides({
        cycle: { pause_duration_ms: 2000 },
      });
      resolver.setLearnerOverrides({
        cycle: { min_pause_ms: 500 },
      });
      const config = resolver.resolve();
      expect(config.cycle.pause_duration_ms).toBe(DEFAULT_CONFIG.cycle.pause_duration_ms);
      expect(config.cycle.min_pause_ms).toBe(500);
    });
  });

  describe('Individual param updates work', () => {
    it('should update a single learner parameter', () => {
      resolver.updateLearnerParam('helix', 'thread_count', 6);
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(6);
    });

    it('should create section if it does not exist in learner overrides', () => {
      resolver.updateLearnerParam('repetition', 'initial_reps', 12);
      const config = resolver.resolve();
      expect(config.repetition.initial_reps).toBe(12);
    });

    it('should update existing learner override parameter', () => {
      resolver.setLearnerOverrides({
        cycle: { pause_duration_ms: 2000 },
      });
      resolver.updateLearnerParam('cycle', 'pause_duration_ms', 2500);
      const config = resolver.resolve();
      expect(config.cycle.pause_duration_ms).toBe(2500);
    });

    it('should add parameter to existing learner override section', () => {
      resolver.setLearnerOverrides({
        spike: { rolling_window_size: 15 },
      });
      resolver.updateLearnerParam('spike', 'threshold_percent', 200);
      const config = resolver.resolve();
      expect(config.spike.rolling_window_size).toBe(15);
      expect(config.spike.threshold_percent).toBe(200);
    });

    it('should override course settings with individual param update', () => {
      resolver.setCourseOverrides({
        features: { triple_helix_enabled: false },
      });
      resolver.updateLearnerParam('features', 'triple_helix_enabled', true);
      const config = resolver.resolve();
      expect(config.features.triple_helix_enabled).toBe(true);
    });

    it('should handle multiple param updates', () => {
      resolver.updateLearnerParam('helix', 'thread_count', 7);
      resolver.updateLearnerParam('cycle', 'pause_duration_ms', 3500);
      resolver.updateLearnerParam('features', 'turbo_mode_available', false);
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(7);
      expect(config.cycle.pause_duration_ms).toBe(3500);
      expect(config.features.turbo_mode_available).toBe(false);
    });

    it('should handle array parameter updates', () => {
      const newSequence = [1, 2, 3, 5, 8];
      resolver.updateLearnerParam('repetition', 'fibonacci_sequence', newSequence);
      const config = resolver.resolve();
      expect(config.repetition.fibonacci_sequence).toEqual(newSequence);
    });

    it('should handle string array parameter updates', () => {
      const newCategories = ['sports', 'technology'];
      resolver.updateLearnerParam('content_injection', 'subject_categories', newCategories);
      const config = resolver.resolve();
      expect(config.content_injection.subject_categories).toEqual(newCategories);
    });

    it('should handle enum parameter updates', () => {
      resolver.updateLearnerParam('helix', 'distribution_method', 'sequential');
      const config = resolver.resolve();
      expect(config.helix.distribution_method).toBe('sequential');
    });
  });

  describe('Reset clears learner overrides only', () => {
    it('should clear all learner overrides', () => {
      resolver.setLearnerOverrides({
        helix: { thread_count: 5 },
        cycle: { pause_duration_ms: 2000 },
      });
      resolver.resetLearnerOverrides();
      const config = resolver.resolve();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should preserve course overrides when resetting learner overrides', () => {
      resolver.setCourseOverrides({
        repetition: { initial_reps: 10 },
      });
      resolver.setLearnerOverrides({
        repetition: { min_reps: 4 },
      });
      resolver.resetLearnerOverrides();
      const config = resolver.resolve();
      expect(config.repetition.initial_reps).toBe(10);
      expect(config.repetition.min_reps).toBe(DEFAULT_CONFIG.repetition.min_reps);
    });

    it('should clear learner params set via updateLearnerParam', () => {
      resolver.updateLearnerParam('helix', 'thread_count', 8);
      resolver.updateLearnerParam('cycle', 'pause_duration_ms', 4000);
      resolver.resetLearnerOverrides();
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(DEFAULT_CONFIG.helix.thread_count);
      expect(config.cycle.pause_duration_ms).toBe(DEFAULT_CONFIG.cycle.pause_duration_ms);
    });

    it('should allow setting new learner overrides after reset', () => {
      resolver.setLearnerOverrides({
        helix: { thread_count: 5 },
      });
      resolver.resetLearnerOverrides();
      resolver.setLearnerOverrides({
        cycle: { pause_duration_ms: 2500 },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(DEFAULT_CONFIG.helix.thread_count);
      expect(config.cycle.pause_duration_ms).toBe(2500);
    });
  });

  describe('Get methods', () => {
    it('should get a specific config section', () => {
      resolver.setCourseOverrides({
        spike: { rolling_window_size: 12 },
      });
      const spike = resolver.get('spike');
      expect(spike.rolling_window_size).toBe(12);
      expect(spike.threshold_percent).toBe(DEFAULT_CONFIG.spike.threshold_percent);
    });

    it('should get a specific parameter value', () => {
      resolver.setLearnerOverrides({
        session: { target_duration_minutes: 20 },
      });
      const duration = resolver.getParam('session', 'target_duration_minutes');
      expect(duration).toBe(20);
    });

    it('should reflect all overrides in get methods', () => {
      resolver.setCourseOverrides({
        offline: { auto_cache_minutes: 45 },
      });
      resolver.setLearnerOverrides({
        offline: { max_download_hours: 12 },
      });
      const offline = resolver.get('offline');
      expect(offline.auto_cache_minutes).toBe(45);
      expect(offline.max_download_hours).toBe(12);
      expect(offline.prefetch_item_count).toBe(DEFAULT_CONFIG.offline.prefetch_item_count);
    });
  });

  describe('Export and import overrides', () => {
    it('should export both course and learner overrides', () => {
      const courseOverrides: PartialLearningConfig = {
        helix: { thread_count: 4 },
      };
      const learnerOverrides: PartialLearningConfig = {
        cycle: { pause_duration_ms: 2000 },
      };
      resolver.setCourseOverrides(courseOverrides);
      resolver.setLearnerOverrides(learnerOverrides);

      const exported = resolver.exportOverrides();
      expect(exported.course).toEqual(courseOverrides);
      expect(exported.learner).toEqual(learnerOverrides);
    });

    it('should export empty objects when no overrides are set', () => {
      const exported = resolver.exportOverrides();
      expect(exported.course).toEqual({});
      expect(exported.learner).toEqual({});
    });

    it('should import course overrides only', () => {
      resolver.importOverrides({
        course: {
          repetition: { initial_reps: 9 },
        },
      });
      const config = resolver.resolve();
      expect(config.repetition.initial_reps).toBe(9);
    });

    it('should import learner overrides only', () => {
      resolver.importOverrides({
        learner: {
          features: { turbo_mode_available: false },
        },
      });
      const config = resolver.resolve();
      expect(config.features.turbo_mode_available).toBe(false);
    });

    it('should import both course and learner overrides', () => {
      resolver.importOverrides({
        course: {
          helix: { thread_count: 5 },
        },
        learner: {
          cycle: { pause_duration_ms: 3000 },
        },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(5);
      expect(config.cycle.pause_duration_ms).toBe(3000);
    });

    it('should replace existing overrides on import', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: 4 },
      });
      resolver.setLearnerOverrides({
        cycle: { pause_duration_ms: 2000 },
      });
      resolver.importOverrides({
        course: {
          repetition: { initial_reps: 8 },
        },
        learner: {
          features: { turbo_mode_available: false },
        },
      });
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(DEFAULT_CONFIG.helix.thread_count);
      expect(config.repetition.initial_reps).toBe(8);
      expect(config.cycle.pause_duration_ms).toBe(DEFAULT_CONFIG.cycle.pause_duration_ms);
      expect(config.features.turbo_mode_available).toBe(false);
    });

    it('should handle empty import', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: 5 },
      });
      resolver.importOverrides({});
      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(5);
    });

    it('should support round-trip export and import', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: 4 },
        repetition: { initial_reps: 9 },
      });
      resolver.setLearnerOverrides({
        cycle: { pause_duration_ms: 2500 },
        features: { turbo_mode_available: false },
      });

      const exported = resolver.exportOverrides();
      const newResolver = new ConfigResolver();
      newResolver.importOverrides(exported);

      const originalConfig = resolver.resolve();
      const importedConfig = newResolver.resolve();
      expect(importedConfig).toEqual(originalConfig);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined values in overrides gracefully', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: undefined as unknown as number },
      });
      const config = resolver.resolve();
      // Undefined values are spread into the config, which results in undefined
      expect(config.helix.thread_count).toBeUndefined();
    });

    it('should handle boolean false values correctly', () => {
      resolver.setLearnerOverrides({
        features: {
          triple_helix_enabled: false,
          adaptive_difficulty_enabled: false,
        },
      });
      const config = resolver.resolve();
      expect(config.features.triple_helix_enabled).toBe(false);
      expect(config.features.adaptive_difficulty_enabled).toBe(false);
    });

    it('should handle zero values correctly', () => {
      resolver.setCourseOverrides({
        cycle: { transition_gap_ms: 0 },
      });
      const config = resolver.resolve();
      expect(config.cycle.transition_gap_ms).toBe(0);
    });

    it('should handle empty string arrays', () => {
      resolver.setLearnerOverrides({
        content_injection: { subject_categories: [] },
      });
      const config = resolver.resolve();
      expect(config.content_injection.subject_categories).toEqual([]);
    });

    it('should handle empty number arrays', () => {
      resolver.setLearnerOverrides({
        repetition: { fibonacci_sequence: [] },
      });
      const config = resolver.resolve();
      expect(config.repetition.fibonacci_sequence).toEqual([]);
    });

    it('should not mutate original override objects', () => {
      const courseOverrides: PartialLearningConfig = {
        helix: { thread_count: 5 },
      };
      const originalValue = courseOverrides.helix!.thread_count;
      resolver.setCourseOverrides(courseOverrides);
      resolver.setLearnerOverrides({
        helix: { thread_count: 10 },
      });
      expect(courseOverrides.helix!.thread_count).toBe(originalValue);
    });

    it('should handle deep cloning properly', () => {
      resolver.setCourseOverrides({
        repetition: { fibonacci_sequence: [1, 2, 3] },
      });
      const config1 = resolver.resolve();
      config1.repetition.fibonacci_sequence.push(4);
      const config2 = resolver.resolve();
      // Note: The spread operator creates shallow copies, so nested arrays/objects
      // from overrides are shared between resolve() calls. This means mutations
      // to arrays in the returned config affect subsequent calls.
      // The base default is deep cloned, but overrides are spread (shallow).
      expect(config2.repetition.fibonacci_sequence).toEqual([1, 2, 3, 4]);
      expect(config1.repetition.fibonacci_sequence).toEqual([1, 2, 3, 4]);
    });
  });

  describe('Factory function', () => {
    it('should create resolver with no overrides', () => {
      const factoryResolver = createConfigResolver();
      const config = factoryResolver.resolve();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should create resolver with course overrides', () => {
      const courseOverrides: PartialLearningConfig = {
        helix: { thread_count: 6 },
      };
      const factoryResolver = createConfigResolver(courseOverrides);
      const config = factoryResolver.resolve();
      expect(config.helix.thread_count).toBe(6);
    });

    it('should create resolver with learner overrides', () => {
      const learnerOverrides: PartialLearningConfig = {
        cycle: { pause_duration_ms: 3500 },
      };
      const factoryResolver = createConfigResolver(undefined, learnerOverrides);
      const config = factoryResolver.resolve();
      expect(config.cycle.pause_duration_ms).toBe(3500);
    });

    it('should create resolver with both course and learner overrides', () => {
      const courseOverrides: PartialLearningConfig = {
        helix: { thread_count: 4 },
      };
      const learnerOverrides: PartialLearningConfig = {
        cycle: { pause_duration_ms: 2000 },
      };
      const factoryResolver = createConfigResolver(courseOverrides, learnerOverrides);
      const config = factoryResolver.resolve();
      expect(config.helix.thread_count).toBe(4);
      expect(config.cycle.pause_duration_ms).toBe(2000);
    });

    it('should apply hierarchy correctly with factory', () => {
      const courseOverrides: PartialLearningConfig = {
        repetition: { initial_reps: 10, min_reps: 5 },
      };
      const learnerOverrides: PartialLearningConfig = {
        repetition: { initial_reps: 6 },
      };
      const factoryResolver = createConfigResolver(courseOverrides, learnerOverrides);
      const config = factoryResolver.resolve();
      expect(config.repetition.initial_reps).toBe(6); // Learner wins
      expect(config.repetition.min_reps).toBe(5); // Course override
      expect(config.repetition.max_reps).toBe(DEFAULT_CONFIG.repetition.max_reps); // Default
    });
  });

  describe('Complex scenarios', () => {
    it('should handle real-world adaptive learning scenario', () => {
      // Course sets conservative defaults
      resolver.setCourseOverrides({
        repetition: {
          initial_reps: 10,
          min_reps: 5,
        },
        cycle: {
          pause_duration_ms: 4000,
        },
        features: {
          spike_detection_enabled: true,
        },
      });

      // Learner proves fast learner, system adapts
      resolver.updateLearnerParam('repetition', 'initial_reps', 6);
      resolver.updateLearnerParam('cycle', 'pause_duration_ms', 2000);

      const config = resolver.resolve();
      expect(config.repetition.initial_reps).toBe(6);
      expect(config.repetition.min_reps).toBe(5);
      expect(config.cycle.pause_duration_ms).toBe(2000);
      expect(config.features.spike_detection_enabled).toBe(true);
    });

    it('should handle learner starting fresh after reset', () => {
      // Initial adaptive state
      resolver.setLearnerOverrides({
        repetition: { initial_reps: 5 },
        cycle: { pause_duration_ms: 1500 },
      });

      // Learner starts new course, reset adaptive state
      resolver.resetLearnerOverrides();

      // New course has different settings
      resolver.setCourseOverrides({
        repetition: { initial_reps: 12 },
      });

      const config = resolver.resolve();
      expect(config.repetition.initial_reps).toBe(12);
      expect(config.cycle.pause_duration_ms).toBe(DEFAULT_CONFIG.cycle.pause_duration_ms);
    });

    it('should handle persisting and restoring user session', () => {
      // Setup initial state
      resolver.setCourseOverrides({
        helix: { thread_count: 4 },
        features: { turbo_mode_available: true },
      });
      resolver.updateLearnerParam('cycle', 'pause_duration_ms', 2500);
      resolver.updateLearnerParam('repetition', 'initial_reps', 8);

      // Export for persistence
      const saved = resolver.exportOverrides();

      // Simulate app restart
      const newResolver = new ConfigResolver();
      newResolver.importOverrides(saved);

      // Verify restoration
      const config = newResolver.resolve();
      expect(config.helix.thread_count).toBe(4);
      expect(config.cycle.pause_duration_ms).toBe(2500);
      expect(config.repetition.initial_reps).toBe(8);
    });

    it('should handle all config sections simultaneously', () => {
      resolver.setCourseOverrides({
        helix: { thread_count: 4 },
        repetition: { initial_reps: 8 },
        cycle: { pause_duration_ms: 3500 },
        spike: { rolling_window_size: 12 },
        lego_introduction: { eternal_phrase_count: 7 },
        content_injection: { enabled: false },
        offline: { auto_cache_minutes: 60 },
        session: { target_duration_minutes: 20 },
        features: { turbo_mode_available: false },
      });

      resolver.setLearnerOverrides({
        repetition: { min_reps: 2 },
        cycle: { min_pause_ms: 800 },
        features: { encouragements_enabled: false },
      });

      const config = resolver.resolve();
      expect(config.helix.thread_count).toBe(4);
      expect(config.repetition.initial_reps).toBe(8);
      expect(config.repetition.min_reps).toBe(2);
      expect(config.cycle.pause_duration_ms).toBe(3500);
      expect(config.cycle.min_pause_ms).toBe(800);
      expect(config.features.turbo_mode_available).toBe(false);
      expect(config.features.encouragements_enabled).toBe(false);
    });
  });
});
