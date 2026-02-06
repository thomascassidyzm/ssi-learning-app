/**
 * AudioController - Atomic playback with preloading
 *
 * Key principles:
 * - Play ONE audio file at a time (never concatenate)
 * - Just play/stop (no pause/resume)
 * - Preload upcoming audio for smooth playback
 */

import type { AudioRef } from '../data/types';
import type { IAudioController } from './types';

export class AudioController implements IAudioController {
  private audio: HTMLAudioElement | null = null;
  private preloadCache: Map<string, HTMLAudioElement> = new Map();
  private endedCallbacks: Set<() => void> = new Set();
  private callbackErrorLogged = false;

  constructor() {
    // Create reusable audio element
    if (typeof window !== 'undefined') {
      this.audio = new Audio();
      this.audio.addEventListener('ended', this.handleEnded.bind(this));
    }
  }

  /**
   * Play a single audio file
   * Returns a promise that resolves when playback starts
   */
  async play(audioRef: AudioRef): Promise<void> {
    if (!this.audio) {
      throw new Error('AudioController not available (no window)');
    }

    // Stop any current playback
    this.stop();

    // Check if preloaded
    const preloaded = this.preloadCache.get(audioRef.id);
    if (preloaded) {
      // Use preloaded audio
      this.audio.src = preloaded.src;
    } else {
      // Load directly
      this.audio.src = audioRef.url;
    }

    // Wait for enough data to play
    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        this.audio?.removeEventListener('canplay', onCanPlay);
        this.audio?.removeEventListener('error', onError);
        resolve();
      };

      const onError = (_e: Event) => {
        this.audio?.removeEventListener('canplay', onCanPlay);
        this.audio?.removeEventListener('error', onError);
        reject(new Error(`Failed to load audio: ${audioRef.url}`));
      };

      this.audio?.addEventListener('canplay', onCanPlay);
      this.audio?.addEventListener('error', onError);

      // If already ready, resolve immediately
      if (this.audio && this.audio.readyState >= 3) {
        onCanPlay();
      }
    });

    // Start playback
    await this.audio.play();
  }

  /**
   * Stop current playback
   */
  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
  }

  /**
   * Preload audio files for smooth playback
   */
  async preload(audioRefs: AudioRef[]): Promise<void> {
    const promises = audioRefs.map(async (ref) => {
      // Skip if already preloaded
      if (this.preloadCache.has(ref.id)) {
        return;
      }

      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = ref.url;

      // Wait for it to load
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          audio.removeEventListener('canplaythrough', onLoaded);
          audio.removeEventListener('error', onLoaded);
          resolve();
        };

        audio.addEventListener('canplaythrough', onLoaded);
        audio.addEventListener('error', onLoaded); // Resolve even on error

        // If already loaded
        if (audio.readyState >= 4) {
          onLoaded();
        }
      });

      this.preloadCache.set(ref.id, audio);
    });

    await Promise.all(promises);
  }

  /**
   * Check if an audio file is preloaded
   */
  isPreloaded(audioRef: AudioRef): boolean {
    return this.preloadCache.has(audioRef.id);
  }

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return this.audio ? !this.audio.paused : false;
  }

  /**
   * Get current playback position in ms
   */
  getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  /**
   * Add playback ended listener
   */
  onEnded(callback: () => void): void {
    this.endedCallbacks.add(callback);
  }

  /**
   * Remove playback ended listener
   */
  offEnded(callback: () => void): void {
    this.endedCallbacks.delete(callback);
  }

  /**
   * Clear preload cache (e.g., when changing courses)
   */
  clearCache(): void {
    this.preloadCache.clear();
  }

  /**
   * Remove specific items from cache
   */
  removeFromCache(audioIds: string[]): void {
    for (const id of audioIds) {
      this.preloadCache.delete(id);
    }
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.preloadCache.size;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private handleEnded(): void {
    // Notify all listeners
    for (const callback of this.endedCallbacks) {
      try {
        callback();
      } catch (error) {
        if (!this.callbackErrorLogged) {
          console.error('Error in audio ended callback:', error);
          this.callbackErrorLogged = true;
        }
      }
    }
  }

  /**
   * Cleanup method for when the controller is no longer needed
   */
  dispose(): void {
    this.stop();
    this.clearCache();
    this.endedCallbacks.clear();

    if (this.audio) {
      this.audio.removeEventListener('ended', this.handleEnded.bind(this));
      this.audio = null;
    }
  }
}

/**
 * Factory function to create AudioController
 * Returns null if not in browser environment
 */
export function createAudioController(): AudioController | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return new AudioController();
}
