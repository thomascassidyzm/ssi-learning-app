/**
 * OfflineCache - IndexedDB-based caching for offline support
 *
 * Stores:
 * - Audio files (as blobs)
 * - Course manifests
 * - Learner progress (for offline sync)
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { AudioRef, CourseManifest, LegoProgress, SeedProgress, HelixState } from '../data/types';
import type {
  IOfflineCache,
  CacheStats,
  CachedAudio,
  CachedManifest,
  CachedProgress,
} from './types';

const DB_NAME = 'ssi-offline-cache';
const DB_VERSION = 1;

interface SSiCacheDB {
  audio: {
    key: string;
    value: CachedAudio;
    indexes: { 'by-course': string; 'by-cached-at': Date };
  };
  manifests: {
    key: string;
    value: CachedManifest;
  };
  progress: {
    key: string;
    value: CachedProgress;
    indexes: { 'by-learner': string };
  };
}

export class OfflineCache implements IOfflineCache {
  private db: IDBPDatabase<SSiCacheDB> | null = null;
  private audioCache: Set<string> = new Set(); // In-memory index for quick lookups
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Initialize lazily
  }

  /**
   * Initialize the database
   */
  private async init(): Promise<void> {
    if (this.db) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.doInit();
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.db = await openDB<SSiCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Audio store
        if (!db.objectStoreNames.contains('audio')) {
          const audioStore = db.createObjectStore('audio', { keyPath: 'id' });
          audioStore.createIndex('by-course', 'courseId');
          audioStore.createIndex('by-cached-at', 'cachedAt');
        }

        // Manifests store
        if (!db.objectStoreNames.contains('manifests')) {
          db.createObjectStore('manifests', { keyPath: 'courseId' });
        }

        // Progress store
        if (!db.objectStoreNames.contains('progress')) {
          const progressStore = db.createObjectStore('progress', { keyPath: 'id' });
          progressStore.createIndex('by-learner', 'learnerId');
        }
      },
    });

    // Build in-memory index of cached audio IDs
    const audioKeys = await this.db.getAllKeys('audio');
    this.audioCache = new Set(audioKeys.map(key => String(key)));
  }

  // ============================================
  // AUDIO CACHING
  // ============================================

  async cacheAudio(audioRef: AudioRef, courseId: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Skip if already cached
    if (this.audioCache.has(audioRef.id)) return;

    try {
      // Fetch the audio file
      const response = await fetch(audioRef.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }

      const blob = await response.blob();

      const cachedAudio: CachedAudio = {
        id: audioRef.id,
        url: audioRef.url,
        blob,
        mimeType: blob.type || 'audio/mpeg',
        size: blob.size,
        cachedAt: new Date(),
        courseId,
      };

      await this.db.put('audio', cachedAudio);
      this.audioCache.add(audioRef.id);
    } catch (error) {
      console.error(`Failed to cache audio ${audioRef.id}:`, error);
      throw error;
    }
  }

  async getCachedAudio(audioId: string): Promise<Blob | null> {
    await this.init();
    if (!this.db) return null;

    const cached = await this.db.get('audio', audioId);
    return cached?.blob ?? null;
  }

  isAudioCached(audioId: string): boolean {
    return this.audioCache.has(audioId);
  }

  // ============================================
  // MANIFEST CACHING
  // ============================================

  async cacheManifest(manifest: CourseManifest): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const cached: CachedManifest = {
      courseId: manifest.course_id,
      manifest,
      version: manifest.version,
      cachedAt: new Date(),
    };

    await this.db.put('manifests', cached);
  }

  async getCachedManifest(courseId: string): Promise<CourseManifest | null> {
    await this.init();
    if (!this.db) return null;

    const cached = await this.db.get('manifests', courseId);
    return cached?.manifest ?? null;
  }

  // ============================================
  // PROGRESS CACHING
  // ============================================

  async cacheProgress(
    learnerId: string,
    courseId: string,
    helixState: HelixState,
    legoProgress: LegoProgress[],
    seedProgress: SeedProgress[]
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const cached: CachedProgress = {
      id: `${learnerId}:${courseId}`,
      learnerId,
      courseId,
      helixState,
      legoProgress,
      seedProgress,
      updatedAt: new Date(),
    };

    await this.db.put('progress', cached);
  }

  async getCachedProgress(
    learnerId: string,
    courseId: string
  ): Promise<{
    helixState: HelixState;
    legoProgress: LegoProgress[];
    seedProgress: SeedProgress[];
  } | null> {
    await this.init();
    if (!this.db) return null;

    const cached = await this.db.get('progress', `${learnerId}:${courseId}`);
    if (!cached) return null;

    return {
      helixState: cached.helixState,
      legoProgress: cached.legoProgress,
      seedProgress: cached.seedProgress,
    };
  }

  /**
   * Get all progress records for a learner (used for migration)
   */
  async getProgressByLearner(learnerId: string): Promise<CachedProgress[]> {
    await this.init();
    if (!this.db) return [];

    const index = this.db.transaction('progress', 'readonly')
      .objectStore('progress')
      .index('by-learner');

    const results: CachedProgress[] = [];
    let cursor = await index.openCursor(learnerId);

    while (cursor) {
      results.push(cursor.value);
      cursor = await cursor.continue();
    }

    return results;
  }

  /**
   * Delete all progress records for a learner (used after migration)
   */
  async deleteProgressByLearner(learnerId: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    const tx = this.db.transaction('progress', 'readwrite');
    const store = tx.objectStore('progress');
    const index = store.index('by-learner');

    let cursor = await index.openCursor(learnerId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.done;
  }

  // ============================================
  // PREFETCHING
  // ============================================

  async prefetchForDuration(courseId: string, minutes: number): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Get the manifest
    const manifest = await this.getCachedManifest(courseId);
    if (!manifest) {
      throw new Error(`No manifest cached for course ${courseId}`);
    }

    // Estimate items needed (roughly 1 item per 30 seconds)
    const itemsNeeded = Math.ceil((minutes * 60) / 30);

    // Collect audio refs from seeds
    const audioRefs: AudioRef[] = [];
    let collected = 0;

    for (const seed of manifest.seeds) {
      if (collected >= itemsNeeded * 3) break; // 3 audio files per item (known + 2 target voices)

      for (const lego of seed.legos) {
        audioRefs.push(lego.audioRefs.known);
        audioRefs.push(lego.audioRefs.target.voice1);
        audioRefs.push(lego.audioRefs.target.voice2);
        collected += 3;

        if (collected >= itemsNeeded * 3) break;
      }
    }

    // Cache all uncached audio
    const uncached = audioRefs.filter(ref => !this.isAudioCached(ref.id));
    await Promise.all(uncached.map(ref => this.cacheAudio(ref, courseId)));
  }

  // ============================================
  // STATISTICS
  // ============================================

  async getCacheStats(courseId?: string): Promise<CacheStats> {
    await this.init();
    if (!this.db) {
      return { audioCount: 0, totalBytes: 0, estimatedMinutes: 0, lastUpdated: null };
    }

    let audioCount = 0;
    let totalBytes = 0;
    let lastUpdated: Date | null = null;

    const tx = this.db.transaction('audio', 'readonly');
    const store = tx.objectStore('audio');

    let cursor = await store.openCursor();
    while (cursor) {
      const audio = cursor.value;

      if (!courseId || audio.courseId === courseId) {
        audioCount++;
        totalBytes += audio.size;

        if (!lastUpdated || audio.cachedAt > lastUpdated) {
          lastUpdated = audio.cachedAt;
        }
      }

      cursor = await cursor.continue();
    }

    // Estimate minutes: ~100KB per audio file, 3 files per item, 30 sec per item
    const estimatedItems = audioCount / 3;
    const estimatedMinutes = (estimatedItems * 30) / 60;

    return {
      audioCount,
      totalBytes,
      estimatedMinutes: Math.round(estimatedMinutes),
      lastUpdated,
    };
  }

  async isOfflineReady(courseId: string, minutes: number): Promise<boolean> {
    const stats = await this.getCacheStats(courseId);
    return stats.estimatedMinutes >= minutes;
  }

  // ============================================
  // CLEANUP
  // ============================================

  async clearCache(courseId?: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (courseId) {
      // Clear only for specific course
      const tx = this.db.transaction('audio', 'readwrite');
      const store = tx.objectStore('audio');
      const index = store.index('by-course');

      let cursor = await index.openCursor(courseId);
      while (cursor) {
        this.audioCache.delete(cursor.value.id);
        await cursor.delete();
        cursor = await cursor.continue();
      }

      // Also clear manifest
      await this.db.delete('manifests', courseId);
    } else {
      // Clear everything
      await this.db.clear('audio');
      await this.db.clear('manifests');
      this.audioCache.clear();
    }
  }

  async pruneOldCache(maxAgeDays: number): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    let pruned = 0;
    const tx = this.db.transaction('audio', 'readwrite');
    const store = tx.objectStore('audio');
    const index = store.index('by-cached-at');

    // Get all items older than cutoff
    let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
    while (cursor) {
      this.audioCache.delete(cursor.value.id);
      await cursor.delete();
      pruned++;
      cursor = await cursor.continue();
    }

    return pruned;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * Factory function
 */
export function createOfflineCache(): OfflineCache {
  return new OfflineCache();
}
