import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type AudioFailedEvent, type Round } from './SimplePlayer'

// Minimal HTMLAudioElement mock. Each new SimplePlayer instance creates
// its own via `new Audio()`, so we stub the global constructor.
interface MockAudio {
  src: string
  playbackRate: number
  paused: boolean
  ended: boolean
  error: { code: number } | null
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  // Helpers our tests use to simulate browser behavior
  _endedHandler?: () => void
  _errorHandler?: (e: Event) => void
}

function makeMockAudio(): MockAudio {
  const a: MockAudio = {
    src: '',
    playbackRate: 1,
    paused: true,
    ended: false,
    error: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  }
  a.addEventListener.mockImplementation((event: string, handler: () => void) => {
    if (event === 'ended') a._endedHandler = handler
    if (event === 'error') a._errorHandler = handler as (e: Event) => void
  })
  return a
}

function makeRound(legoId: string): Round {
  return {
    roundNumber: parseInt(legoId.replace(/[SL]/g, ''), 10) || 1,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: [
      {
        id: `${legoId}-c1`,
        known: { text: 'hello', audioUrl: 'https://example.com/k.mp3' },
        target: {
          text: 'hola',
          voice1Url: 'https://example.com/t1.mp3',
          voice2Url: 'https://example.com/t2.mp3',
        },
        pauseDuration: 0, // skip pause phase so the cycle progresses quickly
      },
    ],
  }
}

describe('SimplePlayer — circuit breaker', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('emits audio_failed with reason=circuit after 3 consecutive safety timeouts', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    // Fire safety timer 3 times
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(10_000)
    }

    expect(failedEvents.length).toBe(1)
    expect(failedEvents[0].reason).toBe('circuit')
    expect(failedEvents[0].failureCount).toBe(3)
    // Session should have been paused
    expect(mockAudio.pause).toHaveBeenCalled()
  })

  it('emits audio_failed with reason=needs-gesture on NotAllowedError from play()', async () => {
    const notAllowed = Object.assign(new Error('User didn\'t interact'), { name: 'NotAllowedError' })
    mockAudio.play = vi.fn().mockRejectedValue(notAllowed)

    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    // Let microtask queue resolve so the play() rejection propagates
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    await Promise.resolve()

    expect(failedEvents.length).toBe(1)
    expect(failedEvents[0].reason).toBe('needs-gesture')
    // Gesture-required does NOT consume the circuit budget
    expect(failedEvents[0].failureCount).toBe(0)
  })

  it('resets the failure counter on a natural audio ended', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    // Two safety-timeout failures...
    vi.advanceTimersByTime(10_000)
    vi.advanceTimersByTime(10_000)
    // ...then a successful audio end
    mockAudio._endedHandler?.()
    // ...then two more safety timeouts — still shouldn't trip
    vi.advanceTimersByTime(10_000)
    vi.advanceTimersByTime(10_000)

    expect(failedEvents.length).toBe(0)
  })

  it('resume() resets the circuit budget so a paused session can retry', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    for (let i = 0; i < 3; i++) vi.advanceTimersByTime(10_000)
    expect(failedEvents.length).toBe(1)

    // User taps Play → circuit resets → one more failure shouldn't re-trip
    player.resume()
    vi.advanceTimersByTime(10_000)
    expect(failedEvents.length).toBe(1)
  })
})
