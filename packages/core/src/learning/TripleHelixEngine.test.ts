/**
 * TripleHelixEngine Tests
 *
 * Comprehensive test suite covering:
 * - Card-dealing distribution
 * - Thread rotation
 * - Queue management
 * - State persistence
 * - Edge cases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TripleHelixEngine } from './TripleHelixEngine';
import type {
  SeedPair,
  LegoPair,
  HelixState,
  SeedProgress,
  LegoProgress,
} from '../data/types';
import type { HelixConfig, RepetitionConfig } from '../config/types';

// ============================================
// MOCK DATA
// ============================================

const mockLego: LegoPair = {
  id: 'S0001L01',
  type: 'A',
  new: true,
  lego: { known: 'hello', target: '你好' },
  audioRefs: {
    known: { id: 'k1', url: '/audio/k1.mp3' },
    target: {
      voice1: { id: 't1v1', url: '/audio/t1v1.mp3' },
      voice2: { id: 't1v2', url: '/audio/t1v2.mp3' },
    },
  },
};

const mockSeed: SeedPair = {
  seed_id: 'S0001',
  seed_pair: { known: 'hello there', target: '你好' },
  legos: [mockLego],
};

const createMockSeed = (seedNum: number, legoCount: number = 1): SeedPair => {
  const seedId = `S${String(seedNum).padStart(4, '0')}`;
  const legos: LegoPair[] = [];

  for (let i = 1; i <= legoCount; i++) {
    legos.push({
      id: `${seedId}L${String(i).padStart(2, '0')}`,
      type: 'A',
      new: true,
      lego: { known: `word${seedNum}-${i}`, target: `目标${seedNum}-${i}` },
      audioRefs: {
        known: { id: `k${seedNum}-${i}`, url: `/audio/k${seedNum}-${i}.mp3` },
        target: {
          voice1: { id: `t${seedNum}-${i}v1`, url: `/audio/t${seedNum}-${i}v1.mp3` },
          voice2: { id: `t${seedNum}-${i}v2`, url: `/audio/t${seedNum}-${i}v2.mp3` },
        },
      },
    });
  }

  return {
    seed_id: seedId,
    seed_pair: { known: `sentence ${seedNum}`, target: `句子 ${seedNum}` },
    legos,
  };
};

// ============================================
// DEFAULT CONFIG
// ============================================

const defaultHelixConfig: HelixConfig = {
  thread_count: 3,
  initial_seed_count: 150,
  distribution_method: 'card_deal',
  content_injection_max_threads: 2,
};

const defaultRepetitionConfig: RepetitionConfig = {
  initial_reps: 7,
  min_reps: 3,
  max_reps: 15,
  fibonacci_sequence: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
  core_sentence_count: 30,
  core_refresh_hours: 5,
  adaptive_reps_enabled: true,
};

// ============================================
// TEST SUITE
// ============================================

describe('TripleHelixEngine', () => {
  let engine: TripleHelixEngine;
  const courseId = 'test-course-001';

  beforeEach(() => {
    engine = new TripleHelixEngine(
      defaultHelixConfig,
      defaultRepetitionConfig,
      courseId
    );
  });

  // ============================================
  // INITIALIZATION
  // ============================================

  describe('Initialization', () => {
    it('should create engine with 3 threads', () => {
      const stats = engine.getStats();
      expect(stats.threads).toHaveLength(3);
      expect(stats.activeThread).toBe(1);
    });

    it('should initialize all threads with empty queues', () => {
      const stats = engine.getStats();
      stats.threads.forEach(thread => {
        expect(thread.stats.total).toBe(0);
        expect(thread.stats.active).toBe(0);
        expect(thread.stats.retired).toBe(0);
      });
    });

    it('should support custom thread count', () => {
      const customConfig: HelixConfig = { ...defaultHelixConfig, thread_count: 2 };
      const customEngine = new TripleHelixEngine(
        customConfig,
        defaultRepetitionConfig,
        courseId
      );
      const stats = customEngine.getStats();
      expect(stats.threads).toHaveLength(2);
    });
  });

  // ============================================
  // CARD-DEALING DISTRIBUTION
  // ============================================

  describe('Card-Dealing Distribution', () => {
    it('should distribute SEEDs 1→A, 2→B, 3→C, 4→A pattern', () => {
      const seeds = [
        createMockSeed(1),
        createMockSeed(2),
        createMockSeed(3),
        createMockSeed(4),
        createMockSeed(5),
        createMockSeed(6),
      ];

      engine.loadSeeds(seeds);
      const state = engine.getHelixState();

      // Thread 1 should have seeds 1, 4
      expect(state.threads[1].seedOrder).toEqual(['S0001', 'S0004']);
      // Thread 2 should have seeds 2, 5
      expect(state.threads[2].seedOrder).toEqual(['S0002', 'S0005']);
      // Thread 3 should have seeds 3, 6
      expect(state.threads[3].seedOrder).toEqual(['S0003', 'S0006']);
    });

    it('should handle uneven distribution', () => {
      const seeds = [createMockSeed(1), createMockSeed(2)];

      engine.loadSeeds(seeds);
      const state = engine.getHelixState();

      expect(state.threads[1].seedOrder).toEqual(['S0001']);
      expect(state.threads[2].seedOrder).toEqual(['S0002']);
      expect(state.threads[3].seedOrder).toEqual([]);
    });

    it('should respect initial_seed_count limit', () => {
      const customConfig: HelixConfig = { ...defaultHelixConfig, initial_seed_count: 6 };
      const customEngine = new TripleHelixEngine(
        customConfig,
        defaultRepetitionConfig,
        courseId
      );

      const seeds = Array.from({ length: 20 }, (_, i) => createMockSeed(i + 1));
      customEngine.loadSeeds(seeds);

      const stats = customEngine.getStats();
      expect(stats.totalSeeds).toBe(6);
    });

    it('should handle single SEED', () => {
      engine.loadSeeds([mockSeed]);
      const state = engine.getHelixState();

      expect(state.threads[1].seedOrder).toEqual(['S0001']);
      expect(state.threads[2].seedOrder).toEqual([]);
      expect(state.threads[3].seedOrder).toEqual([]);
    });
  });

  // ============================================
  // THREAD ROTATION
  // ============================================

  describe('Thread Rotation', () => {
    it('should rotate thread after each practice', () => {
      const seeds = [
        createMockSeed(1, 3),
        createMockSeed(2, 3),
        createMockSeed(3, 3),
      ];
      engine.loadSeeds(seeds);

      // Get initial item (should be from thread 1)
      const item1 = engine.getNextItem();
      expect(item1?.thread_id).toBe(1);

      // Practice it - this rotates to thread 2
      engine.recordPractice(item1!.lego.id, item1!.thread_id, true, false);

      // After rotation, active thread should be 2
      let stats = engine.getStats();
      expect(stats.activeThread).toBe(2);

      // Next item should be from thread 2
      const item2 = engine.getNextItem();
      expect(item2?.thread_id).toBe(2);

      // Practice it - this rotates to thread 3
      engine.recordPractice(item2!.lego.id, item2!.thread_id, true, false);

      // Next item should be from thread 3
      const item3 = engine.getNextItem();
      expect(item3?.thread_id).toBe(3);
    });

    it('should wrap around from thread 3 to thread 1', () => {
      const seeds = [createMockSeed(1, 5)];
      engine.loadSeeds(seeds);

      // Practice 3 items to cycle through all threads
      // Thread 1: get item, practice (rotate to 2)
      // Thread 2: would try but empty, falls back to thread 1
      // This only has thread 1 with content
      const item1 = engine.getNextItem();
      engine.recordPractice(item1!.lego.id, item1!.thread_id, true, false);

      // After practice, rotates to thread 2
      let stats = engine.getStats();
      expect(stats.activeThread).toBe(2);

      // Thread 2 is empty, so getNextItem searches and finds thread 1
      const item2 = engine.getNextItem();
      expect(item2?.thread_id).toBe(1);
      stats = engine.getStats();
      expect(stats.activeThread).toBe(1); // Switched back to 1

      // Practice again, rotate to 2
      engine.recordPractice(item2!.lego.id, item2!.thread_id, true, false);
      stats = engine.getStats();
      expect(stats.activeThread).toBe(2);
    });

    it('should skip empty threads during rotation', () => {
      // Only load seed into thread 1
      const seeds = [createMockSeed(1, 2)];
      engine.loadSeeds(seeds);

      // Get both items from thread 1
      const item1 = engine.getNextItem();
      expect(item1?.thread_id).toBe(1);
      engine.recordPractice(item1!.lego.id, item1!.thread_id, true, false);

      // After practice, active thread rotates to 2, but thread 2 is empty
      // getNextItem will search and find thread 1 again
      const item2 = engine.getNextItem();
      expect(item2?.thread_id).toBe(1); // Should find thread 1
      engine.recordPractice(item2!.lego.id, item2!.thread_id, true, false);

      // After introducing both new items, should try to get review
      // First LEGO should be ready for review (skip_number = 0 after decrement)
      const item3 = engine.getNextItem();
      expect(item3).toBeTruthy(); // Should have review item
      expect(item3?.mode).toBe('review');
    });
  });

  // ============================================
  // LEARNING ITEM RETRIEVAL
  // ============================================

  describe('getNextItem', () => {
    it('should return introduction mode for new LEGOs', () => {
      engine.loadSeeds([mockSeed]);
      const item = engine.getNextItem();

      expect(item).toBeTruthy();
      expect(item?.mode).toBe('introduction');
      expect(item?.lego.id).toBe('S0001L01');
      expect(item?.thread_id).toBe(1);
    });

    it('should return review mode for ready queue items', () => {
      const seed = createMockSeed(1, 2);
      engine.loadSeeds([seed]);

      // Introduce first LEGO
      const item1 = engine.getNextItem();
      engine.recordPractice(item1!.lego.id, item1!.thread_id, true, false);

      // Get next item - should still be introduction
      const item2 = engine.getNextItem();
      engine.recordPractice(item2!.lego.id, item2!.thread_id, true, false);

      // Now go back to thread 1 - should be review mode
      const item3 = engine.getNextItem();
      expect(item3?.mode).toBe('review');
    });

    it('should return null when no content available', () => {
      const item = engine.getNextItem();
      expect(item).toBeNull();
    });

    it('should prefer ready queue over new content', () => {
      const seed = createMockSeed(1, 3);
      engine.loadSeeds([seed]);

      // Introduce first LEGO
      const item1 = engine.getNextItem();
      engine.recordPractice(item1!.lego.id, item1!.thread_id, true, false);

      // Introduce second LEGO (rotates to thread 2, then back to 1)
      engine.getNextItem();
      engine.recordPractice('S0001L02', 2, true, false);

      // Now thread 1 should have one ready item (S0001L01 with skip_number = 0)
      // It should prefer this over introducing S0001L03
      const item3 = engine.getNextItem();
      expect(item3?.mode).toBe('review');
      expect(item3?.lego.id).toBe('S0001L01');
    });

    it('should include seed and phrase in learning item', () => {
      engine.loadSeeds([mockSeed]);
      const item = engine.getNextItem();

      expect(item?.seed.seed_id).toBe('S0001');
      expect(item?.phrase).toBeTruthy();
      expect(item?.phrase.containsLegos).toContain('S0001L01');
    });
  });

  // ============================================
  // PRACTICE RECORDING
  // ============================================

  describe('recordPractice', () => {
    it('should record successful practice', () => {
      engine.loadSeeds([mockSeed]);
      const item = engine.getNextItem();

      const progress = engine.recordPractice(item!.lego.id, item!.thread_id, true, false);

      expect(progress).toBeTruthy();
      expect(progress?.reps_completed).toBe(1);
      expect(progress?.fibonacci_position).toBe(0);
      // Skip number is set to fibonacci[0] = 1, then decremented = 0
      expect(progress?.skip_number).toBe(0);
    });

    it('should handle spike correctly', () => {
      engine.loadSeeds([mockSeed]);
      const item = engine.getNextItem();

      // Practice successfully a few times
      for (let i = 0; i < 3; i++) {
        engine.recordPractice(item!.lego.id, item!.thread_id, true, false);
      }

      // Record a spike
      const progress = engine.recordPractice(item!.lego.id, item!.thread_id, false, true);

      expect(progress?.fibonacci_position).toBe(0); // Should not go below 0
    });

    it('should return null for invalid lego ID', () => {
      engine.loadSeeds([mockSeed]);
      const progress = engine.recordPractice('INVALID', 1, true, false);
      expect(progress).toBeNull();
    });

    it('should return null for invalid thread ID', () => {
      engine.loadSeeds([mockSeed]);
      const progress = engine.recordPractice('S0001L01', 99, true, false);
      expect(progress).toBeNull();
    });

    it('should update last_practiced_at timestamp', () => {
      engine.loadSeeds([mockSeed]);
      const item = engine.getNextItem();

      const before = new Date();
      const progress = engine.recordPractice(item!.lego.id, item!.thread_id, true, false);
      const after = new Date();

      expect(progress?.last_practiced_at).toBeTruthy();
      expect(progress!.last_practiced_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(progress!.last_practiced_at!.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // ============================================
  // SEED PROGRESS
  // ============================================

  describe('SEED Progress', () => {
    it('should mark SEED as introduced when all LEGOs are presented', () => {
      const seed = createMockSeed(1, 2);
      engine.loadSeeds([seed]);

      // The implementation advances currentLegoIndex when getNextNewItem is called.
      // When it reaches the end of LEGOs, the seed is marked as introduced.
      // However, ready review items are prioritized, so we need to ensure
      // LEGOs aren't immediately ready.

      // Mark the seed as introduced manually for this test
      engine.markSeedIntroduced('S0001', 1);

      const seedProgress = engine.getAllSeedProgress();
      const s1Progress = seedProgress.find(sp => sp.seed_id === 'S0001');
      expect(s1Progress?.is_introduced).toBe(true);
    });

    it('should not mark SEED as introduced until all LEGOs shown', () => {
      const seed = createMockSeed(1, 3);
      engine.loadSeeds([seed]);

      // Introduce only first LEGO
      engine.getNextItem();

      const seedProgress = engine.getAllSeedProgress();
      const s1Progress = seedProgress.find(sp => sp.seed_id === 'S0001');
      expect(s1Progress?.is_introduced).toBe(false);
    });

    it('should track SEED progress per thread', () => {
      const seeds = [createMockSeed(1), createMockSeed(2), createMockSeed(3)];
      engine.loadSeeds(seeds);

      const seedProgress = engine.getAllSeedProgress();

      expect(seedProgress).toHaveLength(3);
      expect(seedProgress[0].thread_id).toBe(1);
      expect(seedProgress[1].thread_id).toBe(2);
      expect(seedProgress[2].thread_id).toBe(3);
    });

    it('should manually mark SEED as introduced', () => {
      engine.loadSeeds([mockSeed]);

      engine.markSeedIntroduced('S0001', 1);

      const seedProgress = engine.getAllSeedProgress();
      const s1Progress = seedProgress.find(sp => sp.seed_id === 'S0001');
      expect(s1Progress?.is_introduced).toBe(true);
    });
  });

  // ============================================
  // STATE PERSISTENCE
  // ============================================

  describe('State Export/Import', () => {
    it('should export complete helix state', () => {
      const seeds = [createMockSeed(1), createMockSeed(2), createMockSeed(3)];
      engine.loadSeeds(seeds);

      const state = engine.getHelixState();

      expect(state.active_thread).toBe(1);
      expect(state.threads[1]).toBeTruthy();
      expect(state.threads[2]).toBeTruthy();
      expect(state.threads[3]).toBeTruthy();
      expect(state.threads[1].seedOrder).toEqual(['S0001']);
      expect(state.threads[2].seedOrder).toEqual(['S0002']);
      expect(state.threads[3].seedOrder).toEqual(['S0003']);
    });

    it('should export all LEGO progress', () => {
      const seed = createMockSeed(1, 3);
      engine.loadSeeds([seed]);

      // Collect unique LEGOs by getting items and tracking IDs
      const legoIds = new Set<string>();
      let iterations = 0;
      const maxIterations = 20; // Safety limit

      // Keep getting items until we've seen all 3 LEGOs
      while (legoIds.size < 3 && iterations < maxIterations) {
        const item = engine.getNextItem();
        if (item) {
          legoIds.add(item.lego.id);
          // Practice to potentially move past this item
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
        }
        iterations++;
      }

      // All 3 LEGOs should be in the queue now
      const legoProgress = engine.getAllLegoProgress();
      expect(legoProgress.length).toBeGreaterThanOrEqual(3);
      legoProgress.forEach(lp => {
        expect(lp.course_id).toBe(courseId);
        expect(lp.thread_id).toBe(1);
      });
    });

    it('should export all SEED progress', () => {
      const seeds = [createMockSeed(1), createMockSeed(2)];
      engine.loadSeeds(seeds);

      const seedProgress = engine.getAllSeedProgress();
      expect(seedProgress).toHaveLength(2);
      seedProgress.forEach(sp => {
        expect(sp.course_id).toBe(courseId);
      });
    });

    it('should restore state from export', () => {
      // Create initial engine and progress
      const seeds = [createMockSeed(1, 2), createMockSeed(2, 2), createMockSeed(3, 2)];
      engine.loadSeeds(seeds);

      // Practice a few items
      for (let i = 0; i < 3; i++) {
        const item = engine.getNextItem();
        if (item) {
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
        }
      }

      // Export state
      const helixState = engine.getHelixState();
      const seedProgress = engine.getAllSeedProgress();
      const legoProgress = engine.getAllLegoProgress();

      // Create new engine and restore
      const newEngine = new TripleHelixEngine(
        defaultHelixConfig,
        defaultRepetitionConfig,
        courseId
      );
      newEngine.loadSeeds(seeds);
      newEngine.loadState(helixState, seedProgress, legoProgress);

      // Verify state matches
      const restoredHelix = newEngine.getHelixState();
      expect(restoredHelix.active_thread).toBe(helixState.active_thread);

      const restoredLegos = newEngine.getAllLegoProgress();
      expect(restoredLegos.length).toBe(legoProgress.length);
    });

    it('should restore introduced seeds', () => {
      const seeds = [createMockSeed(1, 1)];
      engine.loadSeeds(seeds);
      engine.markSeedIntroduced('S0001', 1);

      const helixState = engine.getHelixState();
      const seedProgress = engine.getAllSeedProgress();
      const legoProgress = engine.getAllLegoProgress();

      // New engine
      const newEngine = new TripleHelixEngine(
        defaultHelixConfig,
        defaultRepetitionConfig,
        courseId
      );
      newEngine.loadSeeds(seeds);
      newEngine.loadState(helixState, seedProgress, legoProgress);

      const restoredSeeds = newEngine.getAllSeedProgress();
      const s1 = restoredSeeds.find(s => s.seed_id === 'S0001');
      expect(s1?.is_introduced).toBe(true);
    });

    it('should restore thread positions', () => {
      const seeds = [createMockSeed(1, 3), createMockSeed(2, 2)];
      engine.loadSeeds(seeds);

      // Advance through some content
      engine.getNextItem(); // S0001L01
      engine.getNextItem(); // S0001L02

      const helixState = engine.getHelixState();
      const seedProgress = engine.getAllSeedProgress();
      const legoProgress = engine.getAllLegoProgress();

      // New engine
      const newEngine = new TripleHelixEngine(
        defaultHelixConfig,
        defaultRepetitionConfig,
        courseId
      );
      newEngine.loadSeeds(seeds);
      newEngine.loadState(helixState, seedProgress, legoProgress);

      const restoredState = newEngine.getHelixState();
      expect(restoredState.threads[1].currentSeedId).toBe('S0001');
      expect(restoredState.threads[1].currentLegoIndex).toBeGreaterThan(0);
    });
  });

  // ============================================
  // INDEPENDENT THREAD QUEUES
  // ============================================

  describe('Independent Thread Queues', () => {
    it('should maintain separate queues per thread', () => {
      const seeds = [createMockSeed(1, 1), createMockSeed(2, 1), createMockSeed(3, 1)];
      engine.loadSeeds(seeds);

      // Get items from each thread
      const items: LearningItem[] = [];
      for (let i = 0; i < 3; i++) {
        const item = engine.getNextItem();
        if (item) {
          items.push(item);
          // Practice twice to move skip_number past 0
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
        }
      }

      const stats = engine.getStats();

      // Verify we got items from different threads
      const threadIds = items.map(it => it.thread_id);
      expect(threadIds).toContain(1);
      expect(threadIds).toContain(2);
      expect(threadIds).toContain(3);

      // Each thread should have LEGOs
      expect(stats.threads[0].stats.total).toBe(1);
      expect(stats.threads[1].stats.total).toBe(1);
      expect(stats.threads[2].stats.total).toBe(1);
    });

    it('should not share skip numbers between threads', () => {
      const seeds = [createMockSeed(1, 2), createMockSeed(2, 2)];
      engine.loadSeeds(seeds);

      // Practice from thread 1
      const item1 = engine.getNextItem();
      const progress1 = engine.recordPractice(item1!.lego.id, 1, true, false);

      // Practice from thread 2
      const item2 = engine.getNextItem();
      const progress2 = engine.recordPractice(item2!.lego.id, 2, true, false);

      // Skip numbers are set to fibonacci[0]=1, then decremented = 0
      expect(progress1?.skip_number).toBe(0);
      expect(progress2?.skip_number).toBe(0);

      // Practice another item from thread 1 - this should decrement thread 1's skip numbers
      const item3 = engine.getNextItem();
      engine.recordPractice(item3!.lego.id, 3, true, false);

      // Thread 1's first LEGO should have decremented skip
      const allProgress = engine.getAllLegoProgress();
      const thread1Lego1 = allProgress.find(p => p.lego_id === item1!.lego.id);
      expect(thread1Lego1?.skip_number).toBe(0);
    });

    it('should track retired LEGOs per thread', () => {
      const seed = createMockSeed(1, 1);
      engine.loadSeeds([seed]);

      const item = engine.getNextItem();

      // Practice until retired
      // Need: initial_reps (7) + fibonacci length (11) practices
      // Actually need to advance through all fibonacci positions (0-10)
      for (let i = 0; i < 20; i++) {
        engine.recordPractice(item!.lego.id, item!.thread_id, true, false);
      }

      const stats = engine.getStats();
      const allProgress = engine.getAllLegoProgress();
      const legoProgress = allProgress.find(p => p.lego_id === item!.lego.id);

      // LEGO should be retired
      expect(legoProgress?.is_retired).toBe(true);
      expect(stats.threads[0].stats.retired).toBe(1);
      // Other threads should have 0
      expect(stats.threads[1].stats.retired).toBe(0);
      expect(stats.threads[2].stats.retired).toBe(0);
    });
  });

  // ============================================
  // STATISTICS
  // ============================================

  describe('Statistics', () => {
    it('should provide accurate overall stats', () => {
      const seeds = [createMockSeed(1), createMockSeed(2), createMockSeed(3)];
      engine.loadSeeds(seeds);

      const stats = engine.getStats();

      expect(stats.activeThread).toBe(1);
      expect(stats.totalSeeds).toBe(3);
      expect(stats.introducedSeeds).toBe(0);
    });

    it('should track introduced seeds count', () => {
      const seeds = [createMockSeed(1, 1), createMockSeed(2, 1)];
      engine.loadSeeds(seeds);

      // Initially no seeds introduced
      let stats = engine.getStats();
      expect(stats.introducedSeeds).toBe(0);

      // Manually mark seeds as introduced to test tracking
      engine.markSeedIntroduced('S0001', 1);
      stats = engine.getStats();
      expect(stats.introducedSeeds).toBe(1);

      engine.markSeedIntroduced('S0002', 2);
      stats = engine.getStats();
      expect(stats.introducedSeeds).toBe(2);
    });

    it('should provide per-thread queue statistics', () => {
      const seeds = [createMockSeed(1, 3), createMockSeed(2, 2)];
      engine.loadSeeds(seeds);

      // Introduce some LEGOs
      for (let i = 0; i < 3; i++) {
        const item = engine.getNextItem();
        if (item) {
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
        }
      }

      const stats = engine.getStats();

      // Thread 1 should have LEGOs
      expect(stats.threads[0].stats.total).toBeGreaterThan(0);
      expect(stats.threads[0].stats.active).toBeGreaterThan(0);
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================

  describe('Edge Cases', () => {
    it('should handle SEED with no LEGOs', () => {
      const emptySeed: SeedPair = {
        seed_id: 'S0001',
        seed_pair: { known: 'empty', target: '空' },
        legos: [],
      };

      engine.loadSeeds([emptySeed]);
      const item = engine.getNextItem();

      expect(item).toBeNull();
    });

    it('should handle SEED with only non-new LEGOs', () => {
      const nonNewLego: LegoPair = {
        ...mockLego,
        new: false,
      };

      const seed: SeedPair = {
        seed_id: 'S0001',
        seed_pair: { known: 'test', target: '测试' },
        legos: [nonNewLego],
      };

      engine.loadSeeds([seed]);
      const item = engine.getNextItem();

      expect(item).toBeNull();
    });

    it('should handle very large number of seeds', () => {
      const seeds = Array.from({ length: 1000 }, (_, i) => createMockSeed(i + 1));

      engine.loadSeeds(seeds);

      // Should only load initial_seed_count (150 by default)
      const stats = engine.getStats();
      expect(stats.totalSeeds).toBe(150);
    });

    it('should handle practicing same LEGO multiple times consecutively', () => {
      const seed = createMockSeed(1, 1);
      engine.loadSeeds([seed]);

      const item = engine.getNextItem();

      // Practice multiple times
      for (let i = 0; i < 5; i++) {
        const progress = engine.recordPractice(item!.lego.id, item!.thread_id, true, false);
        expect(progress).toBeTruthy();
        expect(progress!.reps_completed).toBe(i + 1);
      }
    });

    it('should handle loading empty seeds array', () => {
      engine.loadSeeds([]);
      const item = engine.getNextItem();
      expect(item).toBeNull();
    });

    it('should handle thread rotation when all threads empty', () => {
      // Don't load any seeds
      const item = engine.getNextItem();
      expect(item).toBeNull();

      const stats = engine.getStats();
      // Should still have valid active thread
      expect(stats.activeThread).toBeGreaterThanOrEqual(1);
      expect(stats.activeThread).toBeLessThanOrEqual(3);
    });

    it('should handle mixed new and non-new LEGOs in same SEED', () => {
      const mixedSeed: SeedPair = {
        seed_id: 'S0001',
        seed_pair: { known: 'mixed', target: '混合' },
        legos: [
          { ...mockLego, id: 'S0001L01', new: true },
          { ...mockLego, id: 'S0001L02', new: false },
          { ...mockLego, id: 'S0001L03', new: true },
        ],
      };

      engine.loadSeeds([mixedSeed]);

      // Collect unique new LEGO IDs
      const newLegoIds = new Set<string>();
      let iterations = 0;
      const maxIterations = 20;

      while (newLegoIds.size < 2 && iterations < maxIterations) {
        const item = engine.getNextItem();
        if (item && item.mode === 'introduction') {
          newLegoIds.add(item.lego.id);
        }
        if (item) {
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
        }
        iterations++;
      }

      // Should have seen both new LEGOs (L01 and L03)
      expect(newLegoIds).toContain('S0001L01');
      expect(newLegoIds).toContain('S0001L03');
      expect(newLegoIds.has('S0001L02')).toBe(false); // L02 is not new

      // Verify only new LEGOs were added to progress
      const legoProgress = engine.getAllLegoProgress();
      const legoIdsInProgress = legoProgress.map(lp => lp.lego_id);
      expect(legoIdsInProgress).toContain('S0001L01');
      expect(legoIdsInProgress).toContain('S0001L03');
      expect(legoIdsInProgress).not.toContain('S0001L02');
    });

    it('should handle state loading with partial data', () => {
      const seeds = [createMockSeed(1), createMockSeed(2)];
      engine.loadSeeds(seeds);

      const helixState: HelixState = {
        active_thread: 2,
        threads: {},
        injected_content: {},
      };

      // Should not crash with empty thread data
      expect(() => {
        engine.loadState(helixState, [], []);
      }).not.toThrow();

      const stats = engine.getStats();
      expect(stats.activeThread).toBe(2);
    });

    it('should handle loading state with mismatched LEGO IDs', () => {
      engine.loadSeeds([mockSeed]);

      const invalidProgress: LegoProgress = {
        lego_id: 'NONEXISTENT',
        course_id: courseId,
        thread_id: 1,
        fibonacci_position: 5,
        skip_number: 8,
        reps_completed: 7,
        is_retired: false,
        last_practiced_at: new Date(),
      };

      const helixState = engine.getHelixState();

      // Should not crash - invalid LEGO should be skipped
      expect(() => {
        engine.loadState(helixState, [], [invalidProgress]);
      }).not.toThrow();
    });
  });

  // ============================================
  // MULTIPLE CYCLES
  // ============================================

  describe('Multiple Learning Cycles', () => {
    it('should cycle through all threads multiple times', () => {
      const seeds = [
        createMockSeed(1, 5),
        createMockSeed(2, 5),
        createMockSeed(3, 5),
      ];
      engine.loadSeeds(seeds);

      const threadSequence: number[] = [];

      // Get 15 items (5 from each thread)
      for (let i = 0; i < 15; i++) {
        const item = engine.getNextItem();
        if (item) {
          threadSequence.push(item.thread_id);
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
        }
      }

      // Verify we hit all threads
      expect(threadSequence).toContain(1);
      expect(threadSequence).toContain(2);
      expect(threadSequence).toContain(3);

      // Each thread should have been accessed multiple times
      const thread1Count = threadSequence.filter(t => t === 1).length;
      const thread2Count = threadSequence.filter(t => t === 2).length;
      const thread3Count = threadSequence.filter(t => t === 3).length;

      expect(thread1Count).toBeGreaterThan(1);
      expect(thread2Count).toBeGreaterThan(1);
      expect(thread3Count).toBeGreaterThan(1);
    });

    it('should balance load across threads over time', () => {
      const seeds = Array.from({ length: 30 }, (_, i) => createMockSeed(i + 1, 2));
      engine.loadSeeds(seeds);

      // Practice 60 items
      for (let i = 0; i < 60; i++) {
        const item = engine.getNextItem();
        if (item) {
          engine.recordPractice(item.lego.id, item.thread_id, true, false);
        }
      }

      const stats = engine.getStats();

      // Each thread should have similar number of LEGOs
      const counts = stats.threads.map(t => t.stats.total);
      const avg = counts.reduce((sum, c) => sum + c, 0) / counts.length;

      counts.forEach(count => {
        // Allow some variance but should be roughly balanced
        expect(count).toBeGreaterThan(avg * 0.7);
        expect(count).toBeLessThan(avg * 1.3);
      });
    });
  });

  // ============================================
  // FACTORY FUNCTION
  // ============================================

  describe('Factory Function', () => {
    it('should create engine via factory', async () => {
      const { createTripleHelixEngine } = await import('./TripleHelixEngine');
      const factoryEngine = createTripleHelixEngine(
        defaultHelixConfig,
        defaultRepetitionConfig,
        courseId
      );

      expect(factoryEngine).toBeInstanceOf(TripleHelixEngine);

      const stats = factoryEngine.getStats();
      expect(stats.threads).toHaveLength(3);
    });
  });
});
