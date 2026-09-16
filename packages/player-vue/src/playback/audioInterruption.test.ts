/**
 * iOS audio-session interruptions, in web terms.
 *
 * Tom, 2026-08-09: "the app is backgrounded and playing fine, I switch to
 * WhatsApp — not recording, not on a call — and that SOMETIMES kills SSi
 * audio: playback does not resume when I come back."
 *
 * What that is on the web platform: another app takes the iOS audio session,
 * iOS pauses our single reused <audio> element, and the element fires 'pause'.
 * Nothing used to listen, so the engine went on believing it was playing while
 * nothing sounded — and in the two SILENT-clip windows (the PAUSE phase and
 * the post-voice2 linger) there is no stall watchdog to notice, which is
 * exactly why it was intermittent.
 *
 * RULING CHANGE (Tom, 2026-09-14). The 2026-08-09 fix recorded the
 * interruption and auto-resumed on return to the foreground. Two forum reports
 * showed what that costs: with the timers left armed, the stall watchdog and
 * the pause trim timer kept ADVANCING a session nobody could hear (the car's
 * bluetooth dropped, the phone was on silent, "enormous progress" the learner
 * never made), and the recovery then un-paused it. An outside pause is now a
 * pause: the engine freezes in place, lands isPlaying=false, the conductor
 * mirrors that into userPaused, and only the learner's tap resumes. These
 * tests pin that — and that no timer can move a frozen machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type Round, type AudioInterruptedEvent, type AudioFailedEvent } from './SimplePlayer'
import { PlayerConductor, type ConductorEngine } from './PlayerConductor'

interface MockAudio {
  src: string
  playbackRate: number
  volume: number
  loop: boolean
  paused: boolean
  ended: boolean
  error: { code: number } | null
  currentTime: number
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  _handlers: Record<string, () => void>
  /** Simulate an OUTSIDE agent stopping playback (iOS handing the audio
   * session to another app): the element goes paused and fires 'pause', with
   * no call of ours preceding it. */
  _interrupt: () => void
}

/**
 * Audio mock that models the one behaviour these tests turn on: `pause` fires
 * whenever a PLAYING element stops — whether we called pause(), assigned a new
 * src, or the OS took the session away.
 */
function makeMockAudio(): MockAudio {
  const a = {
    playbackRate: 1,
    volume: 1,
    loop: false,
    paused: true,
    ended: false,
    error: null,
    currentTime: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    _handlers: {} as Record<string, () => void>,
  } as unknown as MockAudio

  let srcValue = ''
  Object.defineProperty(a, 'src', {
    get: () => srcValue,
    set: (next: string) => {
      srcValue = next
      // The media load algorithm pauses a playing element and fires 'pause'.
      if (!a.paused) {
        a.paused = true
        a._handlers.pause?.()
      }
    },
  })

  a.addEventListener.mockImplementation((event: string, handler: () => void) => {
    a._handlers[event] = handler
  })
  a.removeEventListener.mockImplementation((event: string) => {
    delete a._handlers[event]
  })
  a.play = vi.fn(() => {
    a.paused = false
    a.ended = false
    return Promise.resolve()
  })
  a.pause = vi.fn(() => {
    if (a.paused) return // an already-paused element fires nothing
    a.paused = true
    a._handlers.pause?.()
  })
  a._interrupt = () => {
    a.paused = true
    a._handlers.pause?.()
  }
  return a
}

/** One round, one cycle, with a real (non-zero) PAUSE phase — the silent-clip
 * window where the interruption strands the session with no watchdog. */
function makeRound(legoId = 'S0001L01'): Round {
  return {
    roundNumber: 1,
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
        pauseDuration: 4000,
      },
    ],
  }
}

/**
 * An interruption always arrives well after our own last stop of the element —
 * that gap is precisely how the engine tells the two apart (SELF_STOP_GRACE_MS).
 * Tests must respect it, or they're rehearsing a race the browser can't produce.
 */
async function interruptAfterGrace(a: MockAudio): Promise<void> {
  await vi.advanceTimersByTimeAsync(500)
  a._interrupt()
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
}

describe('SimplePlayer — outside audio interruptions', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    setVisibility('visible')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setVisibility('visible')
  })

  it('records an interruption when something outside the app pauses the element', async () => {
    const player = new SimplePlayer([makeRound()])
    const events: AudioInterruptedEvent[] = []
    player.on('interrupted', (e) => events.push(e as AudioInterruptedEvent))

    player.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockAudio.paused).toBe(false)

    setVisibility('hidden')
    await interruptAfterGrace(mockAudio)

    expect(events).toHaveLength(1)
    expect(events[0].phase).toBe('prompt')
    expect(events[0].hidden).toBe(true)
    // An outside pause IS a pause: the engine lands paused, in place.
    expect(player.currentState.isPlaying).toBe(false)
    expect(player.currentState.phase).toBe('prompt')
    expect(player.currentState.cycleIndex).toBe(0)
  })

  it('records an interruption that lands during the SILENT pause clip', async () => {
    // The intermittent case: no stall watchdog runs during the pause phase, and
    // the trim timer is frozen while backgrounded, so nothing else notices.
    const player = new SimplePlayer([makeRound()])
    const events: AudioInterruptedEvent[] = []
    player.on('interrupted', (e) => events.push(e as AudioInterruptedEvent))

    player.play()
    await vi.advanceTimersByTimeAsync(0)
    mockAudio._handlers.ended?.() // prompt audio finished → pause phase
    await vi.advanceTimersByTimeAsync(0)
    expect(player.currentState.phase).toBe('pause')

    await interruptAfterGrace(mockAudio)

    expect(events).toHaveLength(1)
    expect(events[0].duringSilentClip).toBe(true)
  })

  it('does NOT treat our own stops as interruptions', async () => {
    const player = new SimplePlayer([makeRound()])
    const events: AudioInterruptedEvent[] = []
    player.on('interrupted', (e) => events.push(e as AudioInterruptedEvent))

    player.play()
    await vi.advanceTimersByTimeAsync(0)
    // Every one of these stops the element (and so fires 'pause'): a phase
    // advance re-assigning src, a skip, and the learner's own pause.
    mockAudio._handlers.ended?.()
    await vi.advanceTimersByTimeAsync(0)
    player.skipToPhase('voice1')
    await vi.advanceTimersByTimeAsync(0)
    player.pause()
    await vi.advanceTimersByTimeAsync(0)

    expect(events).toHaveLength(0)
  })

  it('notices a dropped pause event on return to the foreground (silent clip)', async () => {
    // Belt-and-braces: a backgrounded tab can lose the 'pause' task entirely.
    // Returning to visible with the session "playing" but the silent clip
    // stopped is unambiguous evidence of the same interruption.
    const player = new SimplePlayer([makeRound()])
    const events: AudioInterruptedEvent[] = []
    player.on('interrupted', (e) => events.push(e as AudioInterruptedEvent))

    player.play()
    await vi.advanceTimersByTimeAsync(0)
    mockAudio._handlers.ended?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(player.currentState.phase).toBe('pause')

    // The OS stopped it and no event reached us.
    setVisibility('hidden')
    mockAudio.paused = true
    await vi.advanceTimersByTimeAsync(500) // past SELF_STOP_GRACE_MS

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(events).toHaveLength(1)
    expect(events[0].duringSilentClip).toBe(true)
  })
})

describe('An outside pause is a pause — nothing resumes or advances on its own', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    setVisibility('visible')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setVisibility('visible')
  })

  it('lands the conductor in userPaused and a return to visible changes nothing', async () => {
    const player = new SimplePlayer([makeRound()])
    const conductor = new PlayerConductor(player as unknown as ConductorEngine, { devGuard: false })

    conductor.request((e) => e.play())
    await vi.advanceTimersByTimeAsync(0)
    const playsBefore = mockAudio.play.mock.calls.length

    setVisibility('hidden')
    await interruptAfterGrace(mockAudio)
    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
    expect(player.currentState.isPlaying).toBe(false)

    // Back in the app. This used to be the auto-resume trigger.
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(player.currentState.isPlaying).toBe(false)
    expect(mockAudio.play.mock.calls.length).toBe(playsBefore)
    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
  })

  it('the stall watchdog cannot advance a session paused from outside (the phantom-progress path)', async () => {
    // FAILS on the pre-fix engine: the interruption was only recorded, the
    // 10s stall watchdog fired, SKIPPED the prompt as unheard, and play()ed
    // the pause clip and then voice1 — the session "determinedly" carried on.
    const player = new SimplePlayer([makeRound(), makeRound('S0001L02')])
    const failed: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failed.push(e as AudioFailedEvent))

    player.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(player.currentState.phase).toBe('prompt')
    const playsBefore = mockAudio.play.mock.calls.length

    await interruptAfterGrace(mockAudio)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(player.currentState.phase).toBe('prompt')
    expect(player.currentState.roundIndex).toBe(0)
    expect(player.currentState.isPlaying).toBe(false)
    expect(failed).toHaveLength(0)
    expect(mockAudio.play.mock.calls.length).toBe(playsBefore)
  })

  it('the pause trim timer cannot end a PAUSE phase interrupted from outside', async () => {
    const player = new SimplePlayer([makeRound()])

    player.play()
    await vi.advanceTimersByTimeAsync(0)
    mockAudio._handlers.ended?.() // prompt finished → pause phase (4000ms)
    await vi.advanceTimersByTimeAsync(0)
    expect(player.currentState.phase).toBe('pause')
    const playsBefore = mockAudio.play.mock.calls.length

    await interruptAfterGrace(mockAudio)
    await vi.advanceTimersByTimeAsync(20_000)

    expect(player.currentState.phase).toBe('pause')
    expect(player.currentState.isPlaying).toBe(false)
    expect(mockAudio.play.mock.calls.length).toBe(playsBefore)
  })

  it("the learner's tap replays the current cycle from the prompt", async () => {
    const player = new SimplePlayer([makeRound()])
    const conductor = new PlayerConductor(player as unknown as ConductorEngine, { devGuard: false })

    conductor.request((e) => e.play())
    await vi.advanceTimersByTimeAsync(0)
    mockAudio._handlers.ended?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(player.currentState.phase).toBe('pause')
    await interruptAfterGrace(mockAudio)
    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
    const playsBefore = mockAudio.play.mock.calls.length

    conductor.request((e) => e.resume())
    await vi.advanceTimersByTimeAsync(0)

    expect(player.currentState.isPlaying).toBe(true)
    expect(player.currentState.phase).toBe('prompt')
    expect(mockAudio.play.mock.calls.length).toBeGreaterThan(playsBefore)
    expect(conductor.currentState).toEqual({ kind: 'playing' })
  })

  it('a learner pause after an interruption stays a pause', async () => {
    const player = new SimplePlayer([makeRound()])
    const conductor = new PlayerConductor(player as unknown as ConductorEngine, { devGuard: false })

    conductor.request((e) => e.play())
    await vi.advanceTimersByTimeAsync(0)
    await interruptAfterGrace(mockAudio)
    conductor.request((e) => e.pause())
    const playsBefore = mockAudio.play.mock.calls.length

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(1000)
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(player.currentState.isPlaying).toBe(false)
    expect(mockAudio.play.mock.calls.length).toBe(playsBefore)
    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
  })
})
