/**
 * AudioSource Tests
 *
 * Tests hybrid audio source with cache-first strategy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioSource, createAudioSource } from './AudioSource';
import type { IOfflineCache } from './types';
import type { AudioRef } from '../data/types';

// ============================================
// MOCK DATA
// ============================================

const mockAudioRef: AudioRef = {
  id: 'audio-001',
  url: 'https://example.com/audio/001.mp3',
  duration_ms: 2000,
};

const mockAudioRef2: AudioRef = {
  id: 'audio-002',
  url: 'https://example.com/audio/002.mp3',
  duration_ms: 3000,
};

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
  }),
  isOfflineReady: vi.fn().mockResolvedValue(false),
  clearCache: vi.fn().mockResolvedValue(undefined),
  pruneOldCache: vi.fn().mockResolvedValue(0),
});

// ============================================
// MOCK URL
// ============================================

const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();

// ============================================
// TESTS
// ============================================

describe('AudioSource', () => {
  let audioSource: AudioSource;
  let mockCache: IOfflineCache;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock URL API
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    mockCache = createMockCache();
    audioSource = new AudioSource(mockCache, 'course-001');
  });

  afterEach(() => {
    audioSource.revokeAllBlobUrls();
  });

  // ============================================
  // GET AUDIO URL - CACHED
  // ============================================

  describe('getAudioUrl - cached audio', () => {
    it('should return blob URL for cached audio', async () => {
      const mockBlob = new Blob(['audio data'], { type: 'audio/mpeg' });
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);
      vi.mocked(mockCache.getCachedAudio).mockResolvedValue(mockBlob);

      const url = await audioSource.getAudioUrl(mockAudioRef);

      expect(url).toBe('blob:mock-url');
      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
    });

    it('should reuse existing blob URL for same audio', async () => {
      const mockBlob = new Blob(['audio data'], { type: 'audio/mpeg' });
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);
      vi.mocked(mockCache.getCachedAudio).mockResolvedValue(mockBlob);

      const url1 = await audioSource.getAudioUrl(mockAudioRef);
      const url2 = await audioSource.getAudioUrl(mockAudioRef);

      expect(url1).toBe(url2);
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    });

    it('should handle cache returning null despite isAudioCached true', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);
      vi.mocked(mockCache.getCachedAudio).mockResolvedValue(null);

      // Should fall back to network
      const url = await audioSource.getAudioUrl(mockAudioRef);

      expect(url).toBe(mockAudioRef.url);
    });
  });

  // ============================================
  // GET AUDIO URL - NETWORK
  // ============================================

  describe('getAudioUrl - network', () => {
    it('should return original URL when online and not cached', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      const url = await audioSource.getAudioUrl(mockAudioRef);

      expect(url).toBe(mockAudioRef.url);
    });

    it('should trigger background caching when fetching from network', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await audioSource.getAudioUrl(mockAudioRef);

      expect(mockCache.cacheAudio).toHaveBeenCalledWith(mockAudioRef, 'course-001');
    });

    it('should not block on cache errors during network fetch', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);
      vi.mocked(mockCache.cacheAudio).mockRejectedValue(new Error('Cache error'));

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw - caching is non-blocking
      const url = await audioSource.getAudioUrl(mockAudioRef);

      expect(url).toBe(mockAudioRef.url);

      // Wait for background cache to fail
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  // ============================================
  // PRELOAD AUDIO
  // ============================================

  describe('preloadAudio', () => {
    it('should cache uncached audio files', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await audioSource.preloadAudio([mockAudioRef, mockAudioRef2], 'course-001');

      expect(mockCache.cacheAudio).toHaveBeenCalledTimes(2);
      expect(mockCache.cacheAudio).toHaveBeenCalledWith(mockAudioRef, 'course-001');
      expect(mockCache.cacheAudio).toHaveBeenCalledWith(mockAudioRef2, 'course-001');
    });

    it('should skip already cached audio files', async () => {
      vi.mocked(mockCache.isAudioCached)
        .mockReturnValueOnce(true)  // mockAudioRef is cached
        .mockReturnValueOnce(false); // mockAudioRef2 is not cached

      await audioSource.preloadAudio([mockAudioRef, mockAudioRef2], 'course-001');

      expect(mockCache.cacheAudio).toHaveBeenCalledTimes(1);
      expect(mockCache.cacheAudio).toHaveBeenCalledWith(mockAudioRef2, 'course-001');
    });

    it('should do nothing if all files are cached', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);

      await audioSource.preloadAudio([mockAudioRef, mockAudioRef2], 'course-001');

      expect(mockCache.cacheAudio).not.toHaveBeenCalled();
    });

    it('should handle cache errors gracefully', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);
      vi.mocked(mockCache.cacheAudio)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Cache error'));

      // Should not throw - uses Promise.allSettled
      await expect(
        audioSource.preloadAudio([mockAudioRef, mockAudioRef2], 'course-001')
      ).resolves.not.toThrow();
    });

    it('should handle empty array', async () => {
      await audioSource.preloadAudio([], 'course-001');
      expect(mockCache.cacheAudio).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // IS AVAILABLE
  // ============================================

  describe('isAvailable', () => {
    it('should return true for cached audio', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);

      const available = await audioSource.isAvailable(mockAudioRef);

      expect(available).toBe(true);
    });

    it('should return true when online and not cached', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      const available = await audioSource.isAvailable(mockAudioRef);

      expect(available).toBe(true);
    });
  });

  // ============================================
  // BLOB URL MANAGEMENT
  // ============================================

  describe('Blob URL Management', () => {
    it('should revoke specific blob URL', async () => {
      const mockBlob = new Blob(['audio data'], { type: 'audio/mpeg' });
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);
      vi.mocked(mockCache.getCachedAudio).mockResolvedValue(mockBlob);

      await audioSource.getAudioUrl(mockAudioRef);

      audioSource.revokeBlobUrl(mockAudioRef.id);

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('should do nothing when revoking non-existent blob URL', () => {
      audioSource.revokeBlobUrl('nonexistent');

      expect(mockRevokeObjectURL).not.toHaveBeenCalled();
    });

    it('should revoke all blob URLs', async () => {
      const mockBlob = new Blob(['audio data'], { type: 'audio/mpeg' });
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);
      vi.mocked(mockCache.getCachedAudio).mockResolvedValue(mockBlob);

      mockCreateObjectURL
        .mockReturnValueOnce('blob:url-1')
        .mockReturnValueOnce('blob:url-2');

      await audioSource.getAudioUrl(mockAudioRef);
      await audioSource.getAudioUrl(mockAudioRef2);

      audioSource.revokeAllBlobUrls();

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:url-1');
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:url-2');
    });

    it('should create new blob URL after revocation', async () => {
      const mockBlob = new Blob(['audio data'], { type: 'audio/mpeg' });
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);
      vi.mocked(mockCache.getCachedAudio).mockResolvedValue(mockBlob);

      mockCreateObjectURL
        .mockReturnValueOnce('blob:url-1')
        .mockReturnValueOnce('blob:url-2');

      await audioSource.getAudioUrl(mockAudioRef);
      audioSource.revokeBlobUrl(mockAudioRef.id);
      await audioSource.getAudioUrl(mockAudioRef);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // ONLINE STATUS
  // ============================================

  describe('Online Status', () => {
    it('should return current online status', () => {
      // In Node environment without window, isOnline defaults to true
      expect(audioSource.getOnlineStatus()).toBe(true);
    });
  });

  // ============================================
  // COURSE ID
  // ============================================

  describe('Course ID', () => {
    it('should use initial course ID for caching', async () => {
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await audioSource.getAudioUrl(mockAudioRef);

      expect(mockCache.cacheAudio).toHaveBeenCalledWith(mockAudioRef, 'course-001');
    });

    it('should update course ID', async () => {
      audioSource.setCourseId('course-002');

      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      await audioSource.getAudioUrl(mockAudioRef);

      expect(mockCache.cacheAudio).toHaveBeenCalledWith(mockAudioRef, 'course-002');
    });
  });

  // ============================================
  // FACTORY FUNCTION
  // ============================================

  describe('Factory Function', () => {
    it('should create AudioSource instance', () => {
      const factorySource = createAudioSource(mockCache, 'course-001');
      expect(factorySource).toBeInstanceOf(AudioSource);
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================

  describe('Edge Cases', () => {
    it('should handle audio ref with empty URL', async () => {
      const emptyUrlRef: AudioRef = { id: 'empty', url: '' };
      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      const url = await audioSource.getAudioUrl(emptyUrlRef);

      expect(url).toBe('');
    });

    it('should handle concurrent requests for same audio', async () => {
      const mockBlob = new Blob(['audio data'], { type: 'audio/mpeg' });
      vi.mocked(mockCache.isAudioCached).mockReturnValue(true);
      vi.mocked(mockCache.getCachedAudio).mockResolvedValue(mockBlob);

      const [url1, url2, url3] = await Promise.all([
        audioSource.getAudioUrl(mockAudioRef),
        audioSource.getAudioUrl(mockAudioRef),
        audioSource.getAudioUrl(mockAudioRef),
      ]);

      // All should get the same URL
      expect(url1).toBe(url2);
      expect(url2).toBe(url3);
    });

    it('should handle special characters in audio ID', async () => {
      const specialRef: AudioRef = {
        id: 'audio:special/chars#test',
        url: 'https://example.com/audio.mp3',
      };

      vi.mocked(mockCache.isAudioCached).mockReturnValue(false);

      const url = await audioSource.getAudioUrl(specialRef);

      expect(url).toBe(specialRef.url);
      expect(mockCache.cacheAudio).toHaveBeenCalledWith(specialRef, 'course-001');
    });
  });
});
