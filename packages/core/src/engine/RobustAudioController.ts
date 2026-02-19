/**
 * RobustAudioController - Audio playback with stall detection and safety timeout
 *
 * Designed for mobile compatibility (iOS/Safari audio unlock).
 * Features:
 * - Single reusable Audio element (preserves user gesture unlock)
 * - Stall detection (3s no progress → skip)
 * - Safety timeout (15s max per clip)
 * - Cancel/abort support with cleanup
 * - Optional onEnded callback
 */

export class RobustAudioController {
  private audio: HTMLAudioElement | null = null;
  private isUnlocked = false;
  private aborted = false;
  private currentCleanup: (() => void) | null = null;
  private onEndedCallback: (() => void) | null = null;
  private tag: string;

  constructor(tag = 'RobustAudioController') {
    this.tag = tag;
    if (typeof window !== 'undefined') {
      this.audio = new Audio();
    }
  }

  /**
   * Set an optional callback invoked after each successful playback ends.
   */
  setOnEnded(cb: (() => void) | null): void {
    this.onEndedCallback = cb;
  }

  /**
   * Unlock audio on iOS/Safari - must be called from user gesture.
   * Returns immediately if already unlocked.
   */
  async unlock(): Promise<void> {
    if (this.isUnlocked || !this.audio) return;

    try {
      this.audio.src =
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      this.audio.volume = 0;
      await this.audio.play();
      this.audio.pause();
      this.audio.volume = 1;
      this.isUnlocked = true;
      console.log(`[${this.tag}] Audio unlocked for mobile`);
    } catch (err) {
      console.warn(`[${this.tag}] Failed to unlock audio:`, err);
    }
  }

  /**
   * Cancel any in-flight playback. Safe to call multiple times.
   */
  cancel(): void {
    this.aborted = true;
    if (this.currentCleanup) {
      this.currentCleanup();
      this.currentCleanup = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
  }

  /**
   * Play a URL. Resolves when playback ends, is cancelled, or times out.
   * Rejects only on genuine playback errors (not cancellation).
   */
  async play(url: string, speed: number = 1): Promise<void> {
    this.cancel();
    this.aborted = false;

    if (!this.audio) {
      this.audio = new Audio();
    }

    if (!this.isUnlocked) {
      await this.unlock();
    }

    this.audio.src = url;
    this.audio.load();

    return new Promise((resolve, reject) => {
      let settled = false;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;
      let stallCheck: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        if (stallCheck) {
          clearInterval(stallCheck);
          stallCheck = null;
        }
        this.audio?.removeEventListener('ended', onEnded);
        this.audio?.removeEventListener('error', onError);
        this.currentCleanup = null;
      };

      this.currentCleanup = cleanup;

      const onEnded = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!this.aborted && this.onEndedCallback) {
          this.onEndedCallback();
        }
        resolve();
      };

      const onError = (e: Event) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this.aborted) {
          resolve();
        } else {
          console.error(`[${this.tag}] Playback error:`, e);
          reject(e);
        }
      };

      if (this.aborted) {
        settled = true;
        resolve();
        return;
      }

      this.audio!.addEventListener('ended', onEnded);
      this.audio!.addEventListener('error', onError);

      // Stall detection: resolve if currentTime stops advancing for 3s
      let lastTime = -1;
      stallCheck = setInterval(() => {
        if (settled) {
          cleanup();
          return;
        }
        const ct = this.audio?.currentTime || 0;
        if (ct > 0 && ct === lastTime && !this.audio?.paused) {
          console.warn(`[${this.tag}] Audio stalled, skipping`);
          onEnded();
        }
        lastTime = ct;
      }, 1500);

      // Safety timeout: no clip should take more than 15s
      safetyTimer = setTimeout(() => {
        if (!settled) {
          console.warn(`[${this.tag}] Safety timeout, skipping`);
          onEnded();
        }
      }, 15000);

      this.audio!.playbackRate = speed;
      this.audio!.play().catch((err) => {
        if (this.aborted) {
          if (!settled) {
            settled = true;
            cleanup();
            resolve();
          }
        } else {
          console.error(`[${this.tag}] Play failed:`, err);
          onError(err);
        }
      });
    });
  }

  /**
   * Stop playback (alias for cancel).
   */
  stop(): void {
    this.cancel();
  }
}

export default RobustAudioController;
