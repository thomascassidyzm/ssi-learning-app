// SlicePlayer.ts - Web Audio slice-playback primitive for pod-ladder chunks
//
// Pod-ladder chunks replay the same Take-G clip at different ms slices
// repeatedly within one lap, so the whole point of this primitive is:
// decode each clip's ArrayBuffer ONCE via AudioContext.decodeAudioData and
// cache the resulting AudioBuffer, then reuse it for every slice/replay.
//
// Mirrors SimplePlayer's "one reusable playback resource for the life of the
// player" pattern (there: a single Audio element; here: a single AudioContext)
// — mobile Safari's audio-gesture-unlock model requires it. The context is
// created lazily on first use and resume()'d if suspended.

export interface SlicePlayerOptions {
  /** Base course code sent to the audio proxy as ?courseId=. */
  courseCode?: string
}

/** Public shape kept intentionally small — this is a low-level primitive, not a state machine. */
export interface ISlicePlayer {
  playSlice(clipId: string, startMs: number, endMs: number, speed?: number): Promise<void>
  playWhole(clipId: string, speed?: number): Promise<void>
  preload(clipId: string): Promise<void>
  stop(): void
  dispose(): void
}

export class SlicePlayer implements ISlicePlayer {
  private courseCode: string

  private ctx: AudioContext | null = null

  // clipId -> decoded buffer (resolved cache)
  private bufferCache = new Map<string, AudioBuffer>()

  // clipId -> in-flight fetch+decode, so concurrent playSlice/preload calls
  // for the same clip never double-fetch or double-decode.
  private pending = new Map<string, Promise<AudioBuffer>>()

  private currentSource: AudioBufferSourceNode | null = null
  private currentSettle: (() => void) | null = null

  constructor(options: SlicePlayerOptions = {}) {
    this.courseCode = options.courseCode ?? ''
  }

  setCourseCode(courseCode: string): void {
    this.courseCode = courseCode
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    return this.ctx
  }

  private async loadBuffer(clipId: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(clipId)
    if (cached) return cached

    const inFlight = this.pending.get(clipId)
    if (inFlight) return inFlight

    const promise = (async () => {
      const url = `/api/audio/${clipId}?courseId=${encodeURIComponent(this.courseCode)}`
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const ctx = this.ensureContext()
      const buffer = await ctx.decodeAudioData(arrayBuffer)
      this.bufferCache.set(clipId, buffer)
      return buffer
    })()

    this.pending.set(clipId, promise)
    try {
      return await promise
    } finally {
      this.pending.delete(clipId)
    }
  }

  /** Fetch+decode a clip ahead of time. No-op if already cached or already in-flight. */
  async preload(clipId: string): Promise<void> {
    try {
      await this.loadBuffer(clipId)
    } catch (err) {
      console.warn(`[SlicePlayer] preload failed for "${clipId}"`, err)
    }
  }

  /** Play the whole clip, start to finish. Convenience wrapper over playSlice. */
  async playWhole(clipId: string, speed = 1): Promise<void> {
    let buffer: AudioBuffer
    try {
      buffer = await this.loadBuffer(clipId)
    } catch (err) {
      console.warn(`[SlicePlayer] playWhole failed to load "${clipId}"`, err)
      throw err
    }
    return this.playBuffer(buffer, 0, buffer.duration, speed)
  }

  /**
   * Play the [startMs, endMs) slice of clipId at the given playback speed.
   * Resolves when the slice finishes playing OR stop() is called (a
   * user-initiated stop is a clean settle, not an error — same spirit as
   * SimplePlayer's treatment of stop()).
   * Rejects only if the clip itself fails to fetch/decode.
   */
  async playSlice(clipId: string, startMs: number, endMs: number, speed = 1): Promise<void> {
    let buffer: AudioBuffer
    try {
      buffer = await this.loadBuffer(clipId)
    } catch (err) {
      console.warn(`[SlicePlayer] playSlice failed to load "${clipId}"`, err)
      throw err
    }

    const offsetSeconds = Math.max(0, startMs / 1000)
    const durationSeconds = Math.max(0, (endMs - startMs) / 1000)
    return this.playBuffer(buffer, offsetSeconds, durationSeconds, speed)
  }

  private playBuffer(buffer: AudioBuffer, offsetSeconds: number, durationSeconds: number, speed: number): Promise<void> {
    // Only one slice plays at a time — stop whatever's in flight first.
    this.stop()

    const ctx = this.ensureContext()

    return new Promise<void>((resolve) => {
      const settle = () => {
        if (this.currentSettle === settle) {
          this.currentSettle = null
          this.currentSource = null
        }
        resolve()
      }

      const finish = () => {
        void (async () => {
          if (ctx.state === 'suspended') {
            try {
              await ctx.resume()
            } catch (err) {
              console.warn('[SlicePlayer] AudioContext.resume() failed', err)
            }
          }

          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.playbackRate.value = speed
          source.connect(ctx.destination)
          source.onended = settle

          this.currentSource = source
          this.currentSettle = settle

          try {
            source.start(0, offsetSeconds, durationSeconds)
          } catch (err) {
            console.warn('[SlicePlayer] source.start() failed', err)
            settle()
          }
        })()
      }

      finish()
    })
  }

  /** Immediately silence any in-flight source and settle its pending promise cleanly. */
  stop(): void {
    const source = this.currentSource
    const settle = this.currentSettle
    this.currentSource = null
    this.currentSettle = null

    if (source) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // already stopped/ended — fine
      }
      try {
        source.disconnect()
      } catch {
        // no-op
      }
    }

    if (settle) settle()
  }

  dispose(): void {
    this.stop()
    this.bufferCache.clear()
    this.pending.clear()
    if (this.ctx) {
      void this.ctx.close().catch(() => {
        // no-op — context may already be closed
      })
      this.ctx = null
    }
  }
}
