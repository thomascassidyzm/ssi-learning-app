/**
 * AudioSource - Hybrid audio source with cache-first strategy
 *
 * Strategy:
 * 1. Check cache first (instant)
 * 2. If not cached, fetch from network (via proxy for analytics/entitlements)
 * 3. Cache for future use
 * 4. Graceful fallback: if network fails, use any cached content
 *
 * Proxy Benefits:
 * - Entitlement verification at proxy layer
 * - Analytics tracking (which audio, when, who)
 * - Future CDN flexibility (swap S3 without app update)
 * - CORS bypass (proper headers from our domain)
 */

import type { AudioRef } from '../data/types';
import type { IAudioSource, IOfflineCache } from './types';

export interface AudioSourceConfig {
  /** Use proxy API instead of direct S3 URLs (default: true) */
  useProxy?: boolean;
  /** Proxy base URL (default: /api/audio) */
  proxyBaseUrl?: string;
  /** Additional context for analytics */
  analyticsContext?: {
    seedId?: string;
    role?: 'known' | 'target1' | 'target2';
  };
}

export class AudioSource implements IAudioSource {
  private cache: IOfflineCache;
  private blobUrls: Map<string, string> = new Map();
  private courseId: string;
  private isOnline: boolean = true;
  private useProxy: boolean;
  private proxyBaseUrl: string;
  private analyticsContext: AudioSourceConfig['analyticsContext'];

  constructor(cache: IOfflineCache, courseId: string, config: AudioSourceConfig = {}) {
    this.cache = cache;
    this.courseId = courseId;
    this.useProxy = config.useProxy ?? true;
    this.proxyBaseUrl = config.proxyBaseUrl ?? '/api/audio';
    this.analyticsContext = config.analyticsContext;

    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;
      window.addEventListener('online', () => { this.isOnline = true; });
      window.addEventListener('offline', () => { this.isOnline = false; });
    }
  }

  /**
   * Build proxy URL with analytics context
   */
  private buildProxyUrl(audioId: string): string {
    const params = new URLSearchParams();
    params.set('courseId', this.courseId);

    if (this.analyticsContext?.seedId) {
      params.set('seedId', this.analyticsContext.seedId);
    }
    if (this.analyticsContext?.role) {
      params.set('role', this.analyticsContext.role);
    }

    return `${this.proxyBaseUrl}/${audioId}?${params.toString()}`;
  }

  /**
   * Update analytics context (e.g., when switching to a new seed)
   */
  setAnalyticsContext(context: AudioSourceConfig['analyticsContext']): void {
    this.analyticsContext = context;
  }

  /**
   * Get audio URL - from cache or network
   * Returns a blob URL for cached content, or proxy/direct URL for network
   *
   * Priority:
   * 1. In-memory blob URL (instant)
   * 2. IndexedDB cache (fast)
   * 3. Proxy URL (preferred - analytics, entitlements)
   * 4. Direct S3 URL (fallback)
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
        // Determine which URL to use for fetching
        const fetchUrl = this.useProxy
          ? this.buildProxyUrl(audioRef.id)
          : audioRef.url;

        // Cache it for future use (non-blocking, silent failure)
        // Note: cacheAudio uses audioRef.url which may be S3 direct
        // This is intentional - we cache from the original source
        this.cache.cacheAudio(audioRef, this.courseId).catch(() => {
          // Silent - cache failures are non-critical
        });

        // Return proxy URL for immediate playback (benefits: analytics, CORS)
        return fetchUrl;
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
export function createAudioSource(
  cache: IOfflineCache,
  courseId: string,
  config?: AudioSourceConfig
): AudioSource {
  return new AudioSource(cache, courseId, config);
}
