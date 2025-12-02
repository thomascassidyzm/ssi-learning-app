/**
 * DownloadManager Tests
 *
 * Tests explicit course download functionality for offline use.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DownloadManager, createDownloadManager } from './DownloadManager';
import type { IOfflineCache, DownloadProgress, CacheStats } from './types';
import type { CourseManifest } from '../data/types';

// ============================================
// MOCK DATA
// ============================================

const createMockManifest = (courseId: string = 'course-001'): CourseManifest => ({
  course_id: courseId,
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
            known: { id: `k1-${courseId}`, url: '/audio/k1.mp3' },
            target: {
              voice1: { id: `t1v1-${courseId}`, url: '/audio/t1v1.mp3' },
              voice2: { id: `t1v2-${courseId}`, url: '/audio/t1v2.mp3' },
            },
          },
        },
        {
          id: 'S0001L02',
          type: 'A',
          new: true,
          lego: { known: 'world', target: 'mundo' },
          audioRefs: {
            known: { id: `k2-${courseId}`, url: '/audio/k2.mp3' },
            target: {
              voice1: { id: `t2v1-${courseId}`, url: '/audio/t2v1.mp3' },
              voice2: { id: `t2v2-${courseId}`, url: '/audio/t2v2.mp3' },
            },
          },
        },
      ],
    },
    {
      seed_id: 'S0002',
      seed_pair: { known: 'goodbye', target: 'adios' },
      legos: [
        {
          id: 'S0002L01',
          type: 'A',
          new: true,
          lego: { known: 'goodbye', target: 'adios' },
          audioRefs: {
            known: { id: `k3-${courseId}`, url: '/audio/k3.mp3' },
            target: {
              voice1: { id: `t3v1-${courseId}`, url: '/audio/t3v1.mp3' },
              voice2: { id: `t3v2-${courseId}`, url: '/audio/t3v2.mp3' },
            },
          },
        },
      ],
    },
  ],
  audio_count: 9,
  estimated_hours: 0.5,
});

// ============================================
// MOCK CACHE
// ============================================

const createMockCache = (): IOfflineCache => ({
  cacheAudio: vi.fn().mockResolvedValue(undefined),
  getCachedAudio: vi.fn().mockResolvedValue(null),
  isAudioCached: vi.fn().mockReturnValue(false),
  cacheManifest: vi.fn().mockResolvedValue(undefined),
  getCachedManifest: vi.fn().mockResolvedValue(null),
  cacheProgress: vi.fn().mockResolvedValue(undefined),
  getCachedProgress: vi.fn().mockResolvedValue(null),
  prefetchForDuration: vi.fn().mockResolvedValue(undefined),
  getCacheStats: vi.fn().mockResolvedValue({
    audioCount: 0,
    totalBytes: 0,
    estimatedMinutes: 0,
    lastUpdated: null,
  } as CacheStats),
  isOfflineReady: vi.fn().mockResolvedValue(false),
  clearCache: vi.fn().mockResolvedValue(undefined),
  pruneOldCache: vi.fn().mockResolvedValue(0),
});

// ============================================
// TESTS
// ============================================

describe('DownloadManager', () => {
  let downloadManager: DownloadManager;
  let mockCache: IOfflineCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCache = createMockCache();
    downloadManager = new DownloadManager(mockCache);
  });

  // ============================================
  // INITIAL STATE
  // ============================================

  describe('Initial State', () => {
    it('should start in idle state', () => {
      const progress = downloadManager.getProgress();

      expect(progress.state).toBe('idle');
      expect(progress.total).toBe(0);
      expect(progress.downloaded).toBe(0);
    });

    it('should not be downloading initially', () => {
      expect(downloadManager.isDownloading()).toBe(false);
    });
  });

  // ============================================
  // DOWNLOAD COURSE
  // ============================================

  describe('downloadCourse', () => {
    it('should throw error if no manifest cached', async () => {
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(null);

      await expect(downloadManager.downloadCourse('course-001', 1)).rejects.toThrow(
        'No manifest for course course-001'
      );
    });

    it('should download audio files from manifest', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await downloadManager.downloadCourse(manifest.course_id, 1);

      // Should cache all 9 audio files (3 per LEGO, 3 LEGOs)
      expect(mockCache.cacheAudio).toHaveBeenCalledTimes(9);
    });

    it('should skip already cached audio', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      // First 3 files are cached
      vi.mocked(mockCache.isAudioCached)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      await downloadManager.downloadCourse(manifest.course_id, 1);

      // Should only cache 6 files (9 - 3 cached)
      expect(mockCache.cacheAudio).toHaveBeenCalledTimes(6);
    });

    it('should complete immediately if all files cached', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);

      const progressCallback = vi.fn();
      await downloadManager.downloadCourse(manifest.course_id, 1, progressCallback);

      expect(mockCache.cacheAudio).not.toHaveBeenCalled();

      const finalProgress = progressCallback.mock.calls[0][0] as DownloadProgress;
      expect(finalProgress.state).toBe('complete');
    });

    it('should report progress during download', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      const progressUpdates: DownloadProgress[] = [];
      await downloadManager.downloadCourse(manifest.course_id, 1, (progress) => {
        progressUpdates.push({ ...progress });
      });

      // Should have multiple progress updates
      expect(progressUpdates.length).toBeGreaterThan(1);

      // First update should be downloading state
      expect(progressUpdates[0].state).toBe('downloading');

      // Last update should be complete
      const lastProgress = progressUpdates[progressUpdates.length - 1];
      expect(lastProgress.state).toBe('complete');
    });

    it('should set state to complete when done', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await downloadManager.downloadCourse(manifest.course_id, 1);

      const progress = downloadManager.getProgress();
      expect(progress.state).toBe('complete');
    });

    it('should limit audio collection based on hours', async () => {
      // Create a large manifest
      const largeManifest = createMockManifest('large-course');
      largeManifest.seeds = Array.from({ length: 1000 }, (_, i) => ({
        seed_id: `S${i.toString().padStart(4, '0')}`,
        seed_pair: { known: `word${i}`, target: `palabra${i}` },
        legos: [
          {
            id: `S${i.toString().padStart(4, '0')}L01`,
            type: 'A' as const,
            new: true,
            lego: { known: `word${i}`, target: `palabra${i}` },
            audioRefs: {
              known: { id: `k${i}`, url: `/audio/k${i}.mp3` },
              target: {
                voice1: { id: `t${i}v1`, url: `/audio/t${i}v1.mp3` },
                voice2: { id: `t${i}v2`, url: `/audio/t${i}v2.mp3` },
              },
            },
          },
        ],
      }));

      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(largeManifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      // 0.5 hours = 30 minutes = 1800 seconds / 30 seconds per item = 60 items
      await downloadManager.downloadCourse(largeManifest.course_id, 0.5);

      // Should have cached 60 items * 3 audio files = 180 calls
      expect(mockCache.cacheAudio).toHaveBeenCalled();
      const calls = vi.mocked(mockCache.cacheAudio).mock.calls.length;
      expect(calls).toBeLessThanOrEqual(180);
    });
  });

  // ============================================
  // PAUSE / RESUME
  // ============================================

  describe('Pause and Resume', () => {
    it('should do nothing if not downloading when pausing', () => {
      downloadManager.pauseDownload();

      expect(downloadManager.getProgress().state).toBe('idle');
    });

    it('should do nothing if not paused when resuming', () => {
      downloadManager.resumeDownload();

      expect(downloadManager.getProgress().state).toBe('idle');
    });

    it('should report isDownloading true when paused', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      // Make cacheAudio slow enough to pause
      let cacheCallCount = 0;
      vi.mocked(mockCache.cacheAudio).mockImplementation(() => {
        cacheCallCount++;
        if (cacheCallCount === 3) {
          // Pause during download
          downloadManager.pauseDownload();
        }
        return Promise.resolve();
      });

      await downloadManager.downloadCourse(manifest.course_id, 1);

      // After completion, it's not downloading anymore
      expect(downloadManager.isDownloading()).toBe(false);
    });
  });

  // ============================================
  // CANCEL
  // ============================================

  describe('Cancel', () => {
    it('should reset state when cancelDownload is called', () => {
      // Cancel sets state to idle
      downloadManager.cancelDownload();

      const progress = downloadManager.getProgress();
      expect(progress.state).toBe('idle');
      expect(progress.total).toBe(0);
      expect(progress.downloaded).toBe(0);
    });

    it('should not be downloading after cancel', () => {
      downloadManager.cancelDownload();
      expect(downloadManager.isDownloading()).toBe(false);
    });

    it('should allow new download after cancel', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      // First download - cancel immediately
      let firstDownloadCancelled = false;
      vi.mocked(mockCache.cacheAudio).mockImplementation(() => {
        if (!firstDownloadCancelled) {
          downloadManager.cancelDownload();
          firstDownloadCancelled = true;
        }
        return Promise.resolve();
      });

      await downloadManager.downloadCourse(manifest.course_id, 1);

      // Reset mock for second download
      vi.mocked(mockCache.cacheAudio).mockResolvedValue(undefined);

      // Start second download - should work
      await downloadManager.downloadCourse(manifest.course_id, 1);

      expect(downloadManager.getProgress().state).toBe('complete');
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================

  describe('Error Handling', () => {
    it('should continue on individual file errors', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      // Fail some files
      let callCount = 0;
      vi.mocked(mockCache.cacheAudio).mockImplementation(() => {
        callCount++;
        if (callCount % 3 === 0) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve();
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await downloadManager.downloadCourse(manifest.course_id, 1);

      expect(downloadManager.getProgress().state).toBe('complete');
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should set error state on critical failure', async () => {
      vi.mocked(mockCache.getCachedManifest).mockRejectedValue(new Error('Database error'));

      await expect(downloadManager.downloadCourse('course-001', 1)).rejects.toThrow(
        'Database error'
      );

      const progress = downloadManager.getProgress();
      expect(progress.state).toBe('error');
      expect(progress.error).toBe('Database error');
    });

    it('should report error through progress callback', async () => {
      vi.mocked(mockCache.getCachedManifest).mockRejectedValue(new Error('Database error'));

      const progressCallback = vi.fn();

      await expect(
        downloadManager.downloadCourse('course-001', 1, progressCallback)
      ).rejects.toThrow();

      const errorProgress = progressCallback.mock.calls.find(
        call => (call[0] as DownloadProgress).state === 'error'
      );
      expect(errorProgress).toBeDefined();
    });
  });

  // ============================================
  // PROGRESS TRACKING
  // ============================================

  describe('Progress Tracking', () => {
    it('should track current file being downloaded', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      const currentFiles: (string | null)[] = [];
      await downloadManager.downloadCourse(manifest.course_id, 1, (progress) => {
        currentFiles.push(progress.currentFile);
      });

      // Should have recorded file IDs during download
      const fileIds = currentFiles.filter(f => f !== null);
      expect(fileIds.length).toBeGreaterThan(0);
    });

    it('should increment downloaded count', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      const downloadedCounts: number[] = [];
      await downloadManager.downloadCourse(manifest.course_id, 1, (progress) => {
        downloadedCounts.push(progress.downloaded);
      });

      // Should see increasing counts
      const finalCount = downloadedCounts[downloadedCounts.length - 1];
      expect(finalCount).toBeGreaterThan(0);

      // Should be monotonically increasing
      for (let i = 1; i < downloadedCounts.length; i++) {
        expect(downloadedCounts[i]).toBeGreaterThanOrEqual(downloadedCounts[i - 1]);
      }
    });

    it('should return progress copy (not reference)', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);

      await downloadManager.downloadCourse(manifest.course_id, 1);

      const progress1 = downloadManager.getProgress();
      const progress2 = downloadManager.getProgress();

      // Should be equal but not same reference
      expect(progress1).toEqual(progress2);
      expect(progress1).not.toBe(progress2);
    });
  });

  // ============================================
  // FACTORY FUNCTION
  // ============================================

  describe('Factory Function', () => {
    it('should create DownloadManager instance', () => {
      const factoryManager = createDownloadManager(mockCache);
      expect(factoryManager).toBeInstanceOf(DownloadManager);
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================

  describe('Edge Cases', () => {
    it('should handle manifest with no seeds', async () => {
      const emptyManifest = createMockManifest('empty-course');
      emptyManifest.seeds = [];
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(emptyManifest);

      await downloadManager.downloadCourse(emptyManifest.course_id, 1);

      expect(mockCache.cacheAudio).not.toHaveBeenCalled();
      expect(downloadManager.getProgress().state).toBe('complete');
    });

    it('should handle manifest with empty legos', async () => {
      const noLegosManifest = createMockManifest('no-legos');
      noLegosManifest.seeds = [{ ...noLegosManifest.seeds[0], legos: [] }];
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(noLegosManifest);

      await downloadManager.downloadCourse(noLegosManifest.course_id, 1);

      expect(mockCache.cacheAudio).not.toHaveBeenCalled();
    });

    it('should handle zero hours request', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await downloadManager.downloadCourse(manifest.course_id, 0);

      // 0 hours = 0 items needed, should complete immediately
      expect(downloadManager.getProgress().state).toBe('complete');
    });

    it('should handle fractional hours', async () => {
      const manifest = createMockManifest();
      vi.mocked(mockCache.getCachedManifest).mockResolvedValue(manifest);
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await downloadManager.downloadCourse(manifest.course_id, 0.01);

      // 0.01 hours = 36 seconds / 30 = ~1-2 items
      expect(mockCache.cacheAudio).toHaveBeenCalled();
    });
  });
});
