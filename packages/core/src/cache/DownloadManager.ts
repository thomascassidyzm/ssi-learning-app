/**
 * DownloadManager - Explicit course download for offline use
 *
 * Features:
 * - Download X hours of content
 * - Progress reporting
 * - Pause/resume/cancel
 * - Graceful error handling
 */

import type { AudioRef, CourseManifest } from '../data/types';
import type {
  IDownloadManager,
  IOfflineCache,
  DownloadProgress,
  DownloadProgressCallback,
} from './types';

export class DownloadManager implements IDownloadManager {
  private cache: IOfflineCache;
  private progress: DownloadProgress;
  private onProgressCallback: DownloadProgressCallback | null = null;
  private abortController: AbortController | null = null;
  private isPaused: boolean = false;
  private pendingAudioRefs: AudioRef[] = [];
  private currentCourseId: string | null = null;

  constructor(cache: IOfflineCache) {
    this.cache = cache;
    this.progress = this.createInitialProgress();
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

      // Download each file
      await this.processDownloadQueue();

      // Complete
      this.progress.state = 'complete';
      this.notifyProgress();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Cancelled - don't update state, it's already set
        return;
      }

      this.progress.state = 'error';
      this.progress.error = (error as Error).message;
      this.notifyProgress();
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
