/**
 * useOfflineCache - Vue composable for audio caching infrastructure
 *
 * Provides a singleton cache instance shared across the app for:
 * - IndexedDB-based audio caching (OfflineCache)
 * - Cache-first audio URL resolution (AudioSource)
 * - Explicit course downloads with progress (DownloadManager)
 *
 * This is separate from useOfflinePlay which handles infinite play mode
 * when offline. This composable handles the actual caching infrastructure.
 */

import { ref, readonly, shallowRef, computed, type Ref, type ComputedRef } from 'vue'
import {
  createOfflineCache,
  createAudioSource,
  createDownloadManager,
  type OfflineCache,
  type AudioSource,
  type DownloadManager,
  type DownloadProgress,
  type CacheStats,
} from '@ssi/core/cache'

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

// Singleton cache instance - shared across the entire app
const offlineCache = createOfflineCache()

// Download manager singleton - only one download at a time
const downloadManager = createDownloadManager(offlineCache)

// ============================================================================
// REACTIVE STATE
// ============================================================================

// Current audio source (changes when course changes)
const audioSource = shallowRef<AudioSource | null>(null)

// Current course ID for the audio source
const currentCourseId = ref<string | null>(null)

// Reactive download progress
const downloadProgress = ref<DownloadProgress>({
  total: 0,
  downloaded: 0,
  currentFile: null,
  bytesDownloaded: 0,
  totalBytes: null,
  state: 'idle',
})

// Cache stats (manually refreshed)
const cacheStats = ref<CacheStats>({
  audioCount: 0,
  totalBytes: 0,
  estimatedMinutes: 0,
  lastUpdated: null,
})

// Online status
const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)

// ============================================================================
// ONLINE/OFFLINE DETECTION
// ============================================================================

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline.value = true
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export interface UseOfflineCacheReturn {
  // Core instances
  cache: OfflineCache
  audioSource: Ref<AudioSource | null>
  downloadManager: DownloadManager

  // Reactive state
  currentCourseId: Ref<string | null>
  downloadProgress: Ref<DownloadProgress>
  cacheStats: Ref<CacheStats>
  isOnline: Ref<boolean>

  // Computed
  isDownloading: ComputedRef<boolean>
  downloadPercent: ComputedRef<number>

  // Actions
  initAudioSource: (courseId: string) => AudioSource
  refreshCacheStats: (courseId?: string) => Promise<CacheStats>
  downloadCourse: (courseId: string, hours: number) => Promise<void>
  pauseDownload: () => void
  resumeDownload: () => void
  cancelDownload: () => void
  clearCache: (courseId?: string) => Promise<void>
  isOfflineReady: (courseId: string, minutes: number) => Promise<boolean>
}

export function useOfflineCache(): UseOfflineCacheReturn {
  // ============================================================================
  // COMPUTED
  // ============================================================================

  const isDownloading = computed(() => {
    return downloadProgress.value.state === 'downloading' ||
           downloadProgress.value.state === 'paused'
  })

  const downloadPercent = computed(() => {
    if (downloadProgress.value.total === 0) return 0
    return Math.round((downloadProgress.value.downloaded / downloadProgress.value.total) * 100)
  })

  // ============================================================================
  // ACTIONS
  // ============================================================================

  /**
   * Initialize or update the audio source for a course.
   * Call this when the course changes.
   */
  function initAudioSource(courseId: string): AudioSource {
    // If same course, just return existing
    if (audioSource.value && currentCourseId.value === courseId) {
      return audioSource.value
    }

    // Cleanup old blob URLs
    if (audioSource.value) {
      audioSource.value.revokeAllBlobUrls()
    }

    // Create new audio source
    currentCourseId.value = courseId
    audioSource.value = createAudioSource(offlineCache, courseId)

    return audioSource.value
  }

  /**
   * Refresh cache statistics.
   * Call this after downloads complete or cache is cleared.
   */
  async function refreshCacheStats(courseId?: string): Promise<CacheStats> {
    const stats = await offlineCache.getCacheStats(courseId)
    cacheStats.value = stats
    return stats
  }

  /**
   * Download a course for offline use with progress tracking.
   * Only for paid users - check entitlement before calling.
   */
  async function downloadCourse(courseId: string, hours: number): Promise<void> {
    // Reset progress
    downloadProgress.value = {
      total: 0,
      downloaded: 0,
      currentFile: null,
      bytesDownloaded: 0,
      totalBytes: null,
      state: 'downloading',
    }

    try {
      await downloadManager.downloadCourse(courseId, hours, (progress) => {
        // Update reactive progress
        downloadProgress.value = { ...progress }
      })

      // Refresh stats after download
      await refreshCacheStats(courseId)
    } catch (error) {
      // Progress state already updated by callback
      throw error
    }
  }

  /**
   * Pause current download
   */
  function pauseDownload(): void {
    downloadManager.pauseDownload()
    downloadProgress.value = downloadManager.getProgress()
  }

  /**
   * Resume paused download
   */
  function resumeDownload(): void {
    downloadManager.resumeDownload()
    downloadProgress.value = downloadManager.getProgress()
  }

  /**
   * Cancel current download
   */
  function cancelDownload(): void {
    downloadManager.cancelDownload()
    downloadProgress.value = downloadManager.getProgress()
  }

  /**
   * Clear cache for a course or all courses
   */
  async function clearCache(courseId?: string): Promise<void> {
    await offlineCache.clearCache(courseId)
    await refreshCacheStats(courseId)
  }

  /**
   * Check if enough content is cached for offline use
   */
  async function isOfflineReady(courseId: string, minutes: number): Promise<boolean> {
    return offlineCache.isOfflineReady(courseId, minutes)
  }

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    // Core instances
    cache: offlineCache,
    audioSource: readonly(audioSource) as Ref<AudioSource | null>,
    downloadManager,

    // Reactive state
    currentCourseId: readonly(currentCourseId) as Ref<string | null>,
    downloadProgress: readonly(downloadProgress) as Ref<DownloadProgress>,
    cacheStats: readonly(cacheStats) as Ref<CacheStats>,
    isOnline: readonly(isOnline) as Ref<boolean>,

    // Computed
    isDownloading,
    downloadPercent,

    // Actions
    initAudioSource,
    refreshCacheStats,
    downloadCourse,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    clearCache,
    isOfflineReady,
  }
}

export type OfflineCacheComposable = ReturnType<typeof useOfflineCache>
