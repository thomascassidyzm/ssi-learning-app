/**
 * RobustAudioController Tests
 *
 * Tests stall detection, safety timeout, cancel/abort, and onEnded callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RobustAudioController } from './RobustAudioController'

// ============================================
// Mock HTMLAudioElement
// ============================================

let latestMockAudio: ReturnType<typeof createMockAudio>

function createMockAudio() {
  const listeners: Record<string, Function[]> = {}
  const mock = {
    src: '',
    currentTime: 0,
    volume: 1,
    paused: true,
    playbackRate: 1,
    preload: '',
    load: vi.fn(),
    play: vi.fn(function (this: any) {
      this.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(function (this: any) { this.paused = true }),
    setAttribute: vi.fn(),
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
  latestMockAudio = mock
  return mock
}

vi.stubGlobal('Audio', vi.fn(() => createMockAudio()))

/** Flush microtask queue so async play() internals settle */
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('RobustAudioController', () => {
  let controller: RobustAudioController

  beforeEach(() => {
    vi.useFakeTimers()
    controller = new RobustAudioController('test')
  })

  afterEach(() => {
    controller.cancel()
    vi.useRealTimers()
  })

  it('resolves when audio ends normally', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    await flush()
    latestMockAudio._fireEvent('ended')
    await expect(promise).resolves.toBeUndefined()
  })

  it('calls onEnded callback when audio ends', async () => {
    const onEnded = vi.fn()
    controller.setOnEnded(onEnded)

    const promise = controller.play('https://example.com/test.mp3')
    await flush()
    latestMockAudio._fireEvent('ended')

    await promise
    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('does not call onEnded callback when cancelled', async () => {
    const onEnded = vi.fn()
    controller.setOnEnded(onEnded)

    controller.play('https://example.com/test.mp3')
    await flush()
    controller.cancel()

    // cancel() cleans up listeners and pauses audio but the promise hangs
    // (by design — callers use cancel() to abandon, not await)
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('rejects on audio error when not aborted', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    await flush()
    latestMockAudio._fireEvent('error', new Event('error'))

    await expect(promise).rejects.toBeDefined()
  })

  it('cancel pauses and cleans up without error', async () => {
    controller.play('https://example.com/test.mp3')
    await flush()
    const audio = latestMockAudio

    // cancel() should not throw and should pause audio
    expect(() => controller.cancel()).not.toThrow()
    expect(audio.pause).toHaveBeenCalled()
  })

  it('detects stall and resolves after 3s (two 1.5s intervals)', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    await flush()
    const audio = latestMockAudio

    audio.currentTime = 1
    audio.paused = false

    await vi.advanceTimersByTimeAsync(1500) // records lastTime = 1
    await vi.advanceTimersByTimeAsync(1500) // ct still 1 → stall

    await expect(promise).resolves.toBeUndefined()
  })

  it('does not false-positive stall when currentTime advances', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    await flush()
    const audio = latestMockAudio
    audio.paused = false

    audio.currentTime = 1
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 2
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 3
    await vi.advanceTimersByTimeAsync(1500)

    audio._fireEvent('ended')
    await expect(promise).resolves.toBeUndefined()
  })

  it('triggers safety timeout at 15s', async () => {
    const promise = controller.play('https://example.com/test.mp3')
    await flush()
    const audio = latestMockAudio
    audio.paused = false

    // Advance in steps, incrementing currentTime to avoid stall detection
    for (let i = 1; i <= 10; i++) {
      audio.currentTime = i
      await vi.advanceTimersByTimeAsync(1500)
    }

    await expect(promise).resolves.toBeUndefined()
  })

  it('sets playback rate on the audio element', async () => {
    const promise = controller.play('https://example.com/test.mp3', 1.5)
    await flush()
    const audio = latestMockAudio

    expect(audio.playbackRate).toBe(1.5)

    audio._fireEvent('ended')
    await promise
  })

  it('cancel pauses audio and resets currentTime', async () => {
    controller.play('https://example.com/test.mp3')
    await flush()
    const audio = latestMockAudio
    controller.cancel()

    expect(audio.pause).toHaveBeenCalled()
    expect(audio.currentTime).toBe(0)
  })

  it('settled flag prevents double resolution', async () => {
    const onEnded = vi.fn()
    controller.setOnEnded(onEnded)

    const promise = controller.play('https://example.com/test.mp3')
    await flush()
    const audio = latestMockAudio

    audio._fireEvent('ended')
    audio._fireEvent('ended')

    await promise
    expect(onEnded).toHaveBeenCalledOnce()
  })
})
