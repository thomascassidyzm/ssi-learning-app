/**
 * DownloadManager - Explicit course download for offline use
 *
 * Features:
 * - Download X hours of content
 * - Progress reporting
 * - Pause/resume/cancel
 * - Resumable downloads across app restarts
 * - Graceful error handling
 *
 * Download Options:
 * - Current belt remainder (~30 min)
 * - Next 2 hours
 * - Next 5 hours
 * - Entire course (up to 10 hours)
 */

import type { AudioRef, CourseManifest } from '../data/types';
import type {
  IDownloadManager,
  IOfflineCache,
  DownloadProgress,
  DownloadProgressCallback,
} from './types';

/**
 * Persisted download task for resume across app restarts
 */
interface PersistedDownloadTask {
  courseId: string;
  hours: number;
  pendingAudioIds: string[];  // Just IDs, we'll look up URLs from manifest
  completedCount: number;
  totalCount: number;
  savedAt: Date;
}

const DOWNLOAD_TASK_KEY = 'ssi-download-task';

export class DownloadManager implements IDownloadManager {
  private cache: IOfflineCache;
  private progress: DownloadProgress;
  private onProgressCallback: DownloadProgressCallback | null = null;
  private abortController: AbortController | null = null;
  private isPaused: boolean = false;
  private pendingAudioRefs: AudioRef[] = [];
  private currentCourseId: string | null = null;
  private currentHours: number = 0;

  constructor(cache: IOfflineCache) {
    this.cache = cache;
    this.progress = this.createInitialProgress();
  }

  // ============================================
  // PERSISTENCE (for resume across restarts)
  // ============================================

  /**
   * Save download task to localStorage for resume
   */
  private saveDownloadTask(): void {
    if (!this.currentCourseId || this.pendingAudioRefs.length === 0) {
      return;
    }

    const task: PersistedDownloadTask = {
      courseId: this.currentCourseId,
      hours: this.currentHours,
      pendingAudioIds: this.pendingAudioRefs.map(ref => ref.id),
      completedCount: this.progress.downloaded,
      totalCount: this.progress.total,
      savedAt: new Date(),
    };

    try {
      localStorage.setItem(DOWNLOAD_TASK_KEY, JSON.stringify(task));
    } catch (err) {
      console.warn('[DownloadManager] Failed to save download task:', err);
    }
  }

  /**
   * Load persisted download task
   */
  private loadDownloadTask(): PersistedDownloadTask | null {
    try {
      const stored = localStorage.getItem(DOWNLOAD_TASK_KEY);
      if (!stored) return null;

      const task = JSON.parse(stored) as PersistedDownloadTask;

      // Check if task is still valid (less than 24 hours old)
      const savedAt = new Date(task.savedAt);
      const hoursSinceSave = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSave > 24) {
        this.clearPersistedTask();
        return null;
      }

      return task;
    } catch (err) {
      console.warn('[DownloadManager] Failed to load download task:', err);
      return null;
    }
  }

  /**
   * Clear persisted download task
   */
  private clearPersistedTask(): void {
    try {
      localStorage.removeItem(DOWNLOAD_TASK_KEY);
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Check if there's a resumable download
   */
  hasResumableDownload(): boolean {
    const task = this.loadDownloadTask();
    return task !== null && task.pendingAudioIds.length > 0;
  }

  /**
   * Get info about resumable download
   */
  getResumableDownloadInfo(): { courseId: string; completed: number; total: number } | null {
    const task = this.loadDownloadTask();
    if (!task) return null;

    return {
      courseId: task.courseId,
      completed: task.completedCount,
      total: task.totalCount,
    };
  }

  /**
   * Resume a previously interrupted download (cross-session)
   * Use this after app restart to continue an interrupted download.
   */
  async resumePreviousDownload(onProgress?: DownloadProgressCallback): Promise<void> {
    const task = this.loadDownloadTask();
    if (!task) {
      throw new Error('No download to resume');
    }

    // Get manifest to look up audio URLs
    const manifest = await this.cache.getCachedManifest(task.courseId);
    if (!manifest) {
      this.clearPersistedTask();
      throw new Error(`No manifest for course ${task.courseId}`);
    }

    // Build audio ref lookup
    const audioRefMap = this.buildAudioRefMap(manifest);

    // Filter to only pending audio that still needs downloading
    const pendingRefs = task.pendingAudioIds
      .filter(id => !this.cache.isAudioCached(id))
      .map(id => audioRefMap.get(id))
      .filter((ref): ref is AudioRef => ref !== undefined);

    if (pendingRefs.length === 0) {
      this.clearPersistedTask();
      this.progress = {
        ...this.createInitialProgress(),
        state: 'complete',
        total: task.totalCount,
        downloaded: task.totalCount,
      };
      if (onProgress) onProgress(this.progress);
      return;
    }

    // Set up for resume
    this.currentCourseId = task.courseId;
    this.currentHours = task.hours;
    this.pendingAudioRefs = pendingRefs;
    this.onProgressCallback = onProgress ?? null;
    this.abortController = new AbortController();
    this.isPaused = false;

    this.progress = {
      total: task.totalCount,
      downloaded: task.completedCount,
      currentFile: null,
      bytesDownloaded: 0,
      totalBytes: null,
      state: 'downloading',
    };
    this.notifyProgress();

    try {
      await this.processDownloadQueue();
      this.clearPersistedTask();
      this.progress.state = 'complete';
      this.notifyProgress();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.progress.state = 'error';
        this.progress.error = (error as Error).message;
        this.notifyProgress();
        throw error;
      }
    }
  }

  /**
   * Build a map of audioId -> AudioRef for quick lookup
   */
  private buildAudioRefMap(manifest: CourseManifest): Map<string, AudioRef> {
    const map = new Map<string, AudioRef>();

    for (const seed of manifest.seeds) {
      for (const lego of seed.legos) {
        map.set(lego.audioRefs.known.id, lego.audioRefs.known);
        map.set(lego.audioRefs.target.voice1.id, lego.audioRefs.target.voice1);
        map.set(lego.audioRefs.target.voice2.id, lego.audioRefs.target.voice2);
      }
    }

    return map;
  }

  private createInitialProgress(): DownloadProgress {
    return {
      total: 0,
      downloaded: 0,
      currentFile: null,
      bytesDownloaded: 0,
      totalBytes: null,
      state: 'idle',
    };
  }

  /**
   * Download a course for offline use
   */
  async downloadCourse(
    courseId: string,
    hours: number,
    onProgress?: DownloadProgressCallback
  ): Promise<void> {
    // Already downloading
    if (this.progress.state === 'downloading') {
      throw new Error('Download already in progress');
    }

    this.onProgressCallback = onProgress ?? null;
    this.currentCourseId = courseId;
    this.currentHours = hours;
    this.abortController = new AbortController();
    this.isPaused = false;

    try {
      // Get the manifest
      const manifest = await this.cache.getCachedManifest(courseId);
      if (!manifest) {
        throw new Error(`No manifest for course ${courseId}. Cache manifest first.`);
      }

      // Collect audio refs for the requested duration
      const audioRefs = this.collectAudioRefs(manifest, hours);

      // Filter out already cached
      this.pendingAudioRefs = audioRefs.filter(ref => !this.cache.isAudioCached(ref.id));

      if (this.pendingAudioRefs.length === 0) {
        this.progress = {
          ...this.createInitialProgress(),
          state: 'complete',
          total: audioRefs.length,
          downloaded: audioRefs.length,
        };
        this.notifyProgress();
        this.clearPersistedTask();
        return;
      }

      // Initialize progress
      this.progress = {
        total: this.pendingAudioRefs.length,
        downloaded: 0,
        currentFile: null,
        bytesDownloaded: 0,
        totalBytes: null,
        state: 'downloading',
      };
      this.notifyProgress();

      // Save task for potential resume
      this.saveDownloadTask();

      // Download each file
      await this.processDownloadQueue();

      // Complete
      this.clearPersistedTask();
      this.progress.state = 'complete';
      this.notifyProgress();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Cancelled - save state for potential resume
        this.saveDownloadTask();
        return;
      }

      this.progress.state = 'error';
      this.progress.error = (error as Error).message;
      this.notifyProgress();
      // Save for resume on error too
      this.saveDownloadTask();
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Pause current download
   */
  pauseDownload(): void {
    if (this.progress.state === 'downloading') {
      this.isPaused = true;
      this.progress.state = 'paused';
      this.notifyProgress();
      // Save for resume
      this.saveDownloadTask();
    }
  }

  /**
   * Resume paused download
   */
  resumeDownload(): void {
    if (this.progress.state === 'paused' && this.currentCourseId) {
      this.isPaused = false;
      this.progress.state = 'downloading';
      this.notifyProgress();

      // Continue processing
      this.processDownloadQueue().then(() => {
        this.progress.state = 'complete';
        this.notifyProgress();
      }).catch(error => {
        if ((error as Error).name !== 'AbortError') {
          this.progress.state = 'error';
          this.progress.error = (error as Error).message;
          this.notifyProgress();
        }
      });
    }
  }

  /**
   * Cancel current download
   */
  cancelDownload(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isPaused = false;
    this.pendingAudioRefs = [];
    this.progress = this.createInitialProgress();
    this.notifyProgress();
    // Clear persisted task on cancel
    this.clearPersistedTask();
  }

  /**
   * Get current download progress
   */
  getProgress(): DownloadProgress {
    return { ...this.progress };
  }

  /**
   * Check if a download is in progress
   */
  isDownloading(): boolean {
    return this.progress.state === 'downloading' || this.progress.state === 'paused';
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private collectAudioRefs(manifest: CourseManifest, hours: number): AudioRef[] {
    const audioRefs: AudioRef[] = [];

    // Estimate: 30 seconds per item, 3 audio files per item
    const itemsNeeded = Math.ceil((hours * 60 * 60) / 30);
    let collected = 0;

    for (const seed of manifest.seeds) {
      if (collected >= itemsNeeded) break;

      for (const lego of seed.legos) {
        audioRefs.push(lego.audioRefs.known);
        audioRefs.push(lego.audioRefs.target.voice1);
        audioRefs.push(lego.audioRefs.target.voice2);
        collected++;

        if (collected >= itemsNeeded) break;
      }
    }

    return audioRefs;
  }

  private async processDownloadQueue(): Promise<void> {
    // Process in batches of 5 for better performance
    const batchSize = 5;

    while (this.pendingAudioRefs.length > 0) {
      // Check for pause
      if (this.isPaused) {
        return; // Will be resumed later
      }

      // Check for abort
      if (this.abortController?.signal.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }

      // Get next batch
      const batch = this.pendingAudioRefs.splice(0, batchSize);

      // Download batch in parallel
      await Promise.all(
        batch.map(async (ref) => {
          this.progress.currentFile = ref.id;
          this.notifyProgress();

          try {
            await this.cache.cacheAudio(ref, this.currentCourseId!);
            this.progress.downloaded++;
            this.notifyProgress();
          } catch (error) {
            console.warn(`Failed to download ${ref.id}:`, error);
            // Continue with other files
          }
        })
      );
    }
  }

  private notifyProgress(): void {
    if (this.onProgressCallback) {
      this.onProgressCallback({ ...this.progress });
    }
  }
}

/**
 * Factory function
 */
export function createDownloadManager(cache: IOfflineCache): DownloadManager {
  return new DownloadManager(cache);
}
