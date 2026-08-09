/**
 * THE A-64 LAW HOLDS ON THE LIVE STREAM — THE WALKER ENFORCES IT ITSELF.
 *
 * "no mode should ever repeat the same prompt more than twice consecutively"
 * (Tom, 2026-08-06). When Easy's doubling was baked into the script, the
 * build-time cap (capRoundCycles) ran AFTER the repeater and the ordering was
 * load-bearing. The 2026-08-09 refactor moved the doubling into the walker
 * (getCycleRepeatCount, read live at each cycle end) — DOWNSTREAM of that cap
 * — so a legal build-time pair of same-prompt twins became four consecutive
 * identical plays on Easy.
 *
 * Not hypothetical: live Chinese course data serves round S0001L03 with
 * `build_2` and `use_1` adjacent, identical text AND identical audio ids
 * (12b61963/885bb366/a1a7adbe). Reproduced in a real browser 2026-08-09:
 * three identical consecutive plays recorded before the probe paused it.
 *
 * What this file pins:
 *   1. Easy + adjacent twins: the first twin plays twice, the second is
 *      stepped over — never a third consecutive hearing;
 *   2. Fast + adjacent twins: both play once, exactly as before (the law
 *      allows two in a row);
 *   3. three same-prompt cycles in a row under Fast: the third is stepped
 *      over — the law is a floor under EVERY mode, not just Easy;
 *   4. the run crosses the round seam, exactly as the build-time cap's
 *      cross-round seeding did;
 *   5. a differing cycle breaks the run — spaced repetition is untouched;
 *   6. a learner jump resets the run — a deliberate reposition ends the
 *      consecutiveness the law is about.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type Round, type Cycle } from './SimplePlayer'

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

let clipCounter = 0
/** A build cycle whose PROMPT IDENTITY is `${known}|${target}`. Twins share
 *  text (and in the live data, audio); distinct clips per cycle id. */
function cycle(id: string, known: string, target: string): Cycle {
  clipCounter += 1
  return {
    id,
    type: 'build',
    known: { text: known, audioUrl: `https://example.com/${clipCounter}-k.mp3` },
    target: { text: target, voice1Url: `https://example.com/${clipCounter}-t1.mp3`, voice2Url: `https://example.com/${clipCounter}-t2.mp3` },
    pauseDuration: 0,
  } as Cycle
}

function round(roundNumber: number, legoId: string, cycles: Cycle[]): Round {
  return { roundNumber, legoId, seedId: legoId.slice(0, 5), cycles } as Round
}

describe('the A-64 law on the live stream', () => {
  let mockAudio: MockAudio

  beforeEach(() => {
    clipCounter = 0
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

  /** One full sounding of the current cycle (pauseDuration 0 ⇒ three 'ended's). */
  async function playOneCycleThrough(): Promise<void> {
    await flush()
    mockAudio._endedHandler!()
    await flush()
    mockAudio._endedHandler!()
    await flush()
    mockAudio._endedHandler!()
    await flush()
  }

  function trackPrompts(player: SimplePlayer): Array<string> {
    const seen: string[] = []
    player.on('phase_changed', (d: any) => {
      if (d.phase === 'prompt') seen.push(`${player.currentState.roundIndex}:${player.currentState.cycleIndex}`)
    })
    return seen
  }

  it('Easy + adjacent twins: the first plays twice, the twin is stepped over (the live S0001L03 case)', async () => {
    const player = new SimplePlayer(
      [round(1, 'S0001L03', [
        cycle('S0001L03_build_2', 'I want to speak Chinese', 'wǒ xiǎng shuō zhōngwén'),
        cycle('S0001L03_use_1', 'I want to speak Chinese', 'wǒ xiǎng shuō zhōngwén'),
        cycle('S0001L03_use_2', 'now I want to speak', 'wǒ xiànzài xiǎng shuō'),
      ])],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    // build_2 twice, use_1 (the twin) never — the next differing cycle
    // (use_2) gets its own double. Two hearings, not four.
    expect(prompts).toEqual(['0:0', '0:0', '0:2', '0:2'])
  })

  it('Fast + adjacent twins: both play once — two in a row is legal and unchanged', async () => {
    const player = new SimplePlayer(
      [round(1, 'S0001L03', [
        cycle('c1', 'I want to speak Chinese', 'wǒ xiǎng shuō zhōngwén'),
        cycle('c2', 'I want to speak Chinese', 'wǒ xiǎng shuō zhōngwén'),
        cycle('c3', 'now I want to speak', 'wǒ xiànzài xiǎng shuō'),
      ])],
      { getCycleRepeatCount: () => 1 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 3; i++) await playOneCycleThrough()

    expect(prompts).toEqual(['0:0', '0:1', '0:2'])
  })

  it('three same-prompt cycles in a row under Fast: the third is stepped over — the law binds every mode', async () => {
    const player = new SimplePlayer(
      [round(1, 'S0001L01', [
        cycle('c1', 'same', 'tóng'),
        cycle('c2', 'same', 'tóng'),
        cycle('c3', 'same', 'tóng'),
        cycle('c4', 'different', 'bùtóng'),
      ])],
      { getCycleRepeatCount: () => 1 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 3; i++) await playOneCycleThrough()

    expect(prompts).toEqual(['0:0', '0:1', '0:3'])
  })

  it('the run crosses the round seam: a next round opening on the just-doubled prompt steps past it', async () => {
    const player = new SimplePlayer(
      [
        round(1, 'S0001L01', [cycle('r1c1', 'I want', 'wǒ xiǎng')]),
        round(2, 'S0001L02', [
          cycle('r2c1', 'I want', 'wǒ xiǎng'),
          cycle('r2c2', 'to speak', 'shuō'),
        ]),
      ],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    // Round 1's cycle doubled; round 2 opens past its same-prompt twin.
    expect(prompts).toEqual(['0:0', '0:0', '1:1', '1:1'])
  })

  it('a differing cycle breaks the run — the same phrase may return later (spaced repetition untouched)', async () => {
    const player = new SimplePlayer(
      [round(1, 'S0001L01', [
        cycle('c1', 'I want', 'wǒ xiǎng'),
        cycle('c2', 'to speak', 'shuō'),
        cycle('c3', 'I want', 'wǒ xiǎng'),
      ])],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 6; i++) await playOneCycleThrough()

    // A×2, B×2, A×2 — six plays, never three of one prompt in a row.
    expect(prompts).toEqual(['0:0', '0:0', '0:1', '0:1', '0:2', '0:2'])
  })

  it('a learner jump resets the run — a deliberate reposition ends the consecutiveness', async () => {
    const player = new SimplePlayer(
      [round(1, 'S0001L01', [
        cycle('c1', 'I want', 'wǒ xiǎng'),
        cycle('c2', 'I want', 'wǒ xiǎng'),
        cycle('c3', 'to speak', 'shuō'),
      ])],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    await playOneCycleThrough()
    await playOneCycleThrough()          // c1 doubled — run at the cap; the
                                         // walker auto-advances PAST the twin
                                         // (c2) onto c3, whose prompt starts

    player.jumpToRound(0, 1)             // learner deliberately lands on the twin
    await playOneCycleThrough()          // twin play 1 → replayed (Easy)
    await playOneCycleThrough()          // twin play 2 → advance to c3

    // c1 doubled; natural advance skipped the twin (0:2 started); the jump
    // broke the run, so the landed twin plays and doubles; then c3.
    expect(prompts).toEqual(['0:0', '0:0', '0:2', '0:1', '0:1', '0:2'])
  })
})
