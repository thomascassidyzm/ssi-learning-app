/**
 * Tests for ProgressStore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressStore, createProgressStore } from './ProgressStore';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HelixState } from '../data/types';

// Mock Supabase client with proper chaining
function createMockSupabaseClient() {
  const mockSingle = vi.fn();

  // Create a self-referencing chainable proxy
  const createChainable = (): Record<string, ReturnType<typeof vi.fn>> => {
    const obj: Record<string, ReturnType<typeof vi.fn>> = {};

    // All methods return the same object for chaining
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit'];
    methods.forEach((method) => {
      obj[method] = vi.fn(() => obj);
    });

    // single is terminal
    obj.single = mockSingle;

    return obj;
  };

  const chainable = createChainable();
  const mockFrom = vi.fn(() => chainable);
  const mockSchema = vi.fn(() => ({ from: mockFrom }));

  return {
    client: {
      schema: mockSchema,
    } as unknown as SupabaseClient,
    mocks: {
      schema: mockSchema,
      from: mockFrom,
      select: chainable.select,
      insert: chainable.insert,
      update: chainable.update,
      delete: chainable.delete,
      eq: chainable.eq,
      single: mockSingle,
    },
  };
}

describe('ProgressStore', () => {
  let store: ProgressStore;
  let mocks: ReturnType<typeof createMockSupabaseClient>['mocks'];

  beforeEach(() => {
    const { client, mocks: m } = createMockSupabaseClient();
    mocks = m;
    store = createProgressStore({ client });
  });

  describe('getLearner', () => {
    it('should get a learner by ID', async () => {
      const mockData = {
        id: 'learner-123',
        user_id: 'user-456',
        display_name: 'Test User',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        preferences: {
          session_duration_minutes: 15,
          encouragements_enabled: true,
          turbo_mode_enabled: false,
          volume: 1.0,
        },
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const result = await store.getLearner('learner-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('learner-123');
      expect(result?.display_name).toBe('Test User');
      expect(mocks.from).toHaveBeenCalledWith('learners');
    });

    it('should return null for non-existent learner', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await store.getLearner('non-existent');

      expect(result).toBeNull();
    });

    it('should throw on database error', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: { code: 'XXXX', message: 'Database error' },
      });

      await expect(store.getLearner('learner-123')).rejects.toThrow(
        'Failed to get learner: Database error'
      );
    });
  });

  describe('updateLearnerPreferences', () => {
    it('should update preferences', async () => {
      mocks.eq.mockResolvedValue({ error: null });

      await store.updateLearnerPreferences('learner-123', {
        turbo_mode_enabled: true,
      });

      expect(mocks.update).toHaveBeenCalled();
    });

    it('should throw on error', async () => {
      mocks.eq.mockResolvedValue({
        error: { message: 'Update failed' },
      });

      await expect(
        store.updateLearnerPreferences('learner-123', { volume: 0.5 })
      ).rejects.toThrow('Failed to update preferences: Update failed');
    });
  });

  describe('getEnrollment', () => {
    it('should get enrollment for learner and course', async () => {
      const mockData = {
        id: 'enroll-123',
        learner_id: 'learner-123',
        course_id: 'spanish-101',
        enrolled_at: '2024-01-01T00:00:00Z',
        last_practiced_at: '2024-01-15T00:00:00Z',
        total_practice_minutes: 120,
        helix_state: {
          active_thread: 1,
          threads: {
            1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
            2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
            3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
          },
          injected_content: {},
        },
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const result = await store.getEnrollment('learner-123', 'spanish-101');

      expect(result).not.toBeNull();
      expect(result?.course_id).toBe('spanish-101');
      expect(result?.total_practice_minutes).toBe(120);
    });

    it('should return null for non-existent enrollment', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await store.getEnrollment('learner-123', 'no-course');

      expect(result).toBeNull();
    });
  });

  describe('createEnrollment', () => {
    it('should create a new enrollment', async () => {
      const mockData = {
        id: 'enroll-new',
        learner_id: 'learner-123',
        course_id: 'french-101',
        enrolled_at: '2024-01-01T00:00:00Z',
        last_practiced_at: null,
        total_practice_minutes: 0,
        helix_state: {
          active_thread: 1,
          threads: {
            1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
            2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
            3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
          },
          injected_content: {},
        },
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const result = await store.createEnrollment('learner-123', 'french-101');

      expect(result.course_id).toBe('french-101');
      expect(result.total_practice_minutes).toBe(0);
      expect(mocks.insert).toHaveBeenCalled();
    });
  });

  describe('updateHelixState', () => {
    it('should update helix state', async () => {
      // For chained .eq().eq() calls, mock the final result with a thenable
      const chainResult = { error: null };
      mocks.eq.mockImplementation(() => ({
        eq: vi.fn().mockResolvedValue(chainResult),
      }));

      const newState: HelixState = {
        active_thread: 2,
        threads: {
          1: { seedOrder: ['S001'], currentSeedId: 'S001', currentLegoIndex: 2 },
          2: { seedOrder: ['S002'], currentSeedId: 'S002', currentLegoIndex: 0 },
          3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
        },
        injected_content: {},
      };

      await store.updateHelixState('learner-123', 'spanish-101', newState);

      expect(mocks.update).toHaveBeenCalled();
    });
  });

  describe('getLegoProgress', () => {
    it('should get all LEGO progress for course', async () => {
      const mockData = [
        {
          id: 'prog-1',
          learner_id: 'learner-123',
          lego_id: 'S001L01',
          course_id: 'spanish-101',
          thread_id: 1,
          fibonacci_position: 3,
          skip_number: 5,
          reps_completed: 4,
          is_retired: false,
          last_practiced_at: '2024-01-15T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
        },
        {
          id: 'prog-2',
          learner_id: 'learner-123',
          lego_id: 'S001L02',
          course_id: 'spanish-101',
          thread_id: 1,
          fibonacci_position: 2,
          skip_number: 3,
          reps_completed: 2,
          is_retired: false,
          last_practiced_at: '2024-01-15T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
        },
      ];

      // For chained .eq().eq() calls
      mocks.eq.mockImplementation(() => ({
        eq: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      }));

      const result = await store.getLegoProgress('learner-123', 'spanish-101');

      expect(result).toHaveLength(2);
      expect(result[0].lego_id).toBe('S001L01');
      expect(result[0].fibonacci_position).toBe(3);
    });
  });

  describe('saveLegoProgress', () => {
    it('should save new LEGO progress', async () => {
      const mockData = {
        id: 'prog-new',
        learner_id: 'learner-123',
        lego_id: 'S002L01',
        course_id: 'spanish-101',
        thread_id: 2,
        fibonacci_position: 0,
        skip_number: 0,
        reps_completed: 0,
        is_retired: false,
        last_practiced_at: null,
        created_at: '2024-01-20T00:00:00Z',
        updated_at: '2024-01-20T00:00:00Z',
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const result = await store.saveLegoProgress({
        learner_id: 'learner-123',
        lego_id: 'S002L01',
        course_id: 'spanish-101',
        thread_id: 2,
        fibonacci_position: 0,
        skip_number: 0,
        reps_completed: 0,
        is_retired: false,
        last_practiced_at: null,
      });

      expect(result.id).toBe('prog-new');
      expect(result.lego_id).toBe('S002L01');
    });
  });

  describe('updateLegoProgress', () => {
    it('should update LEGO progress fields', async () => {
      mocks.eq.mockResolvedValue({ error: null });

      await store.updateLegoProgress('prog-1', {
        fibonacci_position: 4,
        skip_number: 8,
        reps_completed: 5,
      });

      expect(mocks.update).toHaveBeenCalled();
    });
  });

  describe('bulkUpdateLegoProgress', () => {
    it('should update multiple LEGO progress records', async () => {
      mocks.eq.mockResolvedValue({ error: null });

      await store.bulkUpdateLegoProgress([
        { id: 'prog-1', updates: { fibonacci_position: 4 } },
        { id: 'prog-2', updates: { fibonacci_position: 3 } },
      ]);

      // Should call update twice
      expect(mocks.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSeedProgress', () => {
    it('should get all SEED progress for course', async () => {
      const mockData = [
        {
          id: 'seed-prog-1',
          learner_id: 'learner-123',
          seed_id: 'S001',
          course_id: 'spanish-101',
          thread_id: 1,
          is_introduced: true,
          introduced_at: '2024-01-10T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-10T00:00:00Z',
        },
      ];

      // For chained .eq().eq() calls
      mocks.eq.mockImplementation(() => ({
        eq: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      }));

      const result = await store.getSeedProgress('learner-123', 'spanish-101');

      expect(result).toHaveLength(1);
      expect(result[0].seed_id).toBe('S001');
      expect(result[0].is_introduced).toBe(true);
    });
  });

  describe('saveSeedProgress', () => {
    it('should save new SEED progress', async () => {
      const mockData = {
        id: 'seed-prog-new',
        learner_id: 'learner-123',
        seed_id: 'S002',
        course_id: 'spanish-101',
        thread_id: 1,
        is_introduced: false,
        introduced_at: null,
        created_at: '2024-01-20T00:00:00Z',
        updated_at: '2024-01-20T00:00:00Z',
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const result = await store.saveSeedProgress({
        learner_id: 'learner-123',
        seed_id: 'S002',
        course_id: 'spanish-101',
        thread_id: 1,
        is_introduced: false,
        introduced_at: null,
      });

      expect(result.id).toBe('seed-prog-new');
      expect(result.seed_id).toBe('S002');
    });
  });

  describe('updateSeedProgress', () => {
    it('should update SEED progress', async () => {
      mocks.eq.mockResolvedValue({ error: null });

      await store.updateSeedProgress('seed-prog-1', {
        is_introduced: true,
        introduced_at: new Date(),
      });

      expect(mocks.update).toHaveBeenCalled();
    });
  });

  describe('factory function', () => {
    it('should create store via factory', () => {
      const { client } = createMockSupabaseClient();
      const s = createProgressStore({ client });
      expect(s).toBeInstanceOf(ProgressStore);
    });
  });
});
