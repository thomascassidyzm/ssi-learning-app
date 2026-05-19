import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type AudioFailedEvent, type Round } from './SimplePlayer'

// Minimal HTMLAudioElement mock. Each new SimplePlayer instance creates
// its own via `new Audio()`, so we stub the global constructor.
interface MockAudio {
  src: string
  playbackRate: number
  volume: number
  loop: boolean
  paused: boolean
  ended: boolean
  error: { code: number } | null
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
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
    volume: 1,
    loop: false,
    paused: true,
    ended: false,
    error: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
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

describe('SimplePlayer — failure handling', () => {
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

  it('does NOT emit audio_failed after repeated safety timeouts — ploughs on instead', () => {
    // Learner experience must never stall on a broken UUID / 404 / stall.
    // The old circuit breaker halted after 3 failures; now we log and advance.
    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(10_000)
    }

    expect(failedEvents.length).toBe(0)
  })

  it('emits audio_failed with reason=needs-gesture on NotAllowedError from play()', async () => {
    // The one halt we keep: the browser will not play ANY audio until the
    // user taps, so we must pause and surface the gesture prompt.
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
  })
})

describe('SimplePlayer.replaceQueueFromCurrent', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(makeMockAudio))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves the round currently playing and drops earlier ones from the batch', () => {
    // Bootstrap rounds 1..5 already loaded, player advanced into round 3.
    // Full script lands with rounds 1..10. Expect: rounds 1..3 from
    // bootstrap kept (round 3 is the playing one, can't swap mid-cycle),
    // rounds 4..10 taken from the full script.
    const bootstrap = ['S0001L01', 'S0001L02', 'S0001L03', 'S0001L04', 'S0001L05'].map(makeRound)
    const player = new SimplePlayer(bootstrap)
    // Mark each bootstrap round so we can distinguish source after replace
    for (const r of (player as any).rounds) r.__source = 'bootstrap'
    ;(player as any).state.roundIndex = 2  // playing round 3 (S0001L03)

    const fullScript = ['S0001L01', 'S0001L02', 'S0001L03', 'S0001L04', 'S0001L05',
                        'S0001L06', 'S0001L07', 'S0001L08', 'S0001L09', 'S0001L10'].map(makeRound)
    for (const r of fullScript) (r as any).__source = 'fullscript'

    player.replaceQueueFromCurrent(fullScript)

    const after = (player as any).rounds
    expect(after).toHaveLength(10)
    // Rounds 1..3 from bootstrap (the playing one and earlier untouched)
    expect(after.slice(0, 3).map((r: any) => r.__source)).toEqual(['bootstrap', 'bootstrap', 'bootstrap'])
    // Rounds 4..10 from full script
    expect(after.slice(3).map((r: any) => r.__source)).toEqual(Array(7).fill('fullscript'))
    // Player state unchanged
    expect((player as any).state.roundIndex).toBe(2)
  })

  it('full-replaces when player has never started (idle, no current round)', () => {
    const player = new SimplePlayer([])
    const fullScript = ['S0001L01', 'S0001L02'].map(makeRound)
    player.replaceQueueFromCurrent(fullScript)
    expect((player as any).rounds).toHaveLength(2)
  })

  it('no-ops on empty batch', () => {
    const initial = ['S0001L01', 'S0001L02'].map(makeRound)
    const player = new SimplePlayer(initial)
    player.replaceQueueFromCurrent([])
    expect((player as any).rounds).toHaveLength(2)
  })
})
