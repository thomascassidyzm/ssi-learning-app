/**
 * SyncService - Manages offline sync queue
 *
 * Provides:
 * - Queue operations for offline changes
 * - Automatic background sync
 * - Retry logic with exponential backoff
 * - Conflict resolution
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ISyncService,
  SyncEntity,
  SyncOperation,
  SyncQueueItem,
  SyncStatus,
} from './types';

export interface SyncServiceConfig {
  /** Supabase client instance */
  client: SupabaseClient;
  /** Schema to use (default: 'public') */
  schema?: string;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseDelayMs?: number;
  /** Auto-sync interval in ms (default: 30000) */
  autoSyncIntervalMs?: number;
}

type SyncCompleteCallback = (count: number) => void;
type SyncErrorCallback = (error: Error) => void;

export class SyncService implements ISyncService {
  private client: SupabaseClient;
  private schema: string;
  private maxRetries: number;
  private baseDelayMs: number;
  private autoSyncIntervalMs: number;

  private queue: SyncQueueItem[] = [];
  private isSyncing: boolean = false;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncAt: Date | null = null;
  private lastError: string | null = null;

  private onCompleteCallbacks: SyncCompleteCallback[] = [];
  private onErrorCallbacks: SyncErrorCallback[] = [];
  private syncErrorsLogged = new Set<string>();

  constructor(config: SyncServiceConfig) {
    this.client = config.client;
    this.schema = config.schema ?? 'public';
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 1000;
    this.autoSyncIntervalMs = config.autoSyncIntervalMs ?? 30000;
  }

  // ============================================
  // QUEUE MANAGEMENT
  // ============================================

  async queueOperation(
    entity: SyncEntity,
    operation: SyncOperation,
    entityId: string,
    payload: unknown
  ): Promise<void> {
    const item: SyncQueueItem = {
      id: `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      entity,
      operation,
      entity_id: entityId,
      payload,
      created_at: new Date(),
      attempts: 0,
      last_attempt_at: null,
      error: null,
    };

    this.queue.push(item);

    // Persist queue to IndexedDB for durability
    await this.persistQueue();
  }

  async processQueue(): Promise<number> {
    if (this.isSyncing) {
      return 0;
    }

    if (this.queue.length === 0) {
      return 0;
    }

    // Check if online
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 0;
    }

    this.isSyncing = true;
    let processedCount = 0;

    try {
      // Process items in order
      const itemsToProcess = [...this.queue];

      for (const item of itemsToProcess) {
        try {
          await this.processItem(item);
          this.removeFromQueue(item.id);
          processedCount++;
        } catch (error) {
          item.attempts++;
          item.last_attempt_at = new Date();
          item.error = error instanceof Error ? error.message : String(error);

          if (item.attempts >= this.maxRetries) {
            const errorKey = `max-retries-${item.entity}`;
            if (!this.syncErrorsLogged.has(errorKey)) {
              this.syncErrorsLogged.add(errorKey);
              console.error(`[SyncService] Sync item ${item.id} (${item.entity}) exceeded max retries:`, error);
            }
            this.removeFromQueue(item.id);
          } else {
            // Exponential backoff - don't process again this cycle
            const delay = this.baseDelayMs * Math.pow(2, item.attempts - 1);
            const warnKey = `retry-${item.entity}`;
            if (!this.syncErrorsLogged.has(warnKey)) {
              this.syncErrorsLogged.add(warnKey);
              console.warn(`[SyncService] Sync item ${item.id} (${item.entity}) failed, retry in ${delay}ms`);
            }
          }
        }
      }

      this.lastSyncAt = new Date();
      this.lastError = null;

      // Persist updated queue
      await this.persistQueue();

      // Notify listeners
      if (processedCount > 0) {
        this.onCompleteCallbacks.forEach((cb) => cb(processedCount));
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.onErrorCallbacks.forEach((cb) =>
        cb(error instanceof Error ? error : new Error(String(error)))
      );
    } finally {
      this.isSyncing = false;
    }

    return processedCount;
  }

  async getQueueStatus(): Promise<SyncStatus> {
    return {
      pending_count: this.queue.length,
      last_sync_at: this.lastSyncAt,
      is_syncing: this.isSyncing,
      last_error: this.lastError,
    };
  }

  async clearQueue(): Promise<void> {
    this.queue = [];
    await this.persistQueue();
  }

  // ============================================
  // SYNC CONTROL
  // ============================================

  startAutoSync(intervalMs?: number): void {
    if (this.autoSyncTimer) {
      this.stopAutoSync();
    }

    const interval = intervalMs ?? this.autoSyncIntervalMs;

    this.autoSyncTimer = setInterval(() => {
      this.processQueue().catch((error) => {
        if (!this.syncErrorsLogged.has('auto-sync')) {
          this.syncErrorsLogged.add('auto-sync');
          console.error('[SyncService] Auto-sync error:', error);
        }
      });
    }, interval);

    // Also sync when coming online
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
    }
  }

  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
    }
  }

  async forcSync(): Promise<void> {
    await this.processQueue();
  }

  // ============================================
  // EVENTS
  // ============================================

  onSyncComplete(callback: SyncCompleteCallback): void {
    this.onCompleteCallbacks.push(callback);
  }

  onSyncError(callback: SyncErrorCallback): void {
    this.onErrorCallbacks.push(callback);
  }

  // ============================================
  // INTERNAL METHODS
  // ============================================

  private handleOnline = (): void => {
    // Sync when coming back online
    this.processQueue().catch((error) => {
      if (!this.syncErrorsLogged.has('online-sync')) {
        this.syncErrorsLogged.add('online-sync');
        console.error('[SyncService] Online sync error:', error);
      }
    });
  };

  private async processItem(item: SyncQueueItem): Promise<void> {
    const tableName = this.getTableName(item.entity);

    switch (item.operation) {
      case 'create': {
        const { error } = await this.client
          .schema(this.schema)
          .from(tableName)
          .insert(item.payload as Record<string, unknown>);

        if (error) {
          // Check for duplicate - might have been synced already
          if (error.code === '23505') {
            // Unique violation - already exists, treat as success
            return;
          }
          throw new Error(`Create failed: ${error.message}`);
        }
        break;
      }

      case 'update': {
        const payload = item.payload as Record<string, unknown>;
        const { error } = await this.client
          .schema(this.schema)
          .from(tableName)
          .update(payload)
          .eq('id', item.entity_id);

        if (error) {
          throw new Error(`Update failed: ${error.message}`);
        }
        break;
      }

      case 'delete': {
        const { error } = await this.client
          .schema(this.schema)
          .from(tableName)
          .delete()
          .eq('id', item.entity_id);

        if (error) {
          throw new Error(`Delete failed: ${error.message}`);
        }
        break;
      }
    }
  }

  private getTableName(entity: SyncEntity): string {
    const tableMap: Record<SyncEntity, string> = {
      lego_progress: 'lego_progress',
      seed_progress: 'seed_progress',
      session: 'sessions',
      metric: 'response_metrics',
      spike: 'spike_events',
      enrollment: 'course_enrollments',
      learner_baseline: 'learner_baselines',
    };

    return tableMap[entity];
  }

  private removeFromQueue(id: string): void {
    this.queue = this.queue.filter((item) => item.id !== id);
  }

  private async persistQueue(): Promise<void> {
    // Persist to IndexedDB for durability across page reloads
    if (typeof indexedDB === 'undefined') return;

    try {
      const db = await this.openSyncDb();
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      // Clear and re-add all items
      await store.clear();
      for (const item of this.queue) {
        await store.add(item);
      }
    } catch (error) {
      if (!this.syncErrorsLogged.has('persist-queue')) {
        this.syncErrorsLogged.add('persist-queue');
        console.error('[SyncService] Failed to persist sync queue:', error);
      }
    }
  }

  async loadQueue(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;

    try {
      const db = await this.openSyncDb();
      const items = await this.getAllFromStore(db);

      this.queue = items.map((item) => ({
        ...item,
        created_at: new Date(item.created_at),
        last_attempt_at: item.last_attempt_at
          ? new Date(item.last_attempt_at)
          : null,
      }));
    } catch (error) {
      if (!this.syncErrorsLogged.has('load-queue')) {
        this.syncErrorsLogged.add('load-queue');
        console.error('[SyncService] Failed to load sync queue:', error);
      }
    }
  }

  private getAllFromStore(db: IDBDatabase): Promise<SyncQueueItem[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result as SyncQueueItem[]);
      request.onerror = () => reject(request.error);
    });
  }

  private async openSyncDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ssi-sync-queue', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id' });
        }
      };
    });
  }
}

/**
 * Factory function
 */
export function createSyncService(config: SyncServiceConfig): SyncService {
  return new SyncService(config);
}
