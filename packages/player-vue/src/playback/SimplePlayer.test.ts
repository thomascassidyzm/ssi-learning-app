import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type AudioFailedEvent, type Round } from './SimplePlayer'

// The background-safe PAUSE clip is a self-contained silent WAV data: URI
// (see buildSilentWavDataUri in SimplePlayer.ts). It's module-private, but it's
// the only src the player ever sets that starts with this prefix — every real
// audio track in these fixtures is an https:// URL — so the prefix uniquely
// identifies "the pause clip is sounding on the element".
const SILENT_PAUSE_CLIP_PREFIX = 'data:audio/wav;base64,'
const isSilentPauseClip = (src: string) => src.startsWith(SILENT_PAUSE_CLIP_PREFIX)

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

  it('splices in behind-rounds the cold queue is missing, keeping the live cycle', () => {
    // Cold bootstrap: only loaded forward from the resume round (S0001L03
    // = roundNumber 103), so rounds 101/102 are absent. Player is mid-round
    // on cycle 4. Full script lands with rounds 101..110. Expect the missing
    // behind-rounds (101,102) prepended, the live round kept verbatim, and
    // the cursor shifted to still point at it — cycleIndex untouched.
    const bootstrap = ['S0001L03', 'S0001L04', 'S0001L05'].map(makeRound)
    const player = new SimplePlayer(bootstrap)
    for (const r of (player as any).rounds) r.__source = 'bootstrap'
    ;(player as any).state.roundIndex = 0   // playing the resume round (103)
    ;(player as any).state.cycleIndex = 4   // mid-round

    const fullScript = ['S0001L01', 'S0001L02', 'S0001L03', 'S0001L04', 'S0001L05',
                        'S0001L06', 'S0001L07', 'S0001L08', 'S0001L09', 'S0001L10'].map(makeRound)
    for (const r of fullScript) (r as any).__source = 'fullscript'

    player.replaceQueueFromCurrent(fullScript)

    const after = (player as any).rounds
    expect(after).toHaveLength(10)
    expect(after.map((r: any) => r.roundNumber)).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110])
    // Behind-rounds came from the full script; the live round stayed verbatim
    expect(after[0].__source).toBe('fullscript')      // 101 spliced in
    expect(after[2].__source).toBe('bootstrap')        // 103 kept verbatim (live)
    // Cursor followed the live round, cycle preserved
    expect((player as any).state.roundIndex).toBe(2)   // shifted by the 2 prepended
    expect((player as any).state.cycleIndex).toBe(4)   // untouched
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

describe('SimplePlayer.addRounds', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(makeMockAudio))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not disturb the actively-playing round when merging rounds ahead of it', () => {
    // Regression guard for the INF-PLAY idle warm (belt-jump latency fix):
    // merging main-loop rounds into the queue while INF PLAY is actively
    // playing must leave the live round/cycle untouched, only shifting the
    // index so it still points at the same round object.
    const infplay = ['S0500L01', 'S0500L02'].map(makeRound)
    const player = new SimplePlayer(infplay)
    ;(player as any).state.roundIndex = 1 // playing S0500L02
    ;(player as any).state.cycleIndex = 0
    const livePlayingRound = (player as any).rounds[1]

    const mainLoop = ['S0001L01', 'S0002L01', 'S0003L01'].map(makeRound)
    player.addRounds(mainLoop)

    const after = (player as any).rounds
    // Main-loop rounds inserted ahead of the still-live INF-PLAY rounds.
    expect(after.map((r: any) => r.legoId)).toEqual([
      'S0001L01', 'S0002L01', 'S0003L01', 'S0500L01', 'S0500L02',
    ])
    // roundIndex shifted by the 3 prepended rounds — still pointing at the
    // exact same round object that was playing before the merge.
    expect((player as any).state.roundIndex).toBe(4)
    expect(after[4]).toBe(livePlayingRound)
    expect((player as any).state.cycleIndex).toBe(0)
  })

  it('inserting before the cursor emits state_changed with the shifted roundIndex', () => {
    // Regression for plan 006: addRounds used to bump this.state.roundIndex
    // directly, bypassing updateState and therefore the state_changed event —
    // so the persisted position, progress UI, and expansion-watcher chain read
    // a stale index until some unrelated state change. It must emit once with
    // the shifted index, exactly like the appendRounds sibling.
    const infplay = ['S0500L01', 'S0500L02'].map(makeRound)
    const player = new SimplePlayer(infplay)
    ;(player as any).state.roundIndex = 1 // playing S0500L02
    ;(player as any).state.cycleIndex = 0

    const seen: number[] = []
    player.on('state_changed', (s) => seen.push((s as { roundIndex: number }).roundIndex))

    // Two rounds sort before the cursor → index must shift 1 → 3.
    player.addRounds(['S0001L01', 'S0002L01'].map(makeRound))

    expect((player as any).state.roundIndex).toBe(3)
    // A state_changed fired carrying the new index (not left silent).
    expect(seen).toContain(3)
  })

  it('inserting only AFTER the cursor does not shift the index and emits no cursor change', () => {
    const initial = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(initial)
    ;(player as any).state.roundIndex = 0 // playing S0001L01
    const seen: number[] = []
    player.on('state_changed', (s) => seen.push((s as { roundIndex: number }).roundIndex))

    player.addRounds(['S0003L01', 'S0004L01'].map(makeRound)) // both sort AFTER cursor

    expect((player as any).state.roundIndex).toBe(0)
    expect(seen).toEqual([]) // no updateState → no spurious cursor event
  })

  it('dedupes by legoId — a round already in the queue is not re-inserted', () => {
    const initial = ['S0001L01', 'S0001L02'].map(makeRound)
    const player = new SimplePlayer(initial)
    player.addRounds(['S0001L01', 'S0001L03'].map(makeRound))
    const after = (player as any).rounds
    expect(after.map((r: any) => r.legoId)).toEqual(['S0001L01', 'S0001L02', 'S0001L03'])
  })

  it('no-ops on empty batch', () => {
    const initial = ['S0001L01'].map(makeRound)
    const player = new SimplePlayer(initial)
    player.addRounds([])
    expect((player as any).rounds).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Background-safe PAUSE phase.
//
// The existing fixtures bake pauseDuration:0, which routes prompt→voice1
// directly and never enters the pause path. These tests use a real
// pauseDuration so the player plays the silent one-shot clip on the audio
// element and advances pause→voice1 on EITHER the clip's 'ended' OR the trim
// timer, single-guarded against a double advance. See SimplePlayer.ts
// startPausePhase / endPausePhase / clearPauseTimer / onAudioEnded.
// ---------------------------------------------------------------------------
describe('SimplePlayer — background-safe pause', () => {
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

  // A round whose single cycle has a real pause window, so the pause phase
  // actually runs (the shared makeRound() bakes pauseDuration:0).
  function makePausingRound(legoId: string, pauseDuration = 6000): Round {
    const r = makeRound(legoId)
    r.cycles[0].pauseDuration = pauseDuration
    return r
  }

  // startPhase awaits resolveUrl before setting audio.src, so the element's
  // src for a newly-started phase only updates on the next microtask. Flush a
  // couple of microtask turns so assertions see the post-await src.
  async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
  }

  // Drive a freshly-played player up to the start of the pause phase: play()
  // starts prompt (known audio), the prompt's 'ended' advances prompt→pause.
  // startPausePhase sets the silent-clip src synchronously, so no flush needed
  // to observe the pause clip — but we flush to settle the prompt's play().
  async function enterPause(player: SimplePlayer): Promise<void> {
    player.play()                 // → prompt, known audio playing
    await flush()
    mockAudio._endedHandler!()    // known 'ended' → onAudioEnded → pause
    await flush()
  }

  it('1. entering pause plays a one-shot silent clip and does NOT advance to voice1 yet', async () => {
    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    await enterPause(player)

    expect(player.currentState.phase).toBe('pause')
    // The silent clip is now the element's source, played non-looping.
    expect(isSilentPauseClip(mockAudio.src)).toBe(true)
    expect(mockAudio.loop).toBe(false)
    expect((player as any).pauseClipActive).toBe(true)
    // It must NOT have jumped to voice1: neither the clip's 'ended' nor the
    // trim timer has fired, so voice1Url has not been loaded.
    expect(mockAudio.src).not.toBe('https://example.com/t1.mp3')
  })

  it("2. the clip's 'ended' advances pause→voice1 (plays voice1Url)", async () => {
    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    await enterPause(player)
    expect(player.currentState.phase).toBe('pause')

    // Clip reaches its natural end → background-safe advance.
    mockAudio._endedHandler!()
    await flush()

    expect(player.currentState.phase).toBe('voice1')
    expect(mockAudio.src).toBe('https://example.com/t1.mp3')
  })

  it('3. the trim timer advances pause→voice1 exactly once (generation-guarded against a re-fire)', async () => {
    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    const phases: string[] = []
    player.on('phase_changed', (e) => phases.push((e as any).phase))
    await enterPause(player)
    expect(player.currentState.phase).toBe('pause')

    // Trim timer (pause duration) elapses → advance to voice1. endPausePhase
    // bumps playGeneration, so the now-stale trim callback can never re-advance.
    vi.advanceTimersByTime(6000)
    await flush()
    expect(player.currentState.phase).toBe('voice1')
    expect(mockAudio.src).toBe('https://example.com/t1.mp3')

    // voice1 was entered exactly once — the single trim-timer fire produced
    // exactly one pause→voice1 transition (no double advance).
    //
    // NOTE: we deliberately do NOT also fire a synthetic clip-'ended' here.
    // In a real browser endPausePhase calls audio.pause() then startPhase
    // re-points audio.src to voice1, so the silent clip's 'ended' can never
    // arrive after the timer wins — the only later 'ended' is voice1's own.
    // The generation guard the code documents protects the *timer* path; the
    // mirror ordering (clip ends first, then a stale timer) is covered by 3b.
    expect(phases.filter((p) => p === 'voice1')).toHaveLength(1)
  })

  it('3b. when the clip ends first, a late trim-timer fire does not double-advance', async () => {
    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    const phases: string[] = []
    player.on('phase_changed', (e) => phases.push((e as any).phase))
    await enterPause(player)

    // Clip 'ended' fires first → advances to voice1 and bumps playGeneration.
    mockAudio._endedHandler!()
    await flush()
    expect(player.currentState.phase).toBe('voice1')

    // The trim timer fires afterwards — must be a no-op (gen guard).
    vi.advanceTimersByTime(6000)
    await flush()
    expect(player.currentState.phase).toBe('voice1')
    expect(phases.filter((p) => p === 'voice1')).toHaveLength(1)
  })

  it('4. clearPauseTimer (skip/stop path) stops the clip and prevents the pause from advancing', async () => {
    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    await enterPause(player)
    expect((player as any).pauseClipActive).toBe(true)

    // skipToPhase / skipRound / stop / pause all route through clearPauseTimer.
    // Call it directly to assert its contract in isolation.
    ;(player as any).clearPauseTimer()

    expect((player as any).pauseClipActive).toBe(false)
    expect((player as any).pauseEndsAt).toBe(0)
    expect(mockAudio.pause).toHaveBeenCalled()

    // The trim timer, if it ever fires now, must NOT advance: still in pause,
    // clip no longer active, and endPausePhase guards on pauseClipActive.
    vi.advanceTimersByTime(6000)
    expect(player.currentState.phase).toBe('pause')
    expect(mockAudio.src).not.toBe('https://example.com/t1.mp3')
  })

  it('5. foregrounding (visibilitychange→visible) catches up the pause if it elapsed while hidden', async () => {
    // The visibility catch-up advances iff pauseEndsAt has already passed.
    // Drive the wall clock past pauseEndsAt WITHOUT firing the trim timer
    // (simulating iOS freezing the timer while backgrounded), then dispatch
    // a visibilitychange with the document visible.
    const baseNow = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow)

    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    await enterPause(player)
    expect(player.currentState.phase).toBe('pause')
    // pauseEndsAt = now + duration
    expect((player as any).pauseEndsAt).toBe(baseNow + 6000)

    // Advance only the wall clock past the pause window — the trim timer stays
    // frozen (we deliberately do NOT advance fake timers).
    nowSpy.mockReturnValue(baseNow + 7000)

    // happy-dom: document is visible by default. Fire the catch-up directly via
    // the handler the constructor registered (it reads document.visibilityState,
    // which is 'visible' here) — this is exactly what the visibilitychange
    // event dispatches.
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(player.currentState.phase).toBe('voice1')
    expect(mockAudio.src).toBe('https://example.com/t1.mp3')

    nowSpy.mockRestore()
  })

  it('6. a rejected silent-clip play() does NOT halt the cycle or emit audio_failed', async () => {
    // The pause clip is non-critical: if it can't sound, the trim timer still
    // advances. A play() rejection on the silent clip must be swallowed —
    // never trip needs-gesture / play-error, never stop the session.
    mockAudio.play = vi.fn(() => {
      // Reject only for the silent pause clip; real tracks resolve as normal
      // (matching the default mock's resolved-Promise contract).
      if (isSilentPauseClip(mockAudio.src)) {
        return Promise.reject(Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' }))
      }
      return Promise.resolve(undefined)
    }) as unknown as MockAudio['play']

    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    await enterPause(player)

    // Still cleanly in pause — not halted, no gesture/play-error emitted.
    expect(failedEvents).toHaveLength(0)
    expect(player.currentState.phase).toBe('pause')
    expect(player.currentState.isPlaying).toBe(true)

    // And the trim timer still carries the advance despite the clip not sounding.
    vi.advanceTimersByTime(6000)
    await flush()
    expect(player.currentState.phase).toBe('voice1')
    expect(mockAudio.src).toBe('https://example.com/t1.mp3')
  })

  it('6b. a thrown silent-clip play() (sync) does not halt the cycle', async () => {
    // Some environments throw synchronously from play(); startPausePhase wraps
    // the call in try/catch and falls through to the trim timer. Real tracks
    // return a resolved Promise as the default mock does.
    mockAudio.play = vi.fn(() => {
      if (isSilentPauseClip(mockAudio.src)) throw new Error('play threw')
      return Promise.resolve(undefined)
    }) as unknown as MockAudio['play']

    const player = new SimplePlayer([makePausingRound('S0001L01', 6000)])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    await enterPause(player)

    expect(failedEvents).toHaveLength(0)
    expect(player.currentState.phase).toBe('pause')

    vi.advanceTimersByTime(6000)
    await flush()
    expect(player.currentState.phase).toBe('voice1')
    expect(mockAudio.src).toBe('https://example.com/t1.mp3')
  })
})

// ---------------------------------------------------------------------------
// Plan 005: staleness guard on the awaited resolveUrl in startPhase.
//
// resolveUrl (offline/cache path) can take tens–hundreds of ms. If a jump
// supersedes the cycle while that await is pending, the superseded
// continuation must NOT play the old cycle's clip (that would be the
// audio/text desync CLAUDE.md forbids). It must go inert.
// ---------------------------------------------------------------------------
describe('SimplePlayer — stale awaited play is suppressed', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(makeMockAudio))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }

  it('does not play the old cycle audio when a jump occurs during resolveUrl', async () => {
    let release!: (v: string) => void
    const held = new Promise<string>((r) => { release = r })
    let call = 0
    // Round-0 known audio resolves SLOWLY (held); everything after is instant.
    const resolveAudioUrl = vi.fn((url: string) => {
      call += 1
      return call === 1 ? held : Promise.resolve(url)
    })
    const player = new SimplePlayer(
      [makeRound('S0001L01'), makeRound('S0002L01')],
      { resolveAudioUrl },
    )
    const playAudioSpy = vi.spyOn(player as unknown as { playAudio: (u: string, t?: boolean) => void }, 'playAudio')

    player.play()            // startPhase('prompt') round 0 → awaits held
    await flush()
    // Supersede: jump to round 1 while round 0's resolve is still pending.
    ;(player as unknown as { jumpToRound: (i: number, c?: number) => void }).jumpToRound(1, 0)
    await flush()
    // The stale round-0 resolve finally completes — must be ignored.
    release('resolved://STALE-round0-known')
    await flush()

    const playedStale = playAudioSpy.mock.calls.some((c) => c[0] === 'resolved://STALE-round0-known')
    expect(playedStale).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Plan 013 Fix C: the play-path safety timer is a STALL detector, not an
// absolute 10s play deadline. A healthy clip that keeps progressing past 10s
// must not be force-advanced; a genuinely stalled element still advances.
// ---------------------------------------------------------------------------
describe('SimplePlayer — safety timer is a stall detector', () => {
  interface TimeMockAudio extends MockAudio {
    currentTime: number
    _timeUpdateHandler?: () => void
  }

  function makeTimeMockAudio(): TimeMockAudio {
    const a = makeMockAudio() as TimeMockAudio
    a.currentTime = 0
    const prev = a.addEventListener.getMockImplementation()!
    a.addEventListener.mockImplementation((event: string, handler: () => void) => {
      prev(event, handler)
      if (event === 'timeupdate' || event === 'loadedmetadata') a._timeUpdateHandler = handler
    })
    return a
  }

  let mockAudio: TimeMockAudio
  beforeEach(() => {
    mockAudio = makeTimeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not force-advance a clip that keeps progressing past 10s', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    ;(player as unknown as { state: { isPlaying: boolean } }).state.isPlaying = true
    const endedSpy = vi.spyOn(player as unknown as { onAudioEnded: () => void }, 'onAudioEnded')

    ;(player as unknown as { playAudio: (u: string) => void }).playAudio('https://example.com/long.mp3')

    // Healthy playback: currentTime advances and timeupdate fires every 5s,
    // well past the 10s window — each progress tick reschedules the watchdog.
    for (let i = 1; i <= 4; i++) {
      vi.advanceTimersByTime(5_000)
      mockAudio.currentTime = i * 5
      mockAudio._timeUpdateHandler?.()
    }

    expect(endedSpy).not.toHaveBeenCalled()
  })

  it('still advances a stalled clip that makes no progress for 10s', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    ;(player as unknown as { state: { isPlaying: boolean } }).state.isPlaying = true
    const endedSpy = vi.spyOn(player as unknown as { onAudioEnded: () => void }, 'onAudioEnded')

    ;(player as unknown as { playAudio: (u: string) => void }).playAudio('https://example.com/stalled.mp3')
    // No timeupdate / no currentTime progress at all.
    vi.advanceTimersByTime(10_000)

    expect(endedSpy).toHaveBeenCalled()
  })
})
