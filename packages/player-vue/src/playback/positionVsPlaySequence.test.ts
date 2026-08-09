/**
 * A CYCLE'S STORED POSITION IN ITS ROUND IS NOT ITS PLAY SEQUENCE.
 *
 * Tom's hypothesis, 2026-08-09, on why the mode toggle kept misbehaving:
 *
 *   "the cached round data labels each phrase with a fixed POSITION within the
 *    round (index/order number), and the player may be treating that stored
 *    position as if it IS the play sequence — i.e. walking positions 1,2,3…
 *    literally rather than deriving the actual play order live from current
 *    mode… If so the fix is separating position (fixed, cached, fine) from
 *    play-sequence (live, mode-derived, must be computed fresh each step)."
 *
 * He is right, and this file is where that separation is pinned. Position is
 * the index into `round.cycles` — fixed, cached, shared by both modes, and
 * still the thing `state.cycleIndex` names. Play sequence is what the walker
 * derives from it every step by asking the LIVE mode two questions: does this
 * mode play this cycle at all (`shouldSkipCycle`), and how many times
 * (`getCycleRepeatCount`).
 *
 * The bug his hypothesis predicted was real and is fixed here: `play()` derived
 * the first PLAYABLE position when a round was entered from a standstill, but
 * `advanceRound()` — every round-to-round transition in a session — set
 * `cycleIndex: 0` literally and started there. It was masked only because
 * position 0 happens to be the intro, which no mode ever selects out; the
 * moment mode-dependent selection touched an early cycle, a round opened on a
 * cycle the mode had said not to play. `jumpToRound()` clamped a caller's index
 * the same literal way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type Round } from './SimplePlayer'

interface MockAudio {
  src: string; playbackRate: number; volume: number; loop: boolean
  paused: boolean; ended: boolean; error: { code: number } | null
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  _endedHandler?: () => void
}

function makeMockAudio(): MockAudio {
  const a: MockAudio = {
    src: '', playbackRate: 1, volume: 1, loop: false, paused: true, ended: false, error: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), setAttribute: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
  }
  a.addEventListener.mockImplementation((event: string, handler: () => void) => {
    if (event === 'ended') a._endedHandler = handler
  })
  return a
}

/** A round whose cycles carry their POSITION in the id, so a play log reads
 *  as a sequence of positions and any conflation shows up directly. */
function makeRound(legoId: string, roundNumber: number, n: number): Round {
  return {
    roundNumber, legoId, seedId: legoId.slice(0, 5),
    cycles: Array.from({ length: n }, (_, i) => ({
      id: `${legoId}-p${i}`,
      type: i === 0 ? 'intro' : 'build',
      known: { text: `known ${i}`, audioUrl: `k${i}.mp3` },
      target: { text: `target ${i}`, voice1Url: `v1-${i}.mp3`, voice2Url: `v2-${i}.mp3` },
      pauseDuration: 0,
    })),
  } as Round
}

describe('position (cached, fixed) vs play sequence (live, mode-derived)', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve() }

  async function playOneCycleThrough(): Promise<void> {
    await flush()
    mockAudio._endedHandler!(); await flush()   // prompt → voice1
    mockAudio._endedHandler!(); await flush()   // voice1 → voice2
    mockAudio._endedHandler!(); await flush()   // voice2 → advance or replay
  }

  /** Every cycle id a prompt actually started on, in order. */
  function trackPlays(player: SimplePlayer): string[] {
    const played: string[] = []
    player.on('phase_changed', (d: any) => {
      if (d.phase === 'prompt') played.push(player.currentCycle?.id ?? '(none)')
    })
    return played
  }

  it('the round the walker ENTERS opens on the first cycle the mode plays, not on position 0', async () => {
    // Round 2's positions 0 and 1 are selected out by the active mode. Walking
    // positions literally would open round 2 on p0 — a cycle this mode does
    // not play. This is the case Tom predicted.
    const skipped = new Set(['S0002L01-p0', 'S0002L01-p1'])
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 2), makeRound('S0002L01', 2, 4)],
      { shouldSkipCycle: (c: any) => skipped.has(c.id) },
    )
    const played = trackPlays(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    expect(played).toEqual(['S0001L01-p0', 'S0001L01-p1', 'S0002L01-p2', 'S0002L01-p3'])
    // …and the POSITION reported matches the cycle actually sounding, always.
    expect(player.currentCycle?.id).toBe('S0002L01-p3')
    expect(player.currentState.cycleIndex).toBe(3)
  })

  it('a round whose every cycle the mode skips is stepped over, not stalled on', async () => {
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 2), makeRound('S0002L01', 2, 2), makeRound('S0003L01', 3, 2)],
      { shouldSkipCycle: (c: any) => c.id.startsWith('S0002L01') },
    )
    const played = trackPlays(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    expect(played).toEqual(['S0001L01-p0', 'S0001L01-p1', 'S0003L01-p0', 'S0003L01-p1'])
  })

  it('jumping to a round lands on a cycle the mode plays, never on a skipped position', async () => {
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 2), makeRound('S0002L01', 2, 4)],
      { shouldSkipCycle: (c: any) => c.id === 'S0002L01-p0' || c.id === 'S0002L01-p1' },
    )
    player.jumpToRound(1)
    expect(player.currentCycle?.id).toBe('S0002L01-p2')

    // An explicit cycle target that the mode skips resolves forward too.
    player.jumpToRound(1, 1)
    expect(player.currentCycle?.id).toBe('S0002L01-p2')
  })

  it('changing the mode mid-round re-derives the sequence from the SAME positions', async () => {
    // Nothing about the round changes — only the live answer does.
    let easy = false
    const player = new SimplePlayer([makeRound('S0001L01', 1, 5)], {
      shouldSkipCycle: (c: any) => easy && c.id === 'S0001L01-p3',
      getCycleRepeatCount: () => (easy ? 2 : 1),
    })
    const played = trackPlays(player)
    player.play()
    await playOneCycleThrough()          // p0 once (Fast)
    easy = true                          // ← the toggle, mid-round
    await playOneCycleThrough()          // p1, first sounding
    await playOneCycleThrough()          // p1, repeat — the live count landed
    await playOneCycleThrough()          // p2, first sounding
    await playOneCycleThrough()          // p2, repeat
    await playOneCycleThrough()          // p3 is selected out ⇒ p4, first sounding
    await playOneCycleThrough()          // p4, repeat — Easy is still on
    expect(played).toEqual([
      'S0001L01-p0',                                  // sounded under Fast
      'S0001L01-p1', 'S0001L01-p1',
      'S0001L01-p2', 'S0001L01-p2',
      'S0001L01-p4', 'S0001L01-p4',                   // p3 selected out entirely
    ])
    // The repeat never advanced the POSITION under the walker's feet: the
    // second sounding of p1 was still position 1, not position 2.
    expect(player.currentState.cycleIndex).toBe(4)
  })

  it('a repeat and a skip never combine into a replay of an already-played position', async () => {
    // Easy doubling plus a selection that removes the middle cycle: the log
    // must be strictly forward-moving, each position at most twice.
    const player = new SimplePlayer([makeRound('S0001L01', 1, 4)], {
      shouldSkipCycle: (c: any) => c.id === 'S0001L01-p2',
      getCycleRepeatCount: () => 2,
    })
    const played = trackPlays(player)
    player.play()
    for (let i = 0; i < 6; i++) await playOneCycleThrough()

    expect(played).toEqual([
      'S0001L01-p0', 'S0001L01-p0',
      'S0001L01-p1', 'S0001L01-p1',
      'S0001L01-p3', 'S0001L01-p3',
    ])
    const positions = played.map((id) => Number(id.split('-p')[1]))
    // Strictly non-decreasing: the walk never goes backwards.
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    // And no position sounds three times — the walker's own ceiling.
    for (const p of new Set(positions)) {
      expect(positions.filter((n) => n === p).length).toBeLessThanOrEqual(2)
    }
  })
})
