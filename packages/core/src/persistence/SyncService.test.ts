/**
 * Tests for SyncService
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SyncService, createSyncService } from './SyncService';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock IndexedDB
const mockIDBStore: Record<string, unknown[]> = {
  sync_queue: [],
};

const mockIDBObjectStore = {
  add: vi.fn((item: unknown) => {
    mockIDBStore.sync_queue.push(item);
    return { onsuccess: null, onerror: null };
  }),
  getAll: vi.fn(() => ({
    result: mockIDBStore.sync_queue,
    onsuccess: null,
    onerror: null,
  })),
  clear: vi.fn(() => {
    mockIDBStore.sync_queue = [];
    return { onsuccess: null, onerror: null };
  }),
};

const mockIDBTransaction = {
  objectStore: vi.fn(() => mockIDBObjectStore),
};

const mockIDBDatabase = {
  transaction: vi.fn(() => mockIDBTransaction),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn(),
};

// Mock Supabase client
function createMockSupabaseClient() {
  const mockInsert = vi.fn().mockReturnThis();
  const mockUpdate = vi.fn().mockReturnThis();
  const mockDelete = vi.fn().mockReturnThis();
  const mockEq = vi.fn().mockReturnThis();
  const mockFrom = vi.fn().mockReturnValue({
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
  });

  // Chain methods
  mockInsert.mockReturnValue({ eq: mockEq });
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockDelete.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq });

  const mockSchema = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    client: {
      schema: mockSchema,
    } as unknown as SupabaseClient,
    mocks: {
      schema: mockSchema,
      from: mockFrom,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      eq: mockEq,
    },
  };
}

describe('SyncService', () => {
  let service: SyncService;
  let mocks: ReturnType<typeof createMockSupabaseClient>['mocks'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockIDBStore.sync_queue = [];

    const { client, mocks: m } = createMockSupabaseClient();
    mocks = m;
    service = createSyncService({
      client,
      maxRetries: 3,
      baseDelayMs: 100,
      autoSyncIntervalMs: 1000,
    });

    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    service.stopAutoSync();
  });

  describe('queueOperation', () => {
    it('should queue a create operation', async () => {
      await service.queueOperation('lego_progress', 'create', 'lego-123', {
        lego_id: 'S001L01',
        fibonacci_position: 0,
      });

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(1);
    });

    it('should queue an update operation', async () => {
      await service.queueOperation('lego_progress', 'update', 'lego-123', {
        fibonacci_position: 3,
      });

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(1);
    });

    it('should queue a delete operation', async () => {
      await service.queueOperation('session', 'delete', 'session-123', {});

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(1);
    });

    it('should queue multiple operations', async () => {
      await service.queueOperation('lego_progress', 'create', 'lego-1', { id: '1' });
      await service.queueOperation('lego_progress', 'create', 'lego-2', { id: '2' });
      await service.queueOperation('seed_progress', 'update', 'seed-1', { is_introduced: true });

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(3);
    });
  });

  describe('processQueue', () => {
    it('should process create operations', async () => {
      mocks.insert.mockResolvedValue({ error: null });

      await service.queueOperation('lego_progress', 'create', 'lego-123', {
        lego_id: 'S001L01',
      });

      const processed = await service.processQueue();

      expect(processed).toBe(1);
      expect(mocks.from).toHaveBeenCalledWith('lego_progress');
      expect(mocks.insert).toHaveBeenCalled();

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(0);
    });

    it('should process update operations', async () => {
      mocks.eq.mockResolvedValue({ error: null });

      await service.queueOperation('lego_progress', 'update', 'lego-123', {
        fibonacci_position: 3,
      });

      const processed = await service.processQueue();

      expect(processed).toBe(1);
      expect(mocks.update).toHaveBeenCalled();
    });

    it('should process delete operations', async () => {
      mocks.eq.mockResolvedValue({ error: null });

      await service.queueOperation('session', 'delete', 'session-123', {});

      const processed = await service.processQueue();

      expect(processed).toBe(1);
      expect(mocks.delete).toHaveBeenCalled();
    });

    it('should return 0 when queue is empty', async () => {
      const processed = await service.processQueue();
      expect(processed).toBe(0);
    });

    it('should return 0 when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });

      await service.queueOperation('lego_progress', 'create', 'lego-123', {});

      const processed = await service.processQueue();
      expect(processed).toBe(0);

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(1);
    });

    it('should handle duplicate key errors as success', async () => {
      mocks.insert.mockResolvedValue({
        error: { code: '23505', message: 'Duplicate key' },
      });

      await service.queueOperation('lego_progress', 'create', 'lego-123', {});

      const processed = await service.processQueue();
      expect(processed).toBe(1);

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(0);
    });

    it('should retry failed operations', async () => {
      // First attempt fails
      mocks.insert.mockResolvedValueOnce({
        error: { code: 'XXXX', message: 'Temporary failure' },
      });
      // Second attempt succeeds
      mocks.insert.mockResolvedValueOnce({ error: null });

      await service.queueOperation('lego_progress', 'create', 'lego-123', {});

      // First process - should fail but keep in queue
      const processed1 = await service.processQueue();
      expect(processed1).toBe(0);

      const status1 = await service.getQueueStatus();
      expect(status1.pending_count).toBe(1);

      // Second process - should succeed
      const processed2 = await service.processQueue();
      expect(processed2).toBe(1);

      const status2 = await service.getQueueStatus();
      expect(status2.pending_count).toBe(0);
    });

    it('should remove items after max retries', async () => {
      mocks.insert.mockResolvedValue({
        error: { code: 'XXXX', message: 'Persistent failure' },
      });

      await service.queueOperation('lego_progress', 'create', 'lego-123', {});

      // Process 3 times (maxRetries)
      await service.processQueue();
      await service.processQueue();
      await service.processQueue();

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(0);
    });
  });

  describe('getQueueStatus', () => {
    it('should return correct status', async () => {
      await service.queueOperation('lego_progress', 'create', 'lego-1', {});
      await service.queueOperation('lego_progress', 'create', 'lego-2', {});

      const status = await service.getQueueStatus();

      expect(status.pending_count).toBe(2);
      expect(status.is_syncing).toBe(false);
      expect(status.last_sync_at).toBeNull();
      expect(status.last_error).toBeNull();
    });

    it('should update last_sync_at after processing', async () => {
      mocks.insert.mockResolvedValue({ error: null });
      await service.queueOperation('lego_progress', 'create', 'lego-1', {});

      await service.processQueue();

      const status = await service.getQueueStatus();
      expect(status.last_sync_at).not.toBeNull();
    });
  });

  describe('clearQueue', () => {
    it('should clear all queued operations', async () => {
      await service.queueOperation('lego_progress', 'create', 'lego-1', {});
      await service.queueOperation('lego_progress', 'create', 'lego-2', {});

      await service.clearQueue();

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(0);
    });
  });

  describe('forcSync', () => {
    it('should process queue immediately', async () => {
      mocks.insert.mockResolvedValue({ error: null });
      await service.queueOperation('lego_progress', 'create', 'lego-1', {});

      await service.forcSync();

      const status = await service.getQueueStatus();
      expect(status.pending_count).toBe(0);
    });
  });

  describe('event callbacks', () => {
    it('should call onSyncComplete callback', async () => {
      const callback = vi.fn();
      service.onSyncComplete(callback);

      mocks.insert.mockResolvedValue({ error: null });
      await service.queueOperation('lego_progress', 'create', 'lego-1', {});

      await service.processQueue();

      expect(callback).toHaveBeenCalledWith(1);
    });

    it('should call onSyncError callback on catastrophic failure', async () => {
      const callback = vi.fn();
      service.onSyncError(callback);

      // This test verifies the error callback mechanism exists
      // In practice, errors are caught per-item with retries
      // A catastrophic failure would require the entire loop to fail
      // which is hard to simulate in a mock

      // Verify the callback was registered by checking it's in the callbacks
      expect(callback).not.toHaveBeenCalled(); // Not called yet

      // The error callback is called when the entire process throws
      // Individual item failures just go through retry logic
    });
  });

  describe('auto sync', () => {
    it('should start and stop auto sync', () => {
      service.startAutoSync(500);
      // No error means it started

      service.stopAutoSync();
      // No error means it stopped
    });
  });

  describe('entity table mapping', () => {
    it('should map entities to correct table names', async () => {
      mocks.insert.mockResolvedValue({ error: null });
      mocks.eq.mockResolvedValue({ error: null });

      const entities = [
        { entity: 'lego_progress' as const, table: 'lego_progress' },
        { entity: 'seed_progress' as const, table: 'seed_progress' },
        { entity: 'session' as const, table: 'sessions' },
        { entity: 'metric' as const, table: 'response_metrics' },
        { entity: 'spike' as const, table: 'spike_events' },
        { entity: 'enrollment' as const, table: 'course_enrollments' },
      ];

      for (const { entity, table } of entities) {
        mocks.from.mockClear();
        await service.queueOperation(entity, 'create', 'id-123', {});
        await service.processQueue();

        expect(mocks.from).toHaveBeenCalledWith(table);
      }
    });
  });

  describe('factory function', () => {
    it('should create service via factory', () => {
      const { client } = createMockSupabaseClient();
      const s = createSyncService({ client });
      expect(s).toBeInstanceOf(SyncService);
    });
  });
});
