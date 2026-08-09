/**
 * THE WALKER READS THE MODE LIVE, PER STEP — IT NEVER SNAPSHOTS IT.
 *
 * Tom, 2026-08-09, after reproducing the mid-round flip: the setting itself
 * flips instantly and correctly, but "the ROUND-WALKING logic keeps using
 * whatever mode was active when the round started — it does not re-check /
 * re-derive pacing for the mode switch mid-round. Result: doubling up on
 * content in both directions." So the repeat decision moved OUT of the script
 * and INTO the walker: `getCycleRepeatCount` is asked at the moment a cycle
 * ends, and the answer is obeyed by that very step.
 *
 * What this file pins:
 *   1. Easy (count 2) replays the cycle in place, exactly once — never twice;
 *   2. Fast (count 1) never replays;
 *   3. flipping Easy→Fast MID-ROUND stops the repeat of the cycle in flight —
 *      no round boundary needed;
 *   4. flipping Fast→Easy MID-ROUND grants it — likewise immediately;
 *   5. a repeat never leaks across a cycle, a round, or a jump;
 *   6. the ceiling of 2 is the walker's, not config's: an override asking for
 *      3 still plays twice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type Round } from './SimplePlayer'

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

/** A round of `n` practice cycles, each with no pause window so the walk is
 *  prompt → voice1 → voice2 → (next), three 'ended' events per play. */
function makeRound(legoId: string, roundNumber: number, n = 3): Round {
  return {
    roundNumber,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: Array.from({ length: n }, (_, i) => ({
      id: `${legoId}-c${i + 1}`,
      type: 'build',
      // Texts carry the legoId so cycles in DIFFERENT rounds have different
      // prompt identities — otherwise the walker's A-64 live cap (correctly)
      // steps over a next-round cycle that reads identically to the one just
      // doubled, which is not what these repetition tests are probing.
      known: { text: `known ${legoId} ${i + 1}`, audioUrl: `https://example.com/${legoId}-${i}-k.mp3` },
      target: {
        text: `target ${legoId} ${i + 1}`,
        voice1Url: `https://example.com/${legoId}-${i}-t1.mp3`,
        voice2Url: `https://example.com/${legoId}-${i}-t2.mp3`,
      },
      pauseDuration: 0,
    })),
  } as Round
}

describe('the walker re-derives repetition live, per step', () => {
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

  const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve() }

  /** One full sounding of the current cycle: prompt → voice1 → voice2 → end. */
  async function playOneCycleThrough(): Promise<void> {
    await flush()
    mockAudio._endedHandler!()  // prompt → voice1
    await flush()
    mockAudio._endedHandler!()  // voice1 → voice2
    await flush()
    mockAudio._endedHandler!()  // voice2 → end of cycle (advance or replay)
    await flush()
  }

  /** Record the (roundIndex, cycleIndex) each prompt starts on. */
  function trackPrompts(player: SimplePlayer): Array<string> {
    const seen: string[] = []
    player.on('phase_changed', (d: any) => {
      if (d.phase === 'prompt') seen.push(`${player.currentState.roundIndex}:${player.currentState.cycleIndex}`)
    })
    return seen
  }

  it('Easy replays each cycle exactly once in place', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    expect(prompts).toEqual(['0:0', '0:0', '0:1', '0:1'])
  })

  it('Fast never replays', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)], { getCycleRepeatCount: () => 1 })
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 2; i++) await playOneCycleThrough()

    expect(prompts).toEqual(['0:0', '0:1'])
  })

  it('EASY → FAST mid-round: the cycle in flight does not get its second play', async () => {
    let mode: 'easy' | 'fast' = 'easy'
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 3)],
      { getCycleRepeatCount: () => (mode === 'easy' ? 2 : 1) },
    )
    const prompts = trackPrompts(player)

    player.play()
    await playOneCycleThrough()          // cycle 0, play 1 ends → replayed
    await playOneCycleThrough()          // cycle 0, play 2 ends → on to cycle 1
    expect(prompts).toEqual(['0:0', '0:0', '0:1'])

    // The learner flips to Fast HALFWAY THROUGH the round — cycle 1 is
    // already sounding, and it was STARTED under Easy.
    mode = 'fast'

    await playOneCycleThrough()          // cycle 1 ends → must NOT replay
    expect(prompts).toEqual(['0:0', '0:0', '0:1', '0:2'])
  })

  it('FAST → EASY mid-round: the very next cycle is doubled, no round boundary needed', async () => {
    let mode: 'easy' | 'fast' = 'fast'
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 3)],
      { getCycleRepeatCount: () => (mode === 'easy' ? 2 : 1) },
    )
    const prompts = trackPrompts(player)

    player.play()
    await playOneCycleThrough()          // cycle 0, once
    expect(prompts).toEqual(['0:0', '0:1'])

    mode = 'easy'

    await playOneCycleThrough()          // cycle 1 ends → replays in place
    await playOneCycleThrough()          // cycle 1 second play ends → cycle 2
    expect(prompts).toEqual(['0:0', '0:1', '0:1', '0:2'])
  })

  it('a repeat never leaks across a round boundary', async () => {
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 1), makeRound('S0001L02', 2, 1)],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    // Each round's single cycle plays twice — and the second round starts
    // fresh rather than inheriting the first round's play counter.
    expect(prompts).toEqual(['0:0', '0:0', '1:0', '1:0'])
  })

  it('a jump resets the repeat — the landed cycle gets its full count, not a leftover', async () => {
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 3)],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    await playOneCycleThrough()          // cycle 0, play 1 of 2

    player.jumpToRound(0, 2)             // learner skips ahead mid-repeat
    await playOneCycleThrough()          // cycle 2 ends → replays in place

    // Cycle 0's two plays, then the jump's landing prompt and cycle 2's own
    // second play: the landed cycle gets its FULL count rather than being
    // handed the leftover of the cycle the learner jumped away from.
    expect(prompts).toEqual(['0:0', '0:0', '0:2', '0:2'])
  })

  it('clamps to 2 — an override asking for 3 still plays twice', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)], { getCycleRepeatCount: () => 3 })
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    expect(prompts).toEqual(['0:0', '0:0', '0:1', '0:1'])
  })

  it('a cycle the runtime is skipping is never repeated', async () => {
    const player = new SimplePlayer(
      [makeRound('S0001L01', 1, 2)],
      {
        getCycleRepeatCount: () => 2,
        // The skip gate wins: a cycle that should not play at all certainly
        // should not play twice.
        shouldSkipCycle: (c) => c.id.endsWith('-c1'),
      },
    )
    const prompts = trackPrompts(player)
    player.play()
    await playOneCycleThrough()
    await playOneCycleThrough()

    expect(prompts).toEqual(['0:1', '0:1'])
  })

  it('no hook at all = play once (every existing caller is untouched)', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)])
    const prompts = trackPrompts(player)
    player.play()
    await playOneCycleThrough()
    await playOneCycleThrough()

    expect(prompts).toEqual(['0:0', '0:1'])
  })
})
