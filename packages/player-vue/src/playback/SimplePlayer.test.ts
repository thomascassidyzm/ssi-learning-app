import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type AudioFailedEvent, type Round } from './SimplePlayer'
import { PlayerConductor, type ConductorEngine } from './PlayerConductor'

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
  _timeUpdateHandler?: () => void
  currentTime?: number
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
    if (event === 'timeupdate') a._timeUpdateHandler = handler
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
    // prefetchUrl fires best-effort GETs; with fake timers driven async these
    // reach happy-dom's real fetch and get aborted at teardown, spraying the
    // run with AbortError noise. Stub it — prefetchUrl ignores the result.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does NOT emit audio_failed after repeated safety timeouts — ploughs on instead', async () => {
    // Learner experience must never stall on a broken UUID / 404 / stall.
    // The old circuit breaker halted after 3 failures; now we log and advance.
    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    for (let i = 0; i < 5; i++) {
      // ...ByTimeAsync, not ...ByTime: startPhase awaits resolveUrl, so the
      // microtask queue must drain between timer fires or playAudio never runs
      // at all and we'd be measuring a scenario the browser can't produce.
      await vi.advanceTimersByTimeAsync(10_000)
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
// Round-skip (lego_skip) navigation — the header ‹‹ ›› chevron steps exactly
// one round via jumpToRound(currentIndex ± 1). Regression guard for the
// 2026-07-21 round-skip freeze (live session 0c4bc301): LearningPlayer.vue's
// forward handler grew the queue via a bare `simplePlayer.addRounds(...)`
// call that updated the ENGINE's rounds array but never the component's own
// `cachedRounds` mirror used to bound-check and resolve the jump target — so
// once the learner reached the loaded edge, the mirror's length never grew,
// the bound check stayed permanently true, and forward-skip silently no-oped
// forever (identical fromLegoId/roundNumber/slot on every repeated tap). The
// fix routes that path through mergeGeneratedRoundsIntoQueue, which updates
// both. These tests cover the underlying engine contract the fix relies on.
// ---------------------------------------------------------------------------
describe('SimplePlayer — round-skip navigation', () => {
  it('repeated forward jumpToRound calls advance the round index monotonically', () => {
    const rounds = ['S0001L01', 'S0002L01', 'S0003L01', 'S0004L01', 'S0005L01'].map(makeRound)
    const player = new SimplePlayer(rounds)

    const seenIndices: number[] = []
    for (let i = 0; i < rounds.length - 1; i++) {
      const fromIdx = player.currentState.roundIndex
      player.jumpToRound(fromIdx + 1)
      seenIndices.push(player.currentState.roundIndex)
    }

    expect(seenIndices).toEqual([1, 2, 3, 4])
    // Monotonically increasing — never stuck repeating the same index.
    for (let i = 1; i < seenIndices.length; i++) {
      expect(seenIndices[i]).toBeGreaterThan(seenIndices[i - 1])
    }
    expect(player.currentRound?.legoId).toBe('S0005L01')
  })

  it('jumpToRound resets cycleIndex (slot) to 0, reflecting the landed position', () => {
    const rounds = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(rounds)
    ;(player as any).state.cycleIndex = 0
    player.jumpToRound(1)
    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentState.cycleIndex).toBe(0)
  })

  it('jumpToRound is a no-op past the last loaded round (out of bounds)', () => {
    const rounds = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(rounds)
    player.jumpToRound(1)
    player.jumpToRound(2) // out of bounds — only 2 rounds loaded
    // Stays at the last valid round rather than silently corrupting state.
    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentRound?.legoId).toBe('S0002L01')
  })

  it('regression: growing the engine queue without updating an external mirror freezes forward nav at the loaded edge', () => {
    // Models the exact bug: a caller (LearningPlayer.vue) tracks its own
    // `cachedRounds` mirror to bound-check + resolve the jump target, and
    // must keep it synced with every addRounds/appendRounds call.
    const initial = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(initial)
    const cachedRoundsMirror = [...initial] // the buggy path: never updated below

    const attemptForwardSkip = () => {
      const fromIdx = player.currentState.roundIndex
      const targetIdx = fromIdx + 1
      if (targetIdx >= cachedRoundsMirror.length) {
        // Buggy path: grows the ENGINE's queue but forgets the mirror.
        player.addRounds(['S0003L01'].map(makeRound))
        // (no `cachedRoundsMirror = [...cachedRoundsMirror, ...newRounds]` here)
      }
      if (targetIdx >= cachedRoundsMirror.length) {
        return false // "staying put" — the observed freeze
      }
      player.jumpToRound(targetIdx)
      return true
    }

    expect(attemptForwardSkip()).toBe(true) // S0001L01 → S0002L01, still within the original mirror
    expect(player.currentState.roundIndex).toBe(1)

    // Second tap: engine now HAS a 3rd round (added above by the first tap's
    // regen), but the stale mirror still reports length 2 — every subsequent
    // tap no-ops forever, reproducing the live-session freeze.
    expect(attemptForwardSkip()).toBe(false)
    expect(player.currentState.roundIndex).toBe(1) // frozen
    expect(attemptForwardSkip()).toBe(false)
    expect(player.currentState.roundIndex).toBe(1) // still frozen
  })

  it('fix: keeping the mirror in lockstep with addRounds lets forward nav reach newly-loaded rounds', () => {
    const initial = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(initial)
    let cachedRoundsMirror = [...initial]

    const attemptForwardSkip = () => {
      const fromIdx = player.currentState.roundIndex
      const targetIdx = fromIdx + 1
      if (targetIdx >= cachedRoundsMirror.length) {
        const newRounds = ['S0003L01'].map(makeRound)
        player.addRounds(newRounds)
        cachedRoundsMirror = [...cachedRoundsMirror, ...newRounds] // kept in sync — the fix
      }
      if (targetIdx >= cachedRoundsMirror.length) return false
      player.jumpToRound(targetIdx)
      return true
    }

    expect(attemptForwardSkip()).toBe(true)
    expect(player.currentState.roundIndex).toBe(1)
    expect(attemptForwardSkip()).toBe(true) // reaches the freshly-regenerated round
    expect(player.currentState.roundIndex).toBe(2)
    expect(player.currentRound?.legoId).toBe('S0003L01')
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
    // prefetchUrl fires best-effort GETs; with fake timers driven async these
    // reach happy-dom's real fetch and get aborted at teardown, spraying the
    // run with AbortError noise. Stub it — prefetchUrl ignores the result.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
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
// Fix C (skip/audio sync): every skip/jump entry point must STOP playback
// cleanly (pause + invalidate the play generation) BEFORE repositioning, then
// rebuild the audio source atomically. Root cause of the field bug: jumpToRound
// used to reset audio.src to '' mid-reposition (a same-tick MEDIA_ERR
// SRC_NOT_SUPPORTED / code 4 waiting to happen) and no skip path bumped
// playGeneration synchronously before repositioning — so a stale error/
// rejection belonging to the pre-skip cycle could still reach
// handleAudioFailure/onErrorHandler after startPhase() had already reset
// `phase` away from 'idle' in the very same synchronous call, misattributing
// the failure to the freshly-repositioned cycle (retry/halt against the
// WRONG src, or a halt requiring a manual tap-to-resume).
// ---------------------------------------------------------------------------
describe('SimplePlayer — skip/reposition audio-sync invariant', () => {
  let mockAudio: MockAudio & { srcHistory: string[] }

  function makeTrackedMockAudio(): MockAudio & { srcHistory: string[] } {
    const base = makeMockAudio() as MockAudio & { srcHistory: string[] }
    const srcHistory: string[] = []
    let _src = ''
    Object.defineProperty(base, 'src', {
      get: () => _src,
      set: (v: string) => { _src = v; srcHistory.push(v) },
    })
    base.srcHistory = srcHistory
    return base
  }

  beforeEach(() => {
    mockAudio = makeTrackedMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }

  it('skipRound never assigns an empty/invalid src while repositioning — no manufactured MEDIA_ERR', async () => {
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    player.play()
    await flush()
    player.skipRound()
    await flush()

    // Every src ever assigned is a real audio URL — never the '' that used
    // to trigger a same-tick MEDIA_ERR_SRC_NOT_SUPPORTED (code 4).
    expect(mockAudio.srcHistory.every((s) => s !== '')).toBe(true)
    expect(mockAudio.src).toBe('https://example.com/k.mp3') // round 2's prompt
  })

  it('jumpToRound (belt-jump / cycle-skip primitive) never assigns an empty src either', async () => {
    const player = new SimplePlayer(['S0001L01', 'S0002L01', 'S0003L01'].map(makeRound))
    player.play()
    await flush()
    player.jumpToRound(2)
    await flush()

    expect(mockAudio.srcHistory.every((s) => s !== '')).toBe(true)
    expect(player.currentState.roundIndex).toBe(2)
  })

  it('a stale error arriving while startPhase awaits resolveUrl for the post-skip cycle is ignored (phase already flipped back to prompt)', async () => {
    // Reproduces the exact race: stopForReposition bumps playGeneration
    // synchronously, but the post-skip cycle's own src assignment (and its
    // matching lastAssignedSrcGen) only lands once the awaited resolveUrl
    // resolves. In that window `phase` is already 'prompt' (not idle/pause/
    // buffering, so the old phase-only guard doesn't help) — only the
    // generation guard protects it.
    let release!: (v: string) => void
    const held = new Promise<string>((r) => { release = r })
    let call = 0
    const resolveAudioUrl = vi.fn((url: string) => {
      call += 1
      return call === 1 ? Promise.resolve(url) : held
    })
    const player = new SimplePlayer(
      ['S0001L01', 'S0002L01'].map(makeRound),
      { resolveAudioUrl },
    )
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play() // round 0 prompt resolves instantly (call 1)
    await flush()

    player.skipRound() // bumps generation, repositions to round 1, awaits the HELD resolveUrl (call 2)
    await flush()
    expect(player.currentState.phase).toBe('prompt') // not idle/pause/buffering — the vulnerable window

    // Browser fires a stale error (e.g. for the round-0 audio pause() aborted)
    // while still waiting on round 1's resolveUrl.
    mockAudio._errorHandler!(new Event('error'))
    await flush()

    expect(failedEvents).toHaveLength(0)
    expect(player.currentState.isPlaying).toBe(true)

    // The held resolve finally lands — playback proceeds normally.
    release('https://example.com/k.mp3')
    await flush()
    expect(mockAudio.src).toBe('https://example.com/k.mp3')
  })

  it('every skip path pauses the audio element before repositioning (stop-then-reposition ordering)', async () => {
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    player.play()
    await flush()

    const roundIndexAtPauseCall: number[] = []
    mockAudio.pause.mockImplementation(() => {
      roundIndexAtPauseCall.push(player.currentState.roundIndex)
    })

    player.skipRound()
    await flush()

    // pause() must have been observed with the PRE-skip roundIndex (0) —
    // i.e. playback was stopped before the reposition to round 1 landed.
    expect(roundIndexAtPauseCall[0]).toBe(0)
    expect(player.currentState.roundIndex).toBe(1)
  })

  it('cycle-skip (stepCycle) keeps audio and display in lockstep across a round boundary', async () => {
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    player.play() // round 0, prompt phase (known audio)
    await flush()
    mockAudio._endedHandler!() // prompt → pause (pauseDuration:0 → voice1 directly)
    await flush()
    expect(player.currentState.phase).toBe('voice1')
    expect(mockAudio.src).toBe('https://example.com/t1.mp3')

    // Mid-voice1, learner taps skip-forward (cycle-skip). Only cycle in each
    // round, so this crosses the round boundary to round 1's cycle 0.
    player.stepCycle(1)
    await flush()

    // Display (currentRound/currentCycle) and audio.src must agree on round 1.
    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentCycle?.known.text).toBe('hello')
    expect(mockAudio.src).toBe('https://example.com/k.mp3') // round 1's prompt, not a repeat of round 0's voice1
  })

  it('skipToPhase stops playback before jumping phase — no stale audio_failed from the previous phase', async () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    await flush()
    mockAudio._endedHandler!() // prompt → voice1
    await flush()
    expect(player.currentState.phase).toBe('voice1')

    player.skipToPhase('prompt')
    await flush()

    expect(mockAudio.srcHistory.every((s) => s !== '')).toBe(true)
    expect(player.currentState.phase).toBe('prompt')
    expect(failedEvents).toHaveLength(0)
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
    // prefetchUrl fires best-effort GETs; with fake timers driven async these
    // reach happy-dom's real fetch and get aborted at teardown, spraying the
    // run with AbortError noise. Stub it — prefetchUrl ignores the result.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
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

// ---------------------------------------------------------------------------
// Skip-bug regression suite (2026-07-21 staging report):
//   1. round-skip (skipRound) advances exactly one round.
//   2. cycle-skip (stepCycle) keeps the audio that plays and the
//      round/cycle the display reads in lockstep — both derive from the
//      SAME engine state, never a separately-tracked copy.
//   3. every skip primitive (skipRound / stepCycle / jumpToRound) stops
//      the audio element BEFORE repositioning, never leaving stale audio
//      sounding under the new display.
// ---------------------------------------------------------------------------
describe('SimplePlayer — skip actions', () => {
  let mockAudio: MockAudio
  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skipRound advances exactly one round, not more, not zero', () => {
    const rounds = ['S0001L01', 'S0002L01', 'S0003L01'].map(makeRound)
    const player = new SimplePlayer(rounds)
    expect(player.currentState.roundIndex).toBe(0)

    player.skipRound()

    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentRound?.legoId).toBe('S0002L01')

    player.skipRound()

    expect(player.currentState.roundIndex).toBe(2)
    expect(player.currentRound?.legoId).toBe('S0003L01')
  })

  it('skipRound stops the audio element before repositioning', () => {
    const rounds = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(rounds)
    ;(player as unknown as { state: { isPlaying: boolean } }).state.isPlaying = true
    mockAudio.paused = false

    player.skipRound()

    expect(mockAudio.pause).toHaveBeenCalled()
  })

  it('stepCycle(1) crossing a round boundary: currentRound/currentCycle and the audio played always agree on the SAME destination', async () => {
    // Single-cycle rounds — every forward step crosses a round boundary,
    // so this exercises exactly the "cycle-skip rolls into the next round"
    // path the mid-screen chevron uses.
    const rounds = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(rounds)
    player.play()
    await Promise.resolve()
    await Promise.resolve()
    expect(player.currentRound?.legoId).toBe('S0001L01')

    const playAudioSpy = vi.spyOn(player as unknown as { playAudio: (u: string, t?: boolean) => void }, 'playAudio')
    ;(player as unknown as { stepCycle: (d: 1 | -1) => void }).stepCycle(1)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Display (state/currentRound/currentCycle) landed on round 2.
    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentRound?.legoId).toBe('S0002L01')
    // Audio played is for the SAME round's known text — never the round-1
    // clip repeating under round-2's displayed text.
    const lastPlayedUrl = playAudioSpy.mock.calls[playAudioSpy.mock.calls.length - 1]?.[0]
    expect(lastPlayedUrl).toBe(rounds[1].cycles[0].known.audioUrl)
  })

  it('stepCycle stops the current audio before playing the destination cycle', () => {
    const rounds = ['S0001L01', 'S0002L01'].map(makeRound)
    const player = new SimplePlayer(rounds)
    ;(player as unknown as { state: { isPlaying: boolean } }).state.isPlaying = true
    mockAudio.paused = false
    mockAudio.src = 'https://example.com/round1-in-flight.mp3'

    ;(player as unknown as { stepCycle: (d: 1 | -1) => void }).stepCycle(1)

    // jumpToRound (which stepCycle routes through) must have paused +
    // cleared the in-flight round-1 audio synchronously, before anything
    // for round 2 is queued.
    expect(mockAudio.pause).toHaveBeenCalled()
  })

  it('jumpToRound stops the audio element before repositioning, regardless of play state', () => {
    const rounds = ['S0001L01', 'S0002L01', 'S0003L01'].map(makeRound)
    const player = new SimplePlayer(rounds)
    ;(player as unknown as { state: { isPlaying: boolean } }).state.isPlaying = true
    mockAudio.paused = false

    ;(player as unknown as { jumpToRound: (i: number, c?: number) => void }).jumpToRound(2)

    expect(mockAudio.pause).toHaveBeenCalled()
    expect(player.currentState.roundIndex).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Round-boundary interlude regression (staging stall, 2026-07-23).
//
// LearningPlayer wraps handleRoundBoundaryBody in conductor.runInterlude
// ('round-boundary') on EVERY round completion. runInterlude used to pause
// the engine eagerly on entry while trusting the body to decide its own
// landing on success — but the body's plain no-interlude path (no commentary,
// no pod, no L1 cup due) plays nothing and makes no landing decision, so
// every ordinary boundary stranded the player paused until a manual tap
// (telemetry: round_complete → next round's first audio_play logs → silence
// → manual tap_play ~7s later replaying the SAME cycleId).
//
// These tests wire a REAL SimplePlayer to a REAL PlayerConductor (the same
// pairing useSimplePlayer.initialize() creates) and drive an actual round
// boundary through the audio element's 'ended' events, asserting the next
// round's first cycle reaches playing state without user input — both when
// no interlude is due and when one is.
// ---------------------------------------------------------------------------
describe('SimplePlayer + PlayerConductor — round boundary continues into the next round', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    // prefetchUrl fires best-effort GETs; with fake timers driven async these
    // reach happy-dom's real fetch and get aborted at teardown, spraying the
    // run with AbortError noise. Stub it — prefetchUrl ignores the result.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // startPhase awaits resolveUrl before touching audio.src — flush a few
  // microtask turns so assertions see the post-await state.
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }

  // Drive the current cycle to completion: prompt 'ended' → (pause 0) →
  // voice1 'ended' → voice2 'ended' → advanceCycle → advanceRound.
  // makeRound bakes pauseDuration:0, so pause is skipped entirely.
  const completeCurrentCycle = async (): Promise<void> => {
    mockAudio._endedHandler!() // prompt (known) ends → voice1
    await flush()
    mockAudio._endedHandler!() // voice1 ends → voice2
    await flush()
    mockAudio._endedHandler!() // voice2 ends → next cycle / next round
    await flush()
  }

  function makeDistinctRound(legoId: string, knownUrl: string): Round {
    const r = makeRound(legoId)
    r.cycles[0].known.audioUrl = knownUrl
    return r
  }

  it('no interlude due: playback flows into the next round without user input', async () => {
    const rounds = [
      makeDistinctRound('S0001L01', 'https://example.com/r1-known.mp3'),
      makeDistinctRound('S0001L02', 'https://example.com/r2-known.mp3'),
    ]
    const player = new SimplePlayer(rounds)
    const conductor = new PlayerConductor(player as unknown as ConductorEngine, { devGuard: false })

    // Mirror LearningPlayer's onRoundCompleted: fire-and-forget interlude
    // wrapper whose body finds nothing due and does nothing.
    const interludes: Array<Promise<void>> = []
    player.on('round_completed', () => {
      interludes.push(conductor.runInterlude('round-boundary', async () => {
        // No commentary, no pod, no L1 — nothing due at this boundary.
      }))
    })

    conductor.request((e) => e.play())
    await flush()
    expect(mockAudio.src).toBe('https://example.com/r1-known.mp3')

    await completeCurrentCycle()
    await Promise.all(interludes)
    await flush()

    // The next round's first cycle must actually be playing — no stall.
    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentState.isPlaying).toBe(true)
    expect(player.currentState.phase).toBe('prompt')
    expect(mockAudio.src).toBe('https://example.com/r2-known.mp3')
    expect(conductor.currentState).toEqual({ kind: 'playing' })
  })

  it('interlude due: lap plays (paused), then the next round\'s first cycle reaches playing state', async () => {
    const rounds = [
      makeDistinctRound('S0001L01', 'https://example.com/r1-known.mp3'),
      makeDistinctRound('S0001L02', 'https://example.com/r2-known.mp3'),
    ]
    const player = new SimplePlayer(rounds)
    const conductor = new PlayerConductor(player as unknown as ConductorEngine, { devGuard: false })

    let engineWasPausedDuringLap = false
    const interludes: Array<Promise<void>> = []
    player.on('round_completed', () => {
      // Mirror the pod path: synchronous pre-pause in the round_completed
      // listener (beats the race with advanceRound starting the next
      // prompt), then the interlude body plays its lap and resumes.
      conductor.request((e) => e.pause())
      interludes.push(conductor.runInterlude('round-boundary', async () => {
        engineWasPausedDuringLap = !player.currentState.isPlaying
        await Promise.resolve() // the lap's async audio playback
        conductor.request((e) => e.resume())
      }))
    })

    conductor.request((e) => e.play())
    await flush()
    await completeCurrentCycle()
    await Promise.all(interludes)
    await flush()

    expect(engineWasPausedDuringLap).toBe(true)
    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentState.isPlaying).toBe(true)
    expect(player.currentState.phase).toBe('prompt')
    expect(mockAudio.src).toBe('https://example.com/r2-known.mp3')
    expect(conductor.currentState).toEqual({ kind: 'playing' })
  })

  it('interlude due, learner stops mid-lap: stays paused (no forced resume on success)', async () => {
    const rounds = [
      makeDistinctRound('S0001L01', 'https://example.com/r1-known.mp3'),
      makeDistinctRound('S0001L02', 'https://example.com/r2-known.mp3'),
    ]
    const player = new SimplePlayer(rounds)
    const conductor = new PlayerConductor(player as unknown as ConductorEngine, { devGuard: false })

    const interludes: Array<Promise<void>> = []
    player.on('round_completed', () => {
      conductor.request((e) => e.pause())
      interludes.push(conductor.runInterlude('round-boundary', async () => {
        // Learner pressed stop during the lap — the body deliberately
        // lands paused (userStoppedDuringLap path). The conductor must
        // respect that on success, not force a resume.
        await Promise.resolve()
      }))
    })

    conductor.request((e) => e.play())
    await flush()
    await completeCurrentCycle()
    await Promise.all(interludes)
    await flush()

    expect(player.currentState.isPlaying).toBe(false)
    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
  })
})

// ---------------------------------------------------------------------------
// THE RULING: the player plays what it has. A clip that fails to load, is
// missing, or is slow is SKIPPED so the session continues — never a stall.
//
// Field report (Aran, 2026-08-06, German, item "with you"): playback hard-
// stopped on one item and would not restart. Skipping BACK reproduced it every
// time; only skipping FORWARD past it recovered. The server resolved all three
// clips correctly, so the stall was client-side.
//
// The mechanism: startPhase() awaited the resolveAudioUrl override with no
// timeout and no timer armed anywhere (the stall watchdog only exists once
// playAudio has been reached). AudioCache.getWavBlobUrl memoises its in-flight
// decode PER AUDIO ID, so one non-settling decode poisoned exactly one id
// forever — replaying the item re-awaited the same dead promise (skip BACK
// re-enters), every other id was untouched (skip FORWARD escapes).
// ---------------------------------------------------------------------------
describe('SimplePlayer — never stalls on one item (the ruling)', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    // prefetchUrl fires best-effort GETs; with fake timers driven async these
    // reach happy-dom's real fetch and get aborted at teardown, spraying the
    // run with AbortError noise. Stub it — prefetchUrl ignores the result.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }

  const distinctRound = (legoId: string, knownUrl: string): Round => {
    const r = makeRound(legoId)
    r.cycles[0].known.audioUrl = knownUrl
    return r
  }

  it('a resolveAudioUrl promise that NEVER settles cannot strand the phase — the network URL plays instead', async () => {
    // The exact stall: the per-cycle resolver (AudioCache.getWavBlobUrl →
    // mp3→WAV decode) hands back a promise that never settles. Before the fix
    // startPhase() awaited it with no timeout and no timer armed anywhere, so
    // the engine sat in 'prompt' with isPlaying true and NOTHING running.
    const neverSettles = new Promise<string>(() => { /* deliberately never */ })
    const resolveAudioUrl = vi.fn((url: string) =>
      url === 'https://example.com/r1-known.mp3' ? neverSettles : Promise.resolve(url),
    )
    const rounds = [
      distinctRound('S0001L01', 'https://example.com/r1-known.mp3'),
      distinctRound('S0001L02', 'https://example.com/r2-known.mp3'),
    ]
    const player = new SimplePlayer(rounds, { resolveAudioUrl })

    player.play()
    await flush()
    // The stalled window: phase entered, nothing playable yet.
    expect(player.currentState.phase).toBe('prompt')
    expect(mockAudio.src).toBe('')

    // Past the resolve bound the engine gives up on the resolver and plays the
    // original network URL — always a valid resource.
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(mockAudio.src).toBe('https://example.com/r1-known.mp3')
    expect(player.currentState.isPlaying).toBe(true)

    // And the session keeps moving: no 'ended' ever arrives from this mock
    // element, so the stall watchdogs carry it through the round and on.
    for (let i = 0; i < 40 && player.currentState.roundIndex === 0; i++) {
      await vi.advanceTimersByTimeAsync(5_000)
      await flush()
    }
    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentState.isPlaying).toBe(true)
  })

  it('when EVERY await on the path hangs, the phase watchdog skips the clip and playback continues', async () => {
    // Backstop test: both pre-play awaits hang (a wedged ensureKnownReady gate
    // AND a wedged resolver). Nothing can produce a playable URL, so the
    // phase-start watchdog must fire and advance rather than let the session
    // die on this one item — the ruling, enforced structurally.
    const never = <T,>() => new Promise<T>(() => { /* deliberately never */ })
    const player = new SimplePlayer(
      [distinctRound('S0001L01', 'https://example.com/r1-known.mp3')],
      { ensureKnownReady: () => never<void>(), resolveAudioUrl: () => never<string>() },
    )
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    await flush()
    expect(mockAudio.src).toBe('')

    const phasesSeen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(2_000)
      await flush()
      phasesSeen.add(player.currentState.phase)
    }

    // It did not sit in the entry phase forever — the machine moved on.
    expect(phasesSeen.size).toBeGreaterThan(1)
    // And it said so loudly, with the diagnostics payload intact.
    expect(failedEvents.some((e) => e.lastError === 'phase-watchdog-resolve-hang')).toBe(true)
  })

  it('a clip whose audio element errors on every attempt is skipped, not halted', async () => {
    // A permanently-unplayable clip (revoked blob URL, decode the device
    // refuses). Retry-then-HALT used to pause the session on this exact item
    // every single replay — the reproducible hard stop. It must now advance.
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    await flush()
    expect(player.currentState.phase).toBe('prompt')

    // First error → silent retry (attempt 1). Second → the clip is unplayable.
    mockAudio.error = { code: 4 } // MEDIA_ERR_SRC_NOT_SUPPORTED
    mockAudio._errorHandler!(new Event('error'))
    await flush()
    mockAudio._errorHandler!(new Event('error'))
    await flush()

    // Ruling: session continues. (Fixtures use pauseDuration 0, so prompt
    // advances straight to voice1.)
    expect(player.currentState.isPlaying).toBe(true)
    expect(player.currentState.phase).not.toBe('prompt')
    // Telemetry contract preserved: attempt=1 blip then attempt=2 failure.
    expect(failedEvents.map((e) => e.attempt)).toEqual([1, 2])
    expect(failedEvents.every((e) => e.reason === 'play-error')).toBe(true)
  })

  it('still HALTS on needs-gesture — skipping cannot help when the browser will play nothing', async () => {
    const notAllowed = Object.assign(new Error('User didn\'t interact'), { name: 'NotAllowedError' })
    mockAudio.play = vi.fn().mockRejectedValue(notAllowed)

    const player = new SimplePlayer([makeRound('S0001L01')])
    const failedEvents: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failedEvents.push(e as AudioFailedEvent))

    player.play()
    await flush()

    expect(failedEvents.map((e) => e.reason)).toEqual(['needs-gesture'])
    expect(player.currentState.isPlaying).toBe(false)
  })
})

describe('SimplePlayer — A-22: a dead audio id (404 from the proxy) never stops the session', () => {
  // The A-22 field case (learner "beunollyn", 2026-08-06): a bare
  // /api/audio/<uuid> for an audio id with NO ROW in course_audio. The proxy
  // answers with its 404 HTML page, so the media element gets a resource it
  // cannot decode and reports MEDIA_ERR_SRC_NOT_SUPPORTED (code 4). A 0.6s
  // clip cost a 39-second dead stall and the whole session.
  //
  // This differs from the "with you" stall these tests were first written for:
  // that one was a client-side promise that never settled, this one is a real
  // network 404. Same ruling, different trigger — the fence has to cover both.
  const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }

  /**
   * Drive one 404: the element errors, the player burns its silent retry, the
   * element errors again. That is the full life of an id that does not exist —
   * re-fetching a 404 gets another 404.
   */
  const fail404Once = async (): Promise<void> => {
    mockAudio.error = { code: MEDIA_ERR_SRC_NOT_SUPPORTED }
    mockAudio._errorHandler!(new Event('error'))
    await flush()
    mockAudio._errorHandler!(new Event('error'))
    await flush()
  }

  it('a 404 on the PROMPT clip skips that clip and plays on', async () => {
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    const failed: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failed.push(e as AudioFailedEvent))

    player.play()
    await flush()
    expect(player.currentState.phase).toBe('prompt')

    await fail404Once()

    expect(player.currentState.isPlaying).toBe(true)
    expect(player.currentState.phase).not.toBe('prompt')
    // Loud, with the diagnostics the admin surfaces group on.
    expect(failed.map((e) => e.attempt)).toEqual([1, 2])
    expect(failed.every((e) => e.reason === 'play-error')).toBe(true)
    expect(failed[1].errorCode).toBe(MEDIA_ERR_SRC_NOT_SUPPORTED)
    expect(failed[1].role).toBe('known')
  })

  it('a 404 on a TARGET clip skips that clip and plays on', async () => {
    // The A-22 clip was a target. Reaching voice1 means the prompt played
    // fine and only the target id is dead — the common shape when one row of
    // course_audio went missing rather than a whole cycle.
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    const failed: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failed.push(e as AudioFailedEvent))

    player.play()
    await flush()
    // Prompt plays cleanly, then 'ended' carries us into voice1.
    mockAudio._endedHandler!()
    await flush()
    expect(player.currentState.phase).toBe('voice1')

    await fail404Once()

    expect(player.currentState.isPlaying).toBe(true)
    expect(player.currentState.phase).not.toBe('voice1')
    expect(failed.map((e) => e.role)).toEqual(['target1', 'target1'])
  })

  it('a cycle whose THREE clips are all dead is walked through, not sat on', async () => {
    // The worst per-cycle case: the lego lost every one of its three audio
    // rows. The learner loses this item — that is the puncture — but the
    // session must drive on to the next round rather than stopping.
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    const failed: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failed.push(e as AudioFailedEvent))

    player.play()
    await flush()

    // prompt, voice1, voice2 — each 404s through retry.
    for (let i = 0; i < 3 && player.currentState.roundIndex === 0; i++) {
      await fail404Once()
      await vi.advanceTimersByTimeAsync(100)
      await flush()
    }

    expect(player.currentState.roundIndex).toBe(1)
    expect(player.currentState.isPlaying).toBe(true)
    // Every dead role was reported, so the release gate can hear about it.
    expect(new Set(failed.filter((e) => e.attempt === 2).map((e) => e.role)))
      .toEqual(new Set(['known', 'target1', 'target2']))
  })

  it('a whole ROUND of dead audio still leaves the learner driving forward', async () => {
    // A course whose audio import dropped a contiguous block: every clip in
    // round 1 is dead, round 2 is healthy. "A puncture on every wheel must
    // still leave the learner driving forward."
    const player = new SimplePlayer(['S0001L01', 'S0002L01', 'S0003L01'].map(makeRound))
    player.play()
    await flush()

    for (let i = 0; i < 12 && player.currentState.roundIndex === 0; i++) {
      await fail404Once()
      await vi.advanceTimersByTimeAsync(100)
      await flush()
    }

    expect(player.currentState.roundIndex).toBeGreaterThan(0)
    expect(player.currentState.isPlaying).toBe(true)
  })

  it('a 404 is NEVER mistaken for needs-gesture — a missing file is not a tap problem', async () => {
    // The one halt the ruling keeps is needs-gesture. If a 404 could reach it
    // the A-22 case would still stop the session, just by another door.
    // Browsers reject play() for an undecodable source with NotSupportedError.
    const notSupported = Object.assign(
      new Error('Failed to load because no supported source was found.'),
      { name: 'NotSupportedError' },
    )
    mockAudio.play = vi.fn().mockRejectedValue(notSupported)

    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    const failed: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failed.push(e as AudioFailedEvent))

    player.play()
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    await flush()

    expect(failed.some((e) => e.reason === 'needs-gesture')).toBe(false)
    // It did not sit on the first clip: it skipped through and reported each
    // dead clip as a play-error.
    expect(failed.filter((e) => e.reason === 'play-error' && e.attempt === 2).length)
      .toBeGreaterThan(0)
  })

  it('an entirely dead session races to the end in silence — the cost of never aborting', async () => {
    // ADVERSARIAL: skipping is instantaneous, so a course whose audio is
    // wholly missing does not stall — it burns the learner's whole queue in
    // milliseconds with nothing audible. That is the correct trade under the
    // ruling (a stall is worse), but it is NOT free, and this test pins the
    // behaviour so the cost stays visible rather than being discovered in the
    // field a second time. Every skipped clip is reported, which is what the
    // release gate and the admin diagnostics have to key on.
    const notSupported = Object.assign(
      new Error('Failed to load because no supported source was found.'),
      { name: 'NotSupportedError' },
    )
    mockAudio.play = vi.fn().mockRejectedValue(notSupported)

    const player = new SimplePlayer(['S0001L01', 'S0002L01', 'S0003L01'].map(makeRound))
    const failed: AudioFailedEvent[] = []
    let completed = false
    player.on('audio_failed', (e) => failed.push(e as AudioFailedEvent))
    player.on('session_complete', () => { completed = true })

    player.play()
    await flush()
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()

    // Three rounds x three clips, each reported dead — nothing was played and
    // nothing was hidden.
    const dead = failed.filter((e) => e.reason === 'play-error' && e.attempt === 2)
    expect(dead.length).toBe(9)
    expect(completed).toBe(true)
    // The silence is COUNTED, so a hollow session is legible downstream
    // instead of looking like nine unrelated one-off punctures.
    expect(dead[dead.length - 1].consecutiveSkips).toBe(9)
  })

  it('one bad clip among healthy ones is a puncture, not a silent session', async () => {
    // The counter must not cry wolf: a single dead clip surrounded by working
    // audio has to read as consecutiveSkips=1, and it must reset once real
    // playback progress is observed again.
    const player = new SimplePlayer(['S0001L01', 'S0002L01'].map(makeRound))
    const failed: AudioFailedEvent[] = []
    player.on('audio_failed', (e) => failed.push(e as AudioFailedEvent))

    player.play()
    await flush()
    await fail404Once()

    const firstSkip = failed.find((e) => e.attempt === 2)!
    expect(firstSkip.consecutiveSkips).toBe(1)

    // The next clip plays properly — timeupdate reports real progress.
    mockAudio.error = null
    mockAudio.currentTime = 0.4
    mockAudio._timeUpdateHandler?.()
    await flush()

    // A later, unrelated dead clip starts the count again from one.
    await fail404Once()
    const laterSkip = failed.filter((e) => e.attempt === 2).pop()!
    expect(laterSkip.consecutiveSkips).toBe(1)
  })
})
