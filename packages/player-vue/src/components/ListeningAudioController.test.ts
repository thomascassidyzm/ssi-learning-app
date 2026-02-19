/**
 * ListeningAudioController Tests
 *
 * Tests stall detection, safety timeout, blob URL cleanup, and error recovery
 * for the ListeningAudioController class inside ListeningModePlayer.vue.
 *
 * We extract the class logic inline since it's defined inside a Vue SFC <script setup>.
 * This mirrors the class exactly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================
// Reproduce ListeningAudioController class
// (mirrors ListeningModePlayer.vue lines 10-130)
// ============================================

function createMockAudio() {
  const listeners: Record<string, Function[]> = {}
  return {
    src: '',
    currentTime: 0,
    paused: true,
    playbackRate: 1,
    error: null as { code: number; message: string } | null,
    load: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(function (this: any) { this.paused = true }),
    addEventListener: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler)
      }
    }),
    _listeners: listeners,
    _fireEvent(event: string, data?: any) {
      for (const handler of [...(listeners[event] || [])]) {
        handler(data)
      }
    },
  }
}

// Inline the class to test it independently of Vue
class ListeningAudioController {
  audio: ReturnType<typeof createMockAudio> | null = null
  endedCallbacks = new Set<Function>()
  playbackRate = 1
  currentBlobUrl: string | null = null
  safetyTimer: ReturnType<typeof setTimeout> | null = null
  stallCheck: ReturnType<typeof setInterval> | null = null

  setPlaybackRate(rate: number) {
    this.playbackRate = rate
    if (this.audio) this.audio.playbackRate = rate
  }

  clearWatchdogs() {
    if (this.safetyTimer) { clearTimeout(this.safetyTimer); this.safetyTimer = null }
    if (this.stallCheck) { clearInterval(this.stallCheck); this.stallCheck = null }
  }

  cleanupBlobUrl() {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }
  }

  async play(url: string): Promise<void> {
    if (!url) {
      this.notifyEnded()
      return
    }

    if (!this.audio) {
      this.audio = createMockAudio()
    }

    this.cleanupBlobUrl()
    this.clearWatchdogs()

    if (url.startsWith('blob:')) {
      this.currentBlobUrl = url
    }

    this.audio.src = url
    this.audio.load()

    return new Promise((resolve, reject) => {
      let settled = false

      const settle = (fn: Function) => {
        if (settled) return
        settled = true
        this.clearWatchdogs()
        this.cleanupBlobUrl()
        this.audio!.removeEventListener('ended', onEnded)
        this.audio!.removeEventListener('error', onError)
        this.notifyEnded()
        fn()
      }

      const onEnded = () => settle(resolve)

      const onError = () => {
        const audioError = this.audio!.error
        const msg = audioError
          ? `Audio error: code ${audioError.code}${audioError.message ? ' - ' + audioError.message : ''}`
          : 'Audio playback error'
        settle(() => reject(new Error(msg)))
      }

      this.audio!.addEventListener('ended', onEnded)
      this.audio!.addEventListener('error', onError)

      // Stall detection
      let lastTime = -1
      this.stallCheck = setInterval(() => {
        if (settled) { this.clearWatchdogs(); return }
        const ct = this.audio!.currentTime
        if (ct > 0 && ct === lastTime && !this.audio!.paused) {
          settle(resolve)
        }
        lastTime = ct
      }, 1500)

      // Safety timeout
      this.safetyTimer = setTimeout(() => {
        if (!settled) {
          settle(resolve)
        }
      }, 15000)

      this.audio!.playbackRate = this.playbackRate
      this.audio!.play().catch((e: Error) => {
        settle(() => reject(e))
      })
    })
  }

  stop() {
    this.clearWatchdogs()
    this.cleanupBlobUrl()
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
  }

  notifyEnded() {
    for (const cb of [...this.endedCallbacks]) {
      cb()
    }
  }
}

// Mock URL.revokeObjectURL
const revokeObjectURL = vi.fn()
vi.stubGlobal('URL', { revokeObjectURL })

describe('ListeningAudioController', () => {
  let controller: ListeningAudioController

  beforeEach(() => {
    vi.useFakeTimers()
    revokeObjectURL.mockClear()
    controller = new ListeningAudioController()
  })

  afterEach(() => {
    controller.stop()
    vi.useRealTimers()
  })

  it('resolves when audio ends normally', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    controller.audio!._fireEvent('ended')
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects with structured message on audio error', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    controller.audio!.error = { code: 4, message: 'Not supported' }
    controller.audio!._fireEvent('error')

    await expect(promise).rejects.toThrow('Audio error: code 4 - Not supported')
  })

  it('detects stall after 3s and resolves', async () => {
    controller.audio = createMockAudio()
    controller.audio.play.mockImplementation(function (this: any) {
      this.paused = false
      return Promise.resolve()
    })

    const promise = controller.play('https://example.com/test.mp3')

    controller.audio!.currentTime = 2
    vi.advanceTimersByTime(1500) // first check, records lastTime=2
    vi.advanceTimersByTime(1500) // second check, ct still 2 → stall

    await expect(promise).resolves.toBeUndefined()
  })

  it('triggers safety timeout at 15s', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    controller.audio!.paused = false

    // Keep advancing to avoid stall detection
    const advancer = setInterval(() => {
      if (controller.audio) controller.audio.currentTime += 1
    }, 1000)

    vi.advanceTimersByTime(15000)
    clearInterval(advancer)

    await expect(promise).resolves.toBeUndefined()
  })

  it('cleans up blob URLs after play ends', async () => {
    const promise = controller.play('blob:http://localhost/abc123')
    expect(controller.currentBlobUrl).toBe('blob:http://localhost/abc123')

    controller.audio!._fireEvent('ended')
    await promise

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/abc123')
    expect(controller.currentBlobUrl).toBeNull()
  })

  it('cleans up blob URLs on stop()', () => {
    controller.play('blob:http://localhost/xyz')
    expect(controller.currentBlobUrl).toBe('blob:http://localhost/xyz')

    controller.stop()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/xyz')
  })

  it('does not track non-blob URLs', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    expect(controller.currentBlobUrl).toBeNull()

    controller.audio!._fireEvent('ended')
    await promise
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('notifies ended callbacks on completion', async () => {
    const cb = vi.fn()
    controller.endedCallbacks.add(cb)

    const promise = controller.play('https://example.com/test.mp3')
    controller.audio!._fireEvent('ended')
    await promise

    expect(cb).toHaveBeenCalledOnce()
  })

  it('settled flag prevents double notification', async () => {
    const cb = vi.fn()
    controller.endedCallbacks.add(cb)

    const promise = controller.play('https://example.com/test.mp3')
    controller.audio!._fireEvent('ended')
    controller.audio!._fireEvent('ended')
    await promise

    expect(cb).toHaveBeenCalledOnce()
  })

  it('stop clears watchdogs', () => {
    controller.play('https://example.com/test.mp3')
    expect(controller.stallCheck).not.toBeNull()
    expect(controller.safetyTimer).not.toBeNull()

    controller.stop()
    expect(controller.stallCheck).toBeNull()
    expect(controller.safetyTimer).toBeNull()
  })

  it('sets playback rate on audio element', async () => {
    controller.setPlaybackRate(1.5)
    const promise = controller.play('https://example.com/test.mp3')

    expect(controller.audio!.playbackRate).toBe(1.5)

    controller.audio!._fireEvent('ended')
    await promise
  })
})
