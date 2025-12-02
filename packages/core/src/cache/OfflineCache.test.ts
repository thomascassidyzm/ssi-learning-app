/**
 * OfflineCache Tests
 *
 * Tests IndexedDB-based caching for offline support.
 * Uses fake-indexeddb for browser-independent testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { OfflineCache, createOfflineCache } from './OfflineCache';
import type { AudioRef, CourseManifest, LegoProgress, SeedProgress, HelixState } from '../data/types';

// ============================================
// MOCK DATA FACTORY (unique IDs per test)
// ============================================

let testCounter = 0;
const createUniqueId = () => `test-${Date.now()}-${++testCounter}`;

const createMockAudioRef = (suffix?: string): AudioRef => ({
  id: `audio-${createUniqueId()}${suffix ? `-${suffix}` : ''}`,
  url: `https://example.com/audio/${createUniqueId()}.mp3`,
  duration_ms: 2000,
});

const createMockManifest = (courseId?: string): CourseManifest => {
  const id = courseId || `course-${createUniqueId()}`;
  return {
    course_id: id,
    title: 'Test Course',
    known_language: 'en',
    target_language: 'es',
    version: '1.0.0',
    seeds: [
      {
        seed_id: 'S0001',
        seed_pair: { known: 'hello', target: 'hola' },
        legos: [
          {
            id: 'S0001L01',
            type: 'A',
            new: true,
            lego: { known: 'hello', target: 'hola' },
            audioRefs: {
              known: { id: `k1-${id}`, url: '/audio/k1.mp3' },
              target: {
                voice1: { id: `t1v1-${id}`, url: '/audio/t1v1.mp3' },
                voice2: { id: `t1v2-${id}`, url: '/audio/t1v2.mp3' },
              },
            },
          },
        ],
      },
    ],
    audio_count: 3,
    estimated_hours: 1,
  };
};

const mockHelixState: HelixState = {
  active_thread: 1,
  threads: {
    1: { seedOrder: ['S0001'], currentSeedId: 'S0001', currentLegoIndex: 0 },
    2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
    3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
  },
  injected_content: {},
};

const mockLegoProgress: LegoProgress[] = [
  {
    lego_id: 'S0001L01',
    course_id: 'course-001',
    thread_id: 1,
    fibonacci_position: 2,
    skip_number: 3,
    reps_completed: 5,
    is_retired: false,
    last_practiced_at: new Date('2024-01-01'),
  },
];

const mockSeedProgress: SeedProgress[] = [
  {
    seed_id: 'S0001',
    course_id: 'course-001',
    thread_id: 1,
    is_introduced: true,
    introduced_at: new Date('2024-01-01'),
  },
];

// ============================================
// SETUP
// ============================================

// Mock fetch for audio caching tests
const mockFetch = vi.fn();

// ============================================
// TESTS
// ============================================

describe('OfflineCache', () => {
  let cache: OfflineCache;

  beforeEach(() => {
    // Reset IndexedDB between tests
    indexedDB = new IDBFactory();

    // Reset mocks
    vi.clearAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;

    // Create fresh cache instance
    cache = new OfflineCache();
  });

  afterEach(() => {
    cache.close();
  });

  // ============================================
  // AUDIO CACHING
  // ============================================

  describe('Audio Caching', () => {
    it('should cache audio and retrieve it', async () => {
      const audioRef = createMockAudioRef();
      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef, 'course-001');

      const retrieved = await cache.getCachedAudio(audioRef.id);
      expect(retrieved).toBeInstanceOf(Blob);
      expect(retrieved?.size).toBe(mockBlob.size);
    });

    it('should return true for isAudioCached after caching', async () => {
      const audioRef = createMockAudioRef();
      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      expect(cache.isAudioCached(audioRef.id)).toBe(false);

      await cache.cacheAudio(audioRef, 'course-001');

      expect(cache.isAudioCached(audioRef.id)).toBe(true);
    });

    it('should return null for uncached audio', async () => {
      const retrieved = await cache.getCachedAudio('nonexistent-id');
      expect(retrieved).toBeNull();
    });

    it('should skip caching if already cached', async () => {
      const audioRef = createMockAudioRef();
      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef, 'course-001');
      await cache.cacheAudio(audioRef, 'course-001');

      // Fetch should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error if fetch fails', async () => {
      const audioRef = createMockAudioRef();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(cache.cacheAudio(audioRef, 'course-001')).rejects.toThrow(
        'Failed to fetch audio: 404'
      );
    });

    it('should handle network errors', async () => {
      const audioRef = createMockAudioRef();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(cache.cacheAudio(audioRef, 'course-001')).rejects.toThrow(
        'Network error'
      );
    });
  });

  // ============================================
  // MANIFEST CACHING
  // ============================================

  describe('Manifest Caching', () => {
    it('should cache and retrieve manifest', async () => {
      const manifest = createMockManifest();
      await cache.cacheManifest(manifest);

      const retrieved = await cache.getCachedManifest(manifest.course_id);
      expect(retrieved).toEqual(manifest);
    });

    it('should return null for uncached manifest', async () => {
      const retrieved = await cache.getCachedManifest('nonexistent-course');
      expect(retrieved).toBeNull();
    });

    it('should overwrite existing manifest with same course ID', async () => {
      const courseId = `course-${createUniqueId()}`;
      const manifest = createMockManifest(courseId);
      await cache.cacheManifest(manifest);

      const updatedManifest = { ...manifest, version: '2.0.0' };
      await cache.cacheManifest(updatedManifest);

      const retrieved = await cache.getCachedManifest(courseId);
      expect(retrieved?.version).toBe('2.0.0');
    });

    it('should cache multiple manifests for different courses', async () => {
      const manifest1 = createMockManifest();
      const manifest2 = createMockManifest();
      await cache.cacheManifest(manifest1);
      await cache.cacheManifest(manifest2);

      const retrieved1 = await cache.getCachedManifest(manifest1.course_id);
      const retrieved2 = await cache.getCachedManifest(manifest2.course_id);

      expect(retrieved1?.course_id).toBe(manifest1.course_id);
      expect(retrieved2?.course_id).toBe(manifest2.course_id);
    });
  });

  // ============================================
  // PROGRESS CACHING
  // ============================================

  describe('Progress Caching', () => {
    it('should cache and retrieve progress', async () => {
      const learnerId = `learner-${createUniqueId()}`;
      const courseId = `course-${createUniqueId()}`;

      await cache.cacheProgress(
        learnerId,
        courseId,
        mockHelixState,
        mockLegoProgress,
        mockSeedProgress
      );

      const retrieved = await cache.getCachedProgress(learnerId, courseId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.helixState).toEqual(mockHelixState);
      expect(retrieved?.legoProgress).toEqual(mockLegoProgress);
      expect(retrieved?.seedProgress).toEqual(mockSeedProgress);
    });

    it('should return null for uncached progress', async () => {
      const retrieved = await cache.getCachedProgress('nonexistent', 'course-001');
      expect(retrieved).toBeNull();
    });

    it('should update existing progress', async () => {
      const learnerId = `learner-${createUniqueId()}`;
      const courseId = `course-${createUniqueId()}`;

      await cache.cacheProgress(
        learnerId,
        courseId,
        mockHelixState,
        mockLegoProgress,
        mockSeedProgress
      );

      const updatedHelixState = { ...mockHelixState, active_thread: 2 };
      await cache.cacheProgress(
        learnerId,
        courseId,
        updatedHelixState,
        mockLegoProgress,
        mockSeedProgress
      );

      const retrieved = await cache.getCachedProgress(learnerId, courseId);
      expect(retrieved?.helixState.active_thread).toBe(2);
    });

    it('should separate progress by learner ID', async () => {
      const learner1 = `learner-${createUniqueId()}`;
      const learner2 = `learner-${createUniqueId()}`;
      const courseId = `course-${createUniqueId()}`;

      await cache.cacheProgress(
        learner1,
        courseId,
        mockHelixState,
        mockLegoProgress,
        mockSeedProgress
      );

      const learner2State = { ...mockHelixState, active_thread: 3 };
      await cache.cacheProgress(
        learner2,
        courseId,
        learner2State,
        mockLegoProgress,
        mockSeedProgress
      );

      const retrieved1 = await cache.getCachedProgress(learner1, courseId);
      const retrieved2 = await cache.getCachedProgress(learner2, courseId);

      expect(retrieved1?.helixState.active_thread).toBe(1);
      expect(retrieved2?.helixState.active_thread).toBe(3);
    });
  });

  // ============================================
  // CACHE STATISTICS
  // ============================================

  describe('Cache Statistics', () => {
    it('should return zero stats for empty cache', async () => {
      const stats = await cache.getCacheStats();

      expect(stats.audioCount).toBe(0);
      expect(stats.totalBytes).toBe(0);
      expect(stats.estimatedMinutes).toBe(0);
      expect(stats.lastUpdated).toBeNull();
    });

    it('should return correct stats after caching audio', async () => {
      const audioRef1 = createMockAudioRef('1');
      const audioRef2 = createMockAudioRef('2');
      const courseId = `course-${createUniqueId()}`;

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef1, courseId);
      await cache.cacheAudio(audioRef2, courseId);

      const stats = await cache.getCacheStats();

      expect(stats.audioCount).toBe(2);
      expect(stats.totalBytes).toBe(mockBlob.size * 2);
      expect(stats.lastUpdated).not.toBeNull();
    });

    it('should filter stats by course ID', async () => {
      const audioRef1 = createMockAudioRef('1');
      const audioRef2 = createMockAudioRef('2');
      const course1 = `course-${createUniqueId()}`;
      const course2 = `course-${createUniqueId()}`;

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef1, course1);
      await cache.cacheAudio(audioRef2, course2);

      const stats1 = await cache.getCacheStats(course1);
      const stats2 = await cache.getCacheStats(course2);
      const statsAll = await cache.getCacheStats();

      expect(stats1.audioCount).toBe(1);
      expect(stats2.audioCount).toBe(1);
      expect(statsAll.audioCount).toBe(2);
    });
  });

  // ============================================
  // OFFLINE READINESS
  // ============================================

  describe('Offline Readiness', () => {
    it('should return false when not enough content cached', async () => {
      const isReady = await cache.isOfflineReady('course-001', 30);
      expect(isReady).toBe(false);
    });

    it('should return true when enough content cached', async () => {
      const courseId = `course-${createUniqueId()}`;
      const mockBlob = new Blob(['x'.repeat(100000)], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      // Cache 180 audio files (simulating 30 minutes of content)
      for (let i = 0; i < 180; i++) {
        await cache.cacheAudio({ id: `audio-${courseId}-${i}`, url: `/audio/${i}.mp3` }, courseId);
      }

      const isReady = await cache.isOfflineReady(courseId, 30);
      expect(isReady).toBe(true);
    });
  });

  // ============================================
  // CACHE CLEANUP
  // ============================================

  describe('Cache Cleanup', () => {
    it('should clear all cache', async () => {
      const audioRef = createMockAudioRef();
      const manifest = createMockManifest();

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef, manifest.course_id);
      await cache.cacheManifest(manifest);

      await cache.clearCache();

      expect(cache.isAudioCached(audioRef.id)).toBe(false);
      const retrievedManifest = await cache.getCachedManifest(manifest.course_id);
      expect(retrievedManifest).toBeNull();
    });

    it('should clear cache for specific course only', async () => {
      const audioRef1 = createMockAudioRef('1');
      const audioRef2 = createMockAudioRef('2');
      const course1 = `course-${createUniqueId()}`;
      const course2 = `course-${createUniqueId()}`;

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef1, course1);
      await cache.cacheAudio(audioRef2, course2);

      await cache.clearCache(course1);

      expect(cache.isAudioCached(audioRef1.id)).toBe(false);
      expect(cache.isAudioCached(audioRef2.id)).toBe(true);
    });

    it('should prune old cache entries', async () => {
      const audioRef = createMockAudioRef();
      const courseId = `course-${createUniqueId()}`;

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef, courseId);

      // Prune entries older than 0 days (should remove everything)
      const pruned = await cache.pruneOldCache(0);

      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(cache.isAudioCached(audioRef.id)).toBe(false);
    });

    it('should not prune recent cache entries', async () => {
      const audioRef = createMockAudioRef();
      const courseId = `course-${createUniqueId()}`;

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.cacheAudio(audioRef, courseId);

      // Prune entries older than 30 days (should keep recent entries)
      const pruned = await cache.pruneOldCache(30);

      expect(pruned).toBe(0);
      expect(cache.isAudioCached(audioRef.id)).toBe(true);
    });
  });

  // ============================================
  // PREFETCHING
  // ============================================

  describe('Prefetching', () => {
    it('should throw error if manifest not cached', async () => {
      await expect(cache.prefetchForDuration('nonexistent-course', 30)).rejects.toThrow(
        'No manifest cached for course nonexistent-course'
      );
    });

    it('should prefetch audio for duration', async () => {
      const manifest = createMockManifest();
      await cache.cacheManifest(manifest);

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await cache.prefetchForDuration(manifest.course_id, 1);

      // Should have fetched the 3 audio files from the manifest
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should skip already cached audio during prefetch', async () => {
      const manifest = createMockManifest();
      await cache.cacheManifest(manifest);

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      // First prefetch
      await cache.prefetchForDuration(manifest.course_id, 1);
      const firstFetchCount = mockFetch.mock.calls.length;

      // Second prefetch should skip already cached
      await cache.prefetchForDuration(manifest.course_id, 1);

      expect(mockFetch.mock.calls.length).toBe(firstFetchCount);
    });
  });

  // ============================================
  // INITIALIZATION
  // ============================================

  describe('Initialization', () => {
    it('should initialize lazily', async () => {
      const newCache = new OfflineCache();

      // isAudioCached doesn't require init
      expect(newCache.isAudioCached('test')).toBe(false);

      // getCachedAudio triggers init
      const result = await newCache.getCachedAudio('test');
      expect(result).toBeNull();

      newCache.close();
    });

    it('should handle multiple init calls', async () => {
      // Multiple operations should share initialization
      const [result1, result2] = await Promise.all([
        cache.getCachedAudio('test1'),
        cache.getCachedAudio('test2'),
      ]);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });

  // ============================================
  // CLOSE
  // ============================================

  describe('Close', () => {
    it('should close database connection', async () => {
      // Initialize the database
      await cache.getCachedAudio('test');

      // Close should not throw
      expect(() => cache.close()).not.toThrow();
    });

    it('should handle closing without init', () => {
      const newCache = new OfflineCache();
      expect(() => newCache.close()).not.toThrow();
    });

    it('should handle multiple closes', async () => {
      await cache.getCachedAudio('test');

      expect(() => {
        cache.close();
        cache.close();
      }).not.toThrow();
    });
  });

  // ============================================
  // FACTORY FUNCTION
  // ============================================

  describe('Factory Function', () => {
    it('should create cache instance', () => {
      const factoryCache = createOfflineCache();
      expect(factoryCache).toBeInstanceOf(OfflineCache);
      factoryCache.close();
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================

  describe('Edge Cases', () => {
    it('should handle empty blob', async () => {
      const audioRef = createMockAudioRef();
      const emptyBlob = new Blob([], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(emptyBlob),
      });

      await cache.cacheAudio(audioRef, 'course-001');
      const retrieved = await cache.getCachedAudio(audioRef.id);

      expect(retrieved?.size).toBe(0);
    });

    it('should handle empty manifest seeds array', async () => {
      const manifest = createMockManifest();
      manifest.seeds = [];
      await cache.cacheManifest(manifest);

      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      // Should not throw with empty seeds
      await cache.prefetchForDuration(manifest.course_id, 1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle empty progress arrays', async () => {
      const learnerId = `learner-${createUniqueId()}`;
      const courseId = `course-${createUniqueId()}`;

      await cache.cacheProgress(
        learnerId,
        courseId,
        mockHelixState,
        [],
        []
      );

      const retrieved = await cache.getCachedProgress(learnerId, courseId);
      expect(retrieved?.legoProgress).toEqual([]);
      expect(retrieved?.seedProgress).toEqual([]);
    });

    it('should handle special characters in IDs', async () => {
      const mockBlob = new Blob(['fake audio data'], { type: 'audio/mpeg' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      const specialRef: AudioRef = {
        id: `audio:special/chars#test-${createUniqueId()}`,
        url: 'https://example.com/audio.mp3',
      };

      await cache.cacheAudio(specialRef, 'course-001');
      expect(cache.isAudioCached(specialRef.id)).toBe(true);

      const retrieved = await cache.getCachedAudio(specialRef.id);
      expect(retrieved).not.toBeNull();
    });
  });
});
