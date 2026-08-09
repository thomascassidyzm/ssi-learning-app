/**
 * A PHASE-STRIP TAP IS A SEEK INSIDE THE CYCLE — IT BUYS NO EXTRA HEARINGS.
 *
 * Tom, live on dev 2026-08-09, ita_for_eng, EASY:
 *   "clicking a phase button mid-cycle causes the CYCLE TO RESET, so every
 *    cycle ends up playing the same content over and over. Skipping to the
 *    NEXT cycle is what actually stops the doubling."
 *
 * And his expectation, verbatim: "once a cycle is playing he should be able to
 * go to ANY part of that same cycle freely (clicking a phase button should just
 * SEEK within the current cycle, never reset/restart it)".
 *
 * THE CAUSE. Easy's repeat became a live walker decision (modeLivePerStep.test.ts):
 * `advanceCycle` replays the cycle in place while `currentCyclePlays` is under
 * the mode's count. `skipToPhase` routes through `stopForReposition`, which
 * zeroed that counter — so every tap on the strip handed the cycle back its
 * full allowance, and the cycle sounded again from the prompt. Tap again and it
 * happens again, with no ceiling: the same content over and over, exactly as
 * reported. Fast never reached the repeat branch, which is why this is an
 * Easy-mode report.
 *
 * The counter belongs to the CYCLE, so it survives a phase seek and is dropped
 * only when the cursor actually moves to another cycle — which jumpToRound
 * (and so stepCycle) still does, pinned by modeLivePerStep's jump test.
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

/** `n` practice cycles with no pause window, so one sounding is three 'ended's. */
function makeRound(legoId: string, roundNumber: number, n = 3): Round {
  return {
    roundNumber,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: Array.from({ length: n }, (_, i) => ({
      id: `${legoId}-c${i + 1}`,
      type: 'build',
      known: { text: `known ${i + 1}`, audioUrl: `https://example.com/${legoId}-${i}-k.mp3` },
      target: {
        text: `target ${i + 1}`,
        voice1Url: `https://example.com/${legoId}-${i}-t1.mp3`,
        voice2Url: `https://example.com/${legoId}-${i}-t2.mp3`,
      },
      pauseDuration: 0,
    })),
  } as Round
}

describe('the phase strip seeks within the cycle', () => {
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

  /** One full sounding from wherever we are: run the walk out to the cycle end. */
  async function playToCycleEnd(): Promise<void> {
    await flush()
    mockAudio._endedHandler!()  // prompt → voice1
    await flush()
    mockAudio._endedHandler!()  // voice1 → voice2
    await flush()
    mockAudio._endedHandler!()  // voice2 → end of cycle
    await flush()
  }

  /** Record the (roundIndex, cycleIndex) each prompt starts on. */
  function trackPrompts(player: SimplePlayer): string[] {
    const seen: string[] = []
    player.on('phase_changed', (d: any) => {
      if (d.phase === 'prompt') seen.push(`${player.currentState.roundIndex}:${player.currentState.cycleIndex}`)
    })
    return seen
  }

  it('Easy: a tap on voice1 mid-cycle does not buy the cycle a third hearing', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    await playToCycleEnd()               // play 1 of 2 → replays in place (prompt #2)
    await flush()
    player.skipToPhase('voice1')         // the learner taps person-1 during play 2
    await playToCycleEnd()               // voice1 → voice2 → end of play 2

    // Two hearings of cycle 0, then on to cycle 1. The tap moved WITHIN the
    // second hearing; it did not hand the cycle a third one.
    expect(prompts).toEqual(['0:0', '0:0', '0:1'])
  })

  it('Easy: tapping the strip through the second hearing never buys a third, fourth, fifth…', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    await playToCycleEnd()               // hearing 1 ends → hearing 2 starts
    // Now inside the SECOND hearing, which is where the counter was non-zero
    // and every tap used to reset it — the unbounded repro. Four taps, each of
    // which used to owe the cycle another full sounding from the prompt.
    for (const p of ['voice1', 'voice2', 'voice1', 'voice2'] as const) {
      await flush()
      player.skipToPhase(p)
    }
    await playToCycleEnd()               // hearing 2 finishes → on to cycle 1

    expect(prompts).toEqual(['0:0', '0:0', '0:1'])
  })

  it('a tap on the prompt segment replays the prompt without spending or adding a hearing', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    await flush()
    player.skipToPhase('prompt')         // headphones: "say that to me again"
    await playToCycleEnd()               // the rest of hearing 1
    await playToCycleEnd()               // hearing 2 → on to cycle 1

    // Three prompts sound (the original, the deliberate replay, the repeat),
    // and the walker still moves on after the cycle's own two hearings.
    expect(prompts).toEqual(['0:0', '0:0', '0:0', '0:1'])
    expect(player.currentState.cycleIndex).toBe(1)
  })

  it('the seek stays inside the cycle — round and cycle index never move', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 3)], { getCycleRepeatCount: () => 2 })
    player.play()
    await flush()
    player.skipToPhase('voice2')
    await flush()
    expect(player.currentState.roundIndex).toBe(0)
    expect(player.currentState.cycleIndex).toBe(0)
    expect(player.currentState.phase).toBe('voice2')
  })

  it('the mic segment is a seek too — back to the speaking gap, still one cycle', async () => {
    const round = makeRound('S0001L01', 1, 2)
    // A real speaking cycle: the gap exists, so the strip is shown at all.
    for (const c of round.cycles) (c as any).pauseDuration = 4000
    const player = new SimplePlayer([round], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    await flush()
    player.skipToPhase('voice2')
    await flush()
    player.skipToPhase('pause')          // "give me another go at saying it"
    await flush()

    expect(player.currentState.phase).toBe('pause')
    expect(player.currentState.cycleIndex).toBe(0)
    expect(prompts).toEqual(['0:0'])     // nothing restarted the cycle
  })

  it('Fast is untouched: a tap changes phase and nothing else', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 2)], { getCycleRepeatCount: () => 1 })
    const prompts = trackPrompts(player)
    player.play()
    await flush()
    player.skipToPhase('voice1')
    await playToCycleEnd()

    expect(prompts).toEqual(['0:0', '0:1'])
  })

  it('a cycle-skip still drops the counter — the landed cycle gets its own full count', async () => {
    const player = new SimplePlayer([makeRound('S0001L01', 1, 3)], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    await playToCycleEnd()               // cycle 0, hearing 1 of 2
    await flush()
    player.stepCycle(1)                  // the next-cycle arrow
    await playToCycleEnd()               // cycle 1 ends → its own replay

    expect(prompts).toEqual(['0:0', '0:0', '0:1', '0:1'])
  })
})
