/**
 * AudioSource - Hybrid audio source with cache-first strategy
 *
 * Strategy:
 * 1. Check cache first (instant)
 * 2. If not cached, fetch from network
 * 3. Cache for future use
 * 4. Graceful fallback: if network fails, use any cached content
 */

import type { AudioRef } from '../data/types';
import type { IAudioSource, IOfflineCache } from './types';

export class AudioSource implements IAudioSource {
  private cache: IOfflineCache;
  private blobUrls: Map<string, string> = new Map();
  private courseId: string;
  private isOnline: boolean = true;

  constructor(cache: IOfflineCache, courseId: string) {
    this.cache = cache;
    this.courseId = courseId;

    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;
      window.addEventListener('online', () => { this.isOnline = true; });
      window.addEventListener('offline', () => { this.isOnline = false; });
    }
  }

  /**
   * Get audio URL - from cache or network
   * Returns a blob URL for cached content, or the original URL for network
   */
  async getAudioUrl(audioRef: AudioRef): Promise<string> {
    // Check if we already have a blob URL for this audio
    const existingBlobUrl = this.blobUrls.get(audioRef.id);
    if (existingBlobUrl) {
      return existingBlobUrl;
    }

    // Try cache first
    if (this.cache.isAudioCached(audioRef.id)) {
      const blob = await this.cache.getCachedAudio(audioRef.id);
      if (blob) {
        const blobUrl = URL.createObjectURL(blob);
        this.blobUrls.set(audioRef.id, blobUrl);
        return blobUrl;
      }
    }

    // Not cached - try network
    if (this.isOnline) {
      try {
        // Cache it for future use (non-blocking)
        this.cache.cacheAudio(audioRef, this.courseId).catch(err => {
          console.warn(`Failed to cache audio ${audioRef.id}:`, err);
        });

        // Return original URL for immediate playback
        return audioRef.url;
      } catch (error) {
        console.error(`Failed to fetch audio ${audioRef.id}:`, error);
        throw new Error(`Audio not available: ${audioRef.id}`);
      }
    }

    // Offline and not cached
    throw new Error(`Audio not available offline: ${audioRef.id}`);
  }

  /**
   * Preload audio for upcoming items
   * Caches in background, doesn't block
   */
  async preloadAudio(audioRefs: AudioRef[], courseId: string): Promise<void> {
    // Filter out already cached
    const uncached = audioRefs.filter(ref => !this.cache.isAudioCached(ref.id));

    if (uncached.length === 0) return;

    // Cache in parallel (but don't fail if some fail)
    await Promise.allSettled(
      uncached.map(ref => this.cache.cacheAudio(ref, courseId))
    );
  }

  /**
   * Check if audio is available (cached or online)
   */
  async isAvailable(audioRef: AudioRef): Promise<boolean> {
    // Cached = always available
    if (this.cache.isAudioCached(audioRef.id)) {
      return true;
    }

    // Online = can fetch
    if (this.isOnline) {
      return true;
    }

    // Offline and not cached = not available
    return false;
  }

  /**
   * Cleanup blob URLs when no longer needed
   */
  revokeBlobUrl(audioId: string): void {
    const blobUrl = this.blobUrls.get(audioId);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      this.blobUrls.delete(audioId);
    }
  }

  /**
   * Cleanup all blob URLs
   */
  revokeAllBlobUrls(): void {
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
  }

  /**
   * Get current online status
   */
  getOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Update course ID (when switching courses)
   */
  setCourseId(courseId: string): void {
    this.courseId = courseId;
  }
}

/**
 * Factory function
 */
export function createAudioSource(cache: IOfflineCache, courseId: string): AudioSource {
  return new AudioSource(cache, courseId);
}
