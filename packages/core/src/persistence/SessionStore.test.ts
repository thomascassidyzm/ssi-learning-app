/**
 * Tests for SessionStore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore, createSessionStore } from './SessionStore';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionMetrics, ResponseMetric, SpikeEvent } from '../learning/types';

// Mock Supabase client
function createMockSupabaseClient() {
  const mockSelect = vi.fn().mockReturnThis();
  const mockInsert = vi.fn().mockReturnThis();
  const mockUpdate = vi.fn().mockReturnThis();
  const mockEq = vi.fn().mockReturnThis();
  const mockOrder = vi.fn().mockReturnThis();
  const mockLimit = vi.fn().mockReturnThis();
  const mockSingle = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    eq: mockEq,
    order: mockOrder,
    limit: mockLimit,
    single: mockSingle,
  });

  // Chain methods properly
  mockSelect.mockReturnValue({ eq: mockEq, order: mockOrder, single: mockSingle });
  mockInsert.mockReturnValue({ select: mockSelect, single: mockSingle, eq: mockEq });
  mockUpdate.mockReturnValue({ eq: mockEq, select: mockSelect });
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect, order: mockOrder });
  mockOrder.mockReturnValue({ limit: mockLimit });

  const mockSchema = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    client: {
      schema: mockSchema,
    } as unknown as SupabaseClient,
    mocks: {
      schema: mockSchema,
      from: mockFrom,
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq,
      order: mockOrder,
      limit: mockLimit,
      single: mockSingle,
    },
  };
}

describe('SessionStore', () => {
  let store: SessionStore;
  let mocks: ReturnType<typeof createMockSupabaseClient>['mocks'];

  beforeEach(() => {
    const { client, mocks: m } = createMockSupabaseClient();
    mocks = m;
    store = createSessionStore({ client });
  });

  describe('startSession', () => {
    it('should create a new session', async () => {
      const mockData = {
        id: 'session-123',
        learner_id: 'learner-123',
        course_id: 'spanish-101',
        started_at: '2024-01-15T10:00:00Z',
        ended_at: null,
        duration_seconds: 0,
        items_practiced: 0,
        spikes_detected: 0,
        final_rolling_average: 0,
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const result = await store.startSession('learner-123', 'spanish-101');

      expect(result.id).toBe('session-123');
      expect(result.ended_at).toBeNull();
      expect(result.items_practiced).toBe(0);
      expect(mocks.insert).toHaveBeenCalled();
    });

    it('should throw on error', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      });

      await expect(
        store.startSession('learner-123', 'spanish-101')
      ).rejects.toThrow('Failed to start session: Insert failed');
    });
  });

  describe('endSession', () => {
    it('should update session with final metrics', async () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const endTime = new Date('2024-01-15T10:15:00Z');

      const mockData = {
        id: 'session-123',
        learner_id: 'learner-123',
        course_id: 'spanish-101',
        started_at: startTime.toISOString(),
        ended_at: endTime.toISOString(),
        duration_seconds: 900, // 15 minutes
        items_practiced: 50,
        spikes_detected: 3,
        final_rolling_average: 85.5,
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const metrics: SessionMetrics = {
        session_id: 'session-123',
        started_at: startTime,
        ended_at: endTime,
        items_practiced: 50,
        spikes_detected: 3,
        final_rolling_average: 85.5,
        metrics: [],
        spikes: [],
      };

      const result = await store.endSession('session-123', metrics);

      expect(result.ended_at).not.toBeNull();
      expect(result.duration_seconds).toBe(900);
      expect(result.items_practiced).toBe(50);
      expect(mocks.update).toHaveBeenCalled();
    });
  });

  describe('getSession', () => {
    it('should get session by ID', async () => {
      const mockData = {
        id: 'session-123',
        learner_id: 'learner-123',
        course_id: 'spanish-101',
        started_at: '2024-01-15T10:00:00Z',
        ended_at: '2024-01-15T10:15:00Z',
        duration_seconds: 900,
        items_practiced: 50,
        spikes_detected: 3,
        final_rolling_average: 85.5,
      };

      mocks.single.mockResolvedValue({ data: mockData, error: null });

      const result = await store.getSession('session-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('session-123');
    });

    it('should return null for non-existent session', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await store.getSession('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getRecentSessions', () => {
    it('should get recent sessions for learner', async () => {
      const mockData = [
        {
          id: 'session-3',
          learner_id: 'learner-123',
          course_id: 'spanish-101',
          started_at: '2024-01-17T10:00:00Z',
          ended_at: '2024-01-17T10:15:00Z',
          duration_seconds: 900,
          items_practiced: 55,
          spikes_detected: 2,
          final_rolling_average: 80.0,
        },
        {
          id: 'session-2',
          learner_id: 'learner-123',
          course_id: 'spanish-101',
          started_at: '2024-01-16T10:00:00Z',
          ended_at: '2024-01-16T10:15:00Z',
          duration_seconds: 900,
          items_practiced: 48,
          spikes_detected: 4,
          final_rolling_average: 90.0,
        },
      ];

      mocks.limit.mockResolvedValue({ data: mockData, error: null });

      const result = await store.getRecentSessions('learner-123', 5);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session-3'); // Most recent first
    });
  });

  describe('saveMetrics', () => {
    it('should save metrics for a session', async () => {
      // Mock getSession
      const sessionData = {
        id: 'session-123',
        learner_id: 'learner-123',
        course_id: 'spanish-101',
        started_at: '2024-01-15T10:00:00Z',
        ended_at: null,
        duration_seconds: 0,
        items_practiced: 0,
        spikes_detected: 0,
        final_rolling_average: 0,
      };

      // First call is getSession, second is insert
      mocks.single.mockResolvedValueOnce({ data: sessionData, error: null });
      mocks.insert.mockResolvedValue({ error: null });

      const metrics: ResponseMetric[] = [
        {
          id: 'metric-1',
          lego_id: 'S001L01',
          timestamp: new Date('2024-01-15T10:01:00Z'),
          response_latency_ms: 1200,
          phrase_length: 15,
          normalized_latency: 80,
          thread_id: 1,
          triggered_spike: false,
          mode: 'practice',
        },
        {
          id: 'metric-2',
          lego_id: 'S001L02',
          timestamp: new Date('2024-01-15T10:02:00Z'),
          response_latency_ms: 1500,
          phrase_length: 12,
          normalized_latency: 125,
          thread_id: 1,
          triggered_spike: true,
          mode: 'practice',
        },
      ];

      await store.saveMetrics('session-123', metrics);

      expect(mocks.insert).toHaveBeenCalled();
    });

    it('should skip empty metrics array', async () => {
      await store.saveMetrics('session-123', []);

      expect(mocks.from).not.toHaveBeenCalled();
    });

    it('should throw if session not found', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const metrics: ResponseMetric[] = [
        {
          id: 'metric-1',
          lego_id: 'S001L01',
          timestamp: new Date(),
          response_latency_ms: 1200,
          phrase_length: 15,
          normalized_latency: 80,
          thread_id: 1,
          triggered_spike: false,
          mode: 'practice',
        },
      ];

      await expect(store.saveMetrics('non-existent', metrics)).rejects.toThrow(
        'Session not found: non-existent'
      );
    });
  });

  describe('saveSpikes', () => {
    it('should save spike events for a session', async () => {
      const sessionData = {
        id: 'session-123',
        learner_id: 'learner-123',
        course_id: 'spanish-101',
        started_at: '2024-01-15T10:00:00Z',
        ended_at: null,
        duration_seconds: 0,
        items_practiced: 0,
        spikes_detected: 0,
        final_rolling_average: 0,
      };

      mocks.single.mockResolvedValueOnce({ data: sessionData, error: null });
      mocks.insert.mockResolvedValue({ error: null });

      const spikes: SpikeEvent[] = [
        {
          id: 'spike-1',
          lego_id: 'S001L02',
          timestamp: new Date('2024-01-15T10:02:00Z'),
          latency: 125,
          rolling_average: 80,
          spike_ratio: 1.56,
          response: 'repeat',
          thread_id: 1,
        },
      ];

      await store.saveSpikes('session-123', spikes);

      expect(mocks.insert).toHaveBeenCalled();
    });

    it('should skip empty spikes array', async () => {
      await store.saveSpikes('session-123', []);

      expect(mocks.from).not.toHaveBeenCalled();
    });
  });

  describe('getSessionMetrics', () => {
    it('should get metrics for a session', async () => {
      const mockData = [
        {
          db_id: 'dbid-1',
          id: 'metric-1',
          session_id: 'session-123',
          learner_id: 'learner-123',
          course_id: 'spanish-101',
          lego_id: 'S001L01',
          timestamp: '2024-01-15T10:01:00Z',
          response_latency_ms: 1200,
          phrase_length: 15,
          normalized_latency: 80,
          thread_id: 1,
          triggered_spike: false,
          mode: 'practice',
        },
      ];

      mocks.order.mockResolvedValue({ data: mockData, error: null });

      const result = await store.getSessionMetrics('session-123');

      expect(result).toHaveLength(1);
      expect(result[0].lego_id).toBe('S001L01');
    });
  });

  describe('getSessionSpikes', () => {
    it('should get spikes for a session', async () => {
      const mockData = [
        {
          db_id: 'dbid-1',
          id: 'spike-1',
          session_id: 'session-123',
          learner_id: 'learner-123',
          course_id: 'spanish-101',
          lego_id: 'S001L02',
          timestamp: '2024-01-15T10:02:00Z',
          latency: 125,
          rolling_average: 80,
          spike_ratio: 1.56,
          response: 'repeat',
          thread_id: 1,
        },
      ];

      mocks.order.mockResolvedValue({ data: mockData, error: null });

      const result = await store.getSessionSpikes('session-123');

      expect(result).toHaveLength(1);
      expect(result[0].response).toBe('repeat');
    });
  });

  describe('factory function', () => {
    it('should create store via factory', () => {
      const { client } = createMockSupabaseClient();
      const s = createSessionStore({ client });
      expect(s).toBeInstanceOf(SessionStore);
    });
  });
});
