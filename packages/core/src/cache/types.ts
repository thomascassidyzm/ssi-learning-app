/**
 * Cache types for offline support
 */

import type { AudioRef, CourseManifest, LegoProgress, SeedProgress, HelixState } from '../data/types';

// ============================================
// CACHE STATISTICS
// ============================================

export interface CacheStats {
  /** Total cached audio files */
  audioCount: number;
  /** Total size in bytes */
  totalBytes: number;
  /** Estimated minutes of content cached */
  estimatedMinutes: number;
  /** Last cache update time */
  lastUpdated: Date | null;
}

// ============================================
// DOWNLOAD PROGRESS
// ============================================

export interface DownloadProgress {
  /** Total files to download */
  total: number;
  /** Files downloaded so far */
  downloaded: number;
  /** Current file being downloaded */
  currentFile: string | null;
  /** Bytes downloaded */
  bytesDownloaded: number;
  /** Total bytes to download (if known) */
  totalBytes: number | null;
  /** Download state */
  state: 'idle' | 'downloading' | 'paused' | 'complete' | 'error';
  /** Error message if state is error */
  error?: string;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

// ============================================
// CACHED ITEMS
// ============================================

export interface CachedAudio {
  /** Audio reference ID */
  id: string;
  /** Audio URL (original) */
  url: string;
  /** Audio blob data */
  blob: Blob;
  /** MIME type */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** When cached */
  cachedAt: Date;
  /** Course this audio belongs to */
  courseId: string;
}

export interface CachedManifest {
  /** Course ID */
  courseId: string;
  /** Manifest data */
  manifest: CourseManifest;
  /** Version for cache invalidation */
  version: string;
  /** When cached */
  cachedAt: Date;
}

export interface CachedProgress {
  /** Composite key: `${learnerId}:${courseId}` */
  id: string;
  /** Learner ID */
  learnerId: string;
  /** Course ID */
  courseId: string;
  /** Triple Helix state */
  helixState: HelixState;
  /** LEGO progress records */
  legoProgress: LegoProgress[];
  /** SEED progress records */
  seedProgress: SeedProgress[];
  /** When last updated */
  updatedAt: Date;
}

// ============================================
// OFFLINE CACHE INTERFACE
// ============================================

export interface IOfflineCache {
  // Audio caching
  cacheAudio(audioRef: AudioRef, courseId: string): Promise<void>;
  getCachedAudio(audioId: string): Promise<Blob | null>;
  isAudioCached(audioId: string): boolean;

  // Manifest caching
  cacheManifest(manifest: CourseManifest): Promise<void>;
  getCachedManifest(courseId: string): Promise<CourseManifest | null>;

  // Progress caching (for offline sync)
  cacheProgress(
    learnerId: string,
    courseId: string,
    helixState: HelixState,
    legoProgress: LegoProgress[],
    seedProgress: SeedProgress[]
  ): Promise<void>;
  getCachedProgress(learnerId: string, courseId: string): Promise<{
    helixState: HelixState;
    legoProgress: LegoProgress[];
    seedProgress: SeedProgress[];
  } | null>;
  getProgressByLearner(learnerId: string): Promise<CachedProgress[]>;
  deleteProgressByLearner(learnerId: string): Promise<void>;

  // Prefetching
  prefetchForDuration(courseId: string, minutes: number): Promise<void>;

  // Statistics
  getCacheStats(courseId?: string): Promise<CacheStats>;
  isOfflineReady(courseId: string, minutes: number): Promise<boolean>;

  // Cleanup
  clearCache(courseId?: string): Promise<void>;
  pruneOldCache(maxAgeDays: number): Promise<number>;
}

// ============================================
// DOWNLOAD MANAGER INTERFACE
// ============================================

export interface IDownloadManager {
  /** Download a course for offline use */
  downloadCourse(
    courseId: string,
    hours: number,
    onProgress?: DownloadProgressCallback
  ): Promise<void>;

  /** Pause current download */
  pauseDownload(): void;

  /** Resume paused download (in-session) */
  resumeDownload(): void;

  /** Cancel current download */
  cancelDownload(): void;

  /** Get current download progress */
  getProgress(): DownloadProgress;

  /** Check if a download is in progress */
  isDownloading(): boolean;

  /** Check if there's a resumable download from previous session */
  hasResumableDownload(): boolean;

  /** Get info about resumable download */
  getResumableDownloadInfo(): { courseId: string; completed: number; total: number } | null;

  /** Resume a previously interrupted download (cross-session) */
  resumePreviousDownload(onProgress?: DownloadProgressCallback): Promise<void>;
}

// ============================================
// AUDIO SOURCE INTERFACE
// ============================================

export interface IAudioSource {
  /** Get audio URL (from cache or network) */
  getAudioUrl(audioRef: AudioRef): Promise<string>;

  /** Preload audio for upcoming items */
  preloadAudio(audioRefs: AudioRef[], courseId: string): Promise<void>;

  /** Check if audio is available (cached or online) */
  isAvailable(audioRef: AudioRef): Promise<boolean>;
}
