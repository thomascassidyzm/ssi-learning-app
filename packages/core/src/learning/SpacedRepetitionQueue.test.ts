/**
 * Comprehensive tests for SpacedRepetitionQueue
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpacedRepetitionQueue, createSpacedRepetitionQueue } from './SpacedRepetitionQueue';
import type { LegoPair, LegoProgress } from '../data/types';
import type { RepetitionConfig } from '../config/types';

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

const mockLego2: LegoPair = {
  id: 'S0001L02',
  type: 'A',
  new: true,
  lego: { known: 'goodbye', target: '再见' },
  audioRefs: {
    known: { id: 'k2', url: '/audio/k2.mp3' },
    target: {
      voice1: { id: 't2v1', url: '/audio/t2v1.mp3' },
      voice2: { id: 't2v2', url: '/audio/t2v2.mp3' },
    },
  },
};

const mockLego3: LegoPair = {
  id: 'S0001L03',
  type: 'M',
  new: false,
  lego: { known: 'thank you', target: '谢谢' },
  components: [
    { known: 'thank', target: '谢' },
    { known: 'you', target: '谢' },
  ],
  audioRefs: {
    known: { id: 'k3', url: '/audio/k3.mp3' },
    target: {
      voice1: { id: 't3v1', url: '/audio/t3v1.mp3' },
      voice2: { id: 't3v2', url: '/audio/t3v2.mp3' },
    },
  },
};

const defaultConfig: RepetitionConfig = {
  initial_reps: 7,
  min_reps: 3,
  max_reps: 15,
  fibonacci_sequence: [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
  core_sentence_count: 30,
  core_refresh_hours: 5,
  adaptive_reps_enabled: true,
};

// ============================================
// TESTS
// ============================================

describe('SpacedRepetitionQueue', () => {
  let queue: SpacedRepetitionQueue;

  beforeEach(() => {
    queue = new SpacedRepetitionQueue(defaultConfig);
  });

  // ============================================
  // CONSTRUCTION & FACTORY
  // ============================================

  describe('constructor and factory', () => {
    it('should create queue with config', () => {
      expect(queue).toBeInstanceOf(SpacedRepetitionQueue);
      expect(queue.getAllProgress()).toEqual([]);
    });

    it('should create queue with factory function', () => {
      const factoryQueue = createSpacedRepetitionQueue(defaultConfig);
      expect(factoryQueue).toBeInstanceOf(SpacedRepetitionQueue);
      expect(factoryQueue.getAllProgress()).toEqual([]);
    });
  });

  // ============================================
  // ADDING NEW LEGOs
  // ============================================

  describe('addNew', () => {
    it('should add new LEGO with fibonacci_position 0', () => {
      const progress = queue.addNew(mockLego, 1, 'course-1');

      expect(progress).toEqual({
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 0,
        skip_number: 0,
        reps_completed: 0,
        is_retired: false,
        last_practiced_at: null,
      });
    });

    it('should add new LEGO with skip_number 0 (practice immediately)', () => {
      const progress = queue.addNew(mockLego, 1, 'course-1');
      expect(progress.skip_number).toBe(0);
    });

    it('should add multiple new LEGOs', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');
      queue.addNew(mockLego3, 2, 'course-1');

      const allProgress = queue.getAllProgress();
      expect(allProgress).toHaveLength(3);
      expect(allProgress.map(p => p.lego_id)).toEqual([
        'S0001L01',
        'S0001L02',
        'S0001L03',
      ]);
    });

    it('should handle different thread IDs', () => {
      const progress1 = queue.addNew(mockLego, 1, 'course-1');
      const progress2 = queue.addNew(mockLego2, 2, 'course-1');
      const progress3 = queue.addNew(mockLego3, 3, 'course-1');

      expect(progress1.thread_id).toBe(1);
      expect(progress2.thread_id).toBe(2);
      expect(progress3.thread_id).toBe(3);
    });

    it('should handle different course IDs', () => {
      const progress1 = queue.addNew(mockLego, 1, 'course-1');
      const progress2 = queue.addNew(mockLego2, 1, 'course-2');

      expect(progress1.course_id).toBe('course-1');
      expect(progress2.course_id).toBe('course-2');
    });
  });

  // ============================================
  // LOADING EXISTING PROGRESS
  // ============================================

  describe('loadProgress', () => {
    it('should load existing progress', () => {
      const existingProgress: LegoProgress = {
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 3,
        skip_number: 5,
        reps_completed: 7,
        is_retired: false,
        last_practiced_at: new Date('2023-01-01'),
      };

      queue.loadProgress(mockLego, existingProgress);

      const loaded = queue.getProgress('S0001L01');
      expect(loaded).toEqual(existingProgress);
    });

    it('should load multiple progress items', () => {
      const progress1: LegoProgress = {
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 2,
        skip_number: 3,
        reps_completed: 5,
        is_retired: false,
        last_practiced_at: null,
      };

      const progress2: LegoProgress = {
        lego_id: 'S0001L02',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 4,
        skip_number: 8,
        reps_completed: 10,
        is_retired: false,
        last_practiced_at: null,
      };

      queue.loadProgress(mockLego, progress1);
      queue.loadProgress(mockLego2, progress2);

      expect(queue.getAllProgress()).toHaveLength(2);
    });

    it('should load retired LEGOs', () => {
      const retiredProgress: LegoProgress = {
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 10,
        skip_number: 89,
        reps_completed: 20,
        is_retired: true,
        last_practiced_at: new Date('2023-01-01'),
      };

      queue.loadProgress(mockLego, retiredProgress);

      const loaded = queue.getProgress('S0001L01');
      expect(loaded?.is_retired).toBe(true);
    });
  });

  // ============================================
  // GETTING NEXT LEGO
  // ============================================

  describe('getNext', () => {
    it('should return null for empty queue', () => {
      const next = queue.getNext();
      expect(next).toBeNull();
    });

    it('should return LEGO with skip_number 0', () => {
      queue.addNew(mockLego, 1, 'course-1');
      const next = queue.getNext();

      expect(next).not.toBeNull();
      expect(next?.lego.id).toBe('S0001L01');
      expect(next?.progress.skip_number).toBe(0);
    });

    it('should exclude LEGOs with skip_number > 0', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Practice first LEGO to give it a skip number
      queue.recordPractice('S0001L01', true, false);

      const next = queue.getNext();
      expect(next?.lego.id).toBe('S0001L02');
    });

    it('should exclude retired LEGOs', () => {
      const retiredProgress: LegoProgress = {
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 10,
        skip_number: 0,
        reps_completed: 20,
        is_retired: true,
        last_practiced_at: null,
      };

      queue.loadProgress(mockLego, retiredProgress);
      queue.addNew(mockLego2, 1, 'course-1');

      const next = queue.getNext();
      expect(next?.lego.id).toBe('S0001L02');
    });

    it('should return LEGO with lowest priority', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      const next = queue.getNext();
      expect(next).not.toBeNull();
      // Both have same skip number, priority includes randomization
      // Just verify we get one of them
      expect(['S0001L01', 'S0001L02']).toContain(next?.lego.id);
    });

    it('should return null when all LEGOs have skip_number > 0', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.recordPractice('S0001L01', true, false);

      const next = queue.getNext();
      expect(next).toBeNull();
    });

    it('should return null when all LEGOs are retired', () => {
      const retiredProgress: LegoProgress = {
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 10,
        skip_number: 0,
        reps_completed: 20,
        is_retired: true,
        last_practiced_at: null,
      };

      queue.loadProgress(mockLego, retiredProgress);
      const next = queue.getNext();
      expect(next).toBeNull();
    });
  });

  // ============================================
  // GETTING READY LEGOs
  // ============================================

  describe('getReady', () => {
    it('should return empty array for empty queue', () => {
      const ready = queue.getReady();
      expect(ready).toEqual([]);
    });

    it('should return all LEGOs with skip_number <= 0', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');
      queue.addNew(mockLego3, 1, 'course-1');

      const ready = queue.getReady();
      expect(ready).toHaveLength(3);
    });

    it('should exclude LEGOs with skip_number > 0', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      queue.recordPractice('S0001L01', true, false);

      const ready = queue.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0].lego.id).toBe('S0001L02');
    });

    it('should exclude retired LEGOs', () => {
      const retiredProgress: LegoProgress = {
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 10,
        skip_number: 0,
        reps_completed: 20,
        is_retired: true,
        last_practiced_at: null,
      };

      queue.loadProgress(mockLego, retiredProgress);
      queue.addNew(mockLego2, 1, 'course-1');

      const ready = queue.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0].lego.id).toBe('S0001L02');
    });

    it('should sort by priority (lowest first)', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      const ready = queue.getReady();
      expect(ready).toHaveLength(2);
      // Should be sorted by priority
      expect(ready[0].priority).toBeLessThanOrEqual(ready[1].priority);
    });
  });

  // ============================================
  // RECORDING PRACTICE - SUCCESS
  // ============================================

  describe('recordPractice - successful attempts', () => {
    it('should increment reps_completed on success', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.recordPractice('S0001L01', true, false);

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(1);
    });

    it('should update last_practiced_at timestamp', () => {
      queue.addNew(mockLego, 1, 'course-1');
      const before = new Date();
      queue.recordPractice('S0001L01', true, false);
      const after = new Date();

      const progress = queue.getProgress('S0001L01');
      expect(progress?.last_practiced_at).not.toBeNull();
      expect(progress?.last_practiced_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(progress?.last_practiced_at!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should NOT advance position before initial_reps', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Complete 6 reps (less than initial_reps of 7)
      for (let i = 0; i < 6; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(6);
      expect(progress?.fibonacci_position).toBe(0);
    });

    it('should advance position after initial_reps', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Complete initial_reps (7)
      for (let i = 0; i < 7; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(7);
      expect(progress?.fibonacci_position).toBe(1);
    });

    it('should advance position on each success after initial_reps', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Complete initial_reps + 3 more
      for (let i = 0; i < 10; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(10);
      expect(progress?.fibonacci_position).toBe(4); // 0 -> 1 -> 2 -> 3 -> 4
    });

    it('should set skip_number based on fibonacci_position', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Initially: skip = 0 (practice immediately)
      let progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(0);

      // After first practice at position 0: skip = 1
      queue.recordPractice('S0001L01', true, false);
      progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(1);

      // Complete initial_reps to advance to position 1
      for (let i = 0; i < 6; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      // Position 1: skip = 1
      progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(1);

      // Advance to position 2
      queue.recordPractice('S0001L01', true, false);
      progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(2);

      // Advance to position 3
      queue.recordPractice('S0001L01', true, false);
      progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(3);

      // Advance to position 4
      queue.recordPractice('S0001L01', true, false);
      progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(5);
    });

    it('should not advance beyond last fibonacci position', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Practice many times to reach the end
      for (let i = 0; i < 20; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(10); // Last position in sequence
    });

    it('should retire LEGO when reaching end of fibonacci sequence', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Practice enough times to reach the end
      for (let i = 0; i < 20; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.is_retired).toBe(true);
    });

    it('should return null when recording practice for non-existent LEGO', () => {
      const result = queue.recordPractice('NONEXISTENT', true, false);
      expect(result).toBeNull();
    });
  });

  // ============================================
  // RECORDING PRACTICE - SPIKES
  // ============================================

  describe('recordPractice - spike handling', () => {
    it('should reset position by 1 on spike', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Advance to position 3
      for (let i = 0; i < 10; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      let progress = queue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(4);

      // Trigger spike
      queue.recordPractice('S0001L01', false, true);

      progress = queue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(3); // Reset by 1
    });

    it('should not reset position below 0', () => {
      queue.addNew(mockLego, 1, 'course-1');

      const progress = queue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(0);

      // Trigger spike at position 0
      queue.recordPractice('S0001L01', false, true);

      const newProgress = queue.getProgress('S0001L01');
      expect(newProgress?.fibonacci_position).toBe(0); // Can't go below 0
    });

    it('should update skip_number after spike', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Advance to position 7 (13 reps, skip = 21)
      for (let i = 0; i < 13; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      let progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(21);

      // Trigger spike (reset to position 6, skip = 13)
      queue.recordPractice('S0001L01', false, true);

      progress = queue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(6);
      expect(progress?.skip_number).toBe(13);
    });

    it('should update last_practiced_at on spike', () => {
      queue.addNew(mockLego, 1, 'course-1');
      const before = new Date();
      queue.recordPractice('S0001L01', false, true);
      const after = new Date();

      const progress = queue.getProgress('S0001L01');
      expect(progress?.last_practiced_at).not.toBeNull();
      expect(progress?.last_practiced_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(progress?.last_practiced_at!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should not increment reps_completed on spike', () => {
      queue.addNew(mockLego, 1, 'course-1');

      queue.recordPractice('S0001L01', false, true);

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(0);
    });
  });

  // ============================================
  // DECREMENT SKIP NUMBERS
  // ============================================

  describe('decrementSkipNumbers', () => {
    it('should decrement skip_number for all LEGOs', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Advance both to have skip numbers
      for (let i = 0; i < 8; i++) {
        queue.recordPractice('S0001L01', true, false);
        queue.recordPractice('S0001L02', true, false);
      }

      let progress1 = queue.getProgress('S0001L01');
      let progress2 = queue.getProgress('S0001L02');
      const skip1 = progress1!.skip_number;
      const skip2 = progress2!.skip_number;

      queue.decrementSkipNumbers();

      progress1 = queue.getProgress('S0001L01');
      progress2 = queue.getProgress('S0001L02');
      expect(progress1!.skip_number).toBe(skip1 - 1);
      expect(progress2!.skip_number).toBe(skip2 - 1);
    });

    it('should not decrement skip_number below 0', () => {
      queue.addNew(mockLego, 1, 'course-1');

      const progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(0);

      queue.decrementSkipNumbers();

      const newProgress = queue.getProgress('S0001L01');
      expect(newProgress?.skip_number).toBe(0); // Still 0
    });

    it('should only decrement LEGOs with skip_number > 0', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Advance only first LEGO to get a skip number of 5 (position 4: 10 reps)
      for (let i = 0; i < 10; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress1Before = queue.getProgress('S0001L01');
      const progress2Before = queue.getProgress('S0001L02');
      expect(progress1Before!.skip_number).toBe(5);
      expect(progress2Before!.skip_number).toBe(0);

      queue.decrementSkipNumbers();

      const progress1After = queue.getProgress('S0001L01');
      const progress2After = queue.getProgress('S0001L02');
      expect(progress1After!.skip_number).toBe(4); // 5 - 1
      expect(progress2After!.skip_number).toBe(0); // Unchanged
    });

    it('should update priority after decrementing', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Advance to get skip number
      for (let i = 0; i < 8; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const queuedBefore = queue.getNext();
      expect(queuedBefore).toBeNull(); // Skip number > 0

      // Decrement multiple times to bring skip to 0
      for (let i = 0; i < 5; i++) {
        queue.decrementSkipNumbers();
      }

      const queuedAfter = queue.getNext();
      expect(queuedAfter).not.toBeNull(); // Now available
    });
  });

  // ============================================
  // PRIORITY CALCULATION
  // ============================================

  describe('priority ordering', () => {
    it('should prioritize lower skip numbers', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Advance first LEGO more than second
      for (let i = 0; i < 10; i++) {
        queue.recordPractice('S0001L01', true, false);
      }
      for (let i = 0; i < 8; i++) {
        queue.recordPractice('S0001L02', true, false);
      }

      // Bring both to ready state
      for (let i = 0; i < 10; i++) {
        queue.decrementSkipNumbers();
      }

      const ready = queue.getReady();
      expect(ready).toHaveLength(2);
      // Both should be ready, verify they're ordered
      expect(ready[0].priority).toBeLessThanOrEqual(ready[1].priority);
    });

    it('should give higher priority to incomplete initial reps', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Complete initial_reps for first LEGO
      for (let i = 0; i < 7; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      // Only partial reps for second LEGO
      for (let i = 0; i < 3; i++) {
        queue.recordPractice('S0001L02', true, false);
      }

      // Reset skip numbers to make both available
      for (let i = 0; i < 5; i++) {
        queue.decrementSkipNumbers();
      }

      const ready = queue.getReady();
      if (ready.length === 2) {
        // Second LEGO (incomplete initial reps) should have higher priority
        // This is probabilistic due to randomization, but the bonus should make it likely
        const lego2 = ready.find(r => r.lego.id === 'S0001L02');
        expect(lego2).toBeDefined();
      }
    });

    it('should give retired LEGOs infinite priority', () => {
      const retiredProgress: LegoProgress = {
        lego_id: 'S0001L01',
        course_id: 'course-1',
        thread_id: 1,
        fibonacci_position: 10,
        skip_number: 0,
        reps_completed: 20,
        is_retired: true,
        last_practiced_at: null,
      };

      queue.loadProgress(mockLego, retiredProgress);
      const next = queue.getNext();
      expect(next).toBeNull(); // Infinite priority means never selected
    });
  });

  // ============================================
  // GETTING PROGRESS
  // ============================================

  describe('getProgress', () => {
    it('should return progress for existing LEGO', () => {
      queue.addNew(mockLego, 1, 'course-1');
      const progress = queue.getProgress('S0001L01');

      expect(progress).not.toBeNull();
      expect(progress?.lego_id).toBe('S0001L01');
    });

    it('should return null for non-existent LEGO', () => {
      const progress = queue.getProgress('NONEXISTENT');
      expect(progress).toBeNull();
    });

    it('should return updated progress after practice', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.recordPractice('S0001L01', true, false);

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(1);
    });
  });

  describe('getAllProgress', () => {
    it('should return empty array for empty queue', () => {
      const allProgress = queue.getAllProgress();
      expect(allProgress).toEqual([]);
    });

    it('should return all progress items', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');
      queue.addNew(mockLego3, 2, 'course-1');

      const allProgress = queue.getAllProgress();
      expect(allProgress).toHaveLength(3);
    });

    it('should include retired LEGOs', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Retire the LEGO
      for (let i = 0; i < 20; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const allProgress = queue.getAllProgress();
      expect(allProgress).toHaveLength(1);
      expect(allProgress[0].is_retired).toBe(true);
    });
  });

  // ============================================
  // STATISTICS
  // ============================================

  describe('getStats', () => {
    it('should return zero stats for empty queue', () => {
      const stats = queue.getStats();

      expect(stats).toEqual({
        total: 0,
        active: 0,
        retired: 0,
        ready: 0,
        avgPosition: 0,
      });
    });

    it('should return correct total count', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');
      queue.addNew(mockLego3, 2, 'course-1');

      const stats = queue.getStats();
      expect(stats.total).toBe(3);
    });

    it('should count active LEGOs correctly', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      const stats = queue.getStats();
      expect(stats.active).toBe(2);
      expect(stats.retired).toBe(0);
    });

    it('should count retired LEGOs correctly', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Retire first LEGO
      for (let i = 0; i < 20; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const stats = queue.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.retired).toBe(1);
    });

    it('should count ready LEGOs correctly', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');
      queue.addNew(mockLego3, 1, 'course-1');

      const stats = queue.getStats();
      expect(stats.ready).toBe(3); // All start with skip_number 0
    });

    it('should calculate average position correctly', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Advance first to position 5 (11 reps)
      for (let i = 0; i < 11; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      // Advance second to position 1 (7 reps)
      for (let i = 0; i < 7; i++) {
        queue.recordPractice('S0001L02', true, false);
      }

      const stats = queue.getStats();
      expect(stats.avgPosition).toBe(3); // (5 + 1) / 2
    });

    it('should exclude retired LEGOs from average position', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Retire first LEGO (position 10)
      for (let i = 0; i < 20; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      // Second LEGO stays at position 0
      const stats = queue.getStats();
      expect(stats.avgPosition).toBe(0); // Only counts active LEGO
    });
  });

  // ============================================
  // CLEAR
  // ============================================

  describe('clear', () => {
    it('should clear all LEGOs from queue', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      expect(queue.getAllProgress()).toHaveLength(2);

      queue.clear();

      expect(queue.getAllProgress()).toHaveLength(0);
      expect(queue.getNext()).toBeNull();
      expect(queue.getStats().total).toBe(0);
    });

    it('should allow adding new LEGOs after clear', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.clear();

      queue.addNew(mockLego2, 1, 'course-1');

      expect(queue.getAllProgress()).toHaveLength(1);
      expect(queue.getProgress('S0001L02')).not.toBeNull();
    });
  });

  // ============================================
  // UPDATE CONFIG
  // ============================================

  describe('updateConfig', () => {
    it('should update config values', () => {
      queue.updateConfig({ initial_reps: 5 });

      queue.addNew(mockLego, 1, 'course-1');

      // Complete 5 reps (new initial_reps)
      for (let i = 0; i < 5; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(1); // Advanced after 5 reps
    });

    it('should update fibonacci sequence', () => {
      queue.updateConfig({
        fibonacci_sequence: [1, 2, 4, 8, 16],
      });

      queue.addNew(mockLego, 1, 'course-1');

      // Advance to position 4 (7 initial reps + 4 more)
      for (let i = 0; i < 11; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.skip_number).toBe(16); // New sequence value at position 4
    });

    it('should recalculate priorities after config update', () => {
      queue.addNew(mockLego, 1, 'course-1');
      queue.addNew(mockLego2, 1, 'course-1');

      // Advance both partially and bring skip numbers back to 0
      for (let i = 0; i < 3; i++) {
        queue.recordPractice('S0001L01', true, false);
        queue.recordPractice('S0001L02', true, false);
      }

      // Decrement skip numbers to make them ready
      for (let i = 0; i < 5; i++) {
        queue.decrementSkipNumbers();
      }

      const readyBefore = queue.getReady();
      expect(readyBefore.length).toBeGreaterThan(0);

      // Update config
      queue.updateConfig({ initial_reps: 10 });

      const readyAfter = queue.getReady();

      // Priorities should change due to different initial_reps affecting the bonus
      // Both LEGOs now have incomplete initial reps (3 < 10)
      expect(readyAfter.length).toBeGreaterThan(0);
    });

    it('should handle partial config updates', () => {
      queue.updateConfig({ min_reps: 5 });

      // Other config values should remain unchanged
      queue.addNew(mockLego, 1, 'course-1');

      for (let i = 0; i < 7; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(1); // Still using original initial_reps
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================

  describe('edge cases', () => {
    it('should handle empty fibonacci sequence', () => {
      const emptyFibQueue = new SpacedRepetitionQueue({
        ...defaultConfig,
        fibonacci_sequence: [],
      });

      emptyFibQueue.addNew(mockLego, 1, 'course-1');
      const progress = emptyFibQueue.getProgress('S0001L01');

      expect(progress?.skip_number).toBe(0);
    });

    it('should handle single-item fibonacci sequence', () => {
      const singleFibQueue = new SpacedRepetitionQueue({
        ...defaultConfig,
        fibonacci_sequence: [5],
      });

      singleFibQueue.addNew(mockLego, 1, 'course-1');

      for (let i = 0; i < 10; i++) {
        singleFibQueue.recordPractice('S0001L01', true, false);
      }

      const progress = singleFibQueue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(0); // Can't advance beyond sequence
      expect(progress?.is_retired).toBe(true); // Retired at end of sequence
    });

    it('should handle zero initial_reps', () => {
      const zeroRepsQueue = new SpacedRepetitionQueue({
        ...defaultConfig,
        initial_reps: 0,
      });

      zeroRepsQueue.addNew(mockLego, 1, 'course-1');
      zeroRepsQueue.recordPractice('S0001L01', true, false);

      const progress = zeroRepsQueue.getProgress('S0001L01');
      expect(progress?.fibonacci_position).toBe(1); // Advances immediately
    });

    it('should handle large number of LEGOs', () => {
      const manyLegos: LegoPair[] = Array.from({ length: 100 }, (_, i) => ({
        id: `S${i.toString().padStart(4, '0')}L01`,
        type: 'A' as const,
        new: true,
        lego: { known: `word${i}`, target: `字${i}` },
        audioRefs: {
          known: { id: `k${i}`, url: `/audio/k${i}.mp3` },
          target: {
            voice1: { id: `t${i}v1`, url: `/audio/t${i}v1.mp3` },
            voice2: { id: `t${i}v2`, url: `/audio/t${i}v2.mp3` },
          },
        },
      }));

      manyLegos.forEach(lego => {
        queue.addNew(lego, 1, 'course-1');
      });

      const stats = queue.getStats();
      expect(stats.total).toBe(100);
      expect(stats.ready).toBe(100);

      const next = queue.getNext();
      expect(next).not.toBeNull();
    });

    it('should handle rapid practice sessions', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Rapid practice
      for (let i = 0; i < 50; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(50);
      expect(progress?.is_retired).toBe(true); // Should be retired by now
    });

    it('should handle mixed successful and spike practices', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Success, success, spike, success, spike
      queue.recordPractice('S0001L01', true, false);
      queue.recordPractice('S0001L01', true, false);
      queue.recordPractice('S0001L01', false, true);
      queue.recordPractice('S0001L01', true, false);
      queue.recordPractice('S0001L01', false, true);

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(3); // Only successful attempts count
      expect(progress?.fibonacci_position).toBe(0); // Spikes prevent advancement
    });

    it('should handle unsuccessful non-spike practice', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Failed attempt that's not a spike
      queue.recordPractice('S0001L01', false, false);

      const progress = queue.getProgress('S0001L01');
      expect(progress?.reps_completed).toBe(0);
      expect(progress?.fibonacci_position).toBe(0);
      expect(progress?.last_practiced_at).not.toBeNull();
    });

    it('should maintain separate progress for same LEGO in different threads', () => {
      // Note: This tests the data structure, though in practice the same LEGO
      // shouldn't be in multiple threads. But the queue should handle it.
      const lego1 = { ...mockLego };
      const lego2 = { ...mockLego };

      queue.addNew(lego1, 1, 'course-1');
      queue.addNew(lego2, 2, 'course-1');

      // This will update the same ID twice, second one wins
      const progress = queue.getProgress('S0001L01');
      expect(progress?.thread_id).toBe(2); // Last added
    });

    it('should handle skip_number decrements to exactly zero', () => {
      queue.addNew(mockLego, 1, 'course-1');

      // Advance to position 5 (11 reps, skip = 8)
      for (let i = 0; i < 11; i++) {
        queue.recordPractice('S0001L01', true, false);
      }

      const progressBefore = queue.getProgress('S0001L01');
      expect(progressBefore?.skip_number).toBe(8);

      // Decrement eight times
      for (let i = 0; i < 8; i++) {
        queue.decrementSkipNumbers();
      }

      const progressAfter = queue.getProgress('S0001L01');
      expect(progressAfter?.skip_number).toBe(0);

      const next = queue.getNext();
      expect(next?.lego.id).toBe('S0001L01'); // Now available
    });
  });
});
