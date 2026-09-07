/**
 * A-64 AT PLAY TIME: THE SAME PROMPT NEVER SOUNDS MORE THAN TWICE IN A ROW.
 *
 * The build-time cap (`capRoundCycles`) caps ITEMS: no three cycles carrying
 * the same prompt identity may sit adjacent in a round. Since 2026-08-09 the
 * repeat decision lives in the WALKER instead of the script, so items and
 * PLAYS are different counts — and nothing reconciled them.
 *
 * Measured on dev by job #316 over the real round 2 of spa_for_eng: a BUILD
 * phrase and a USE phrase carrying identical text sit adjacent (lawful — two
 * items), Easy gives each of them its own two plays, and the learner hears the
 * same prompt FOUR times in a row. `MAX_CYCLE_PLAYS` did not stop it because
 * `currentCyclePlays` resets on every cycle advance: it caps a CYCLE's plays,
 * not a PROMPT's.
 *
 * What this file pins is the law as the learner meets it — identities of the
 * prompts the player actually starts, never three of a kind in a row — across
 * cycle boundaries, round boundaries and a mid-repeat resume.
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

/**
 * A round whose cycles carry the given known|target texts, in order. Two
 * entries with the same text are the lawful BUILD/USE pair the real course
 * scripts contain.
 */
function roundOf(legoId: string, roundNumber: number, texts: Array<[string, string]>): Round {
  return {
    roundNumber,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: texts.map(([known, target], i) => ({
      id: `${legoId}-c${i + 1}`,
      type: i === 0 ? 'debut' : 'build',
      known: { text: known, audioUrl: `https://example.com/${legoId}-${i}-k.mp3` },
      target: {
        text: target,
        voice1Url: `https://example.com/${legoId}-${i}-t1.mp3`,
        voice2Url: `https://example.com/${legoId}-${i}-t2.mp3`,
      },
      pauseDuration: 0,
    })),
  } as Round
}

/** The longest run of identical consecutive prompts in a play log. */
function longestRun(prompts: string[]): number {
  let best = 0
  let run = 0
  for (let i = 0; i < prompts.length; i++) {
    run = i > 0 && prompts[i] === prompts[i - 1] ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

describe('the walker caps consecutive identical PROMPTS, not just a cycle repeat', () => {
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

  async function playOneCycleThrough(): Promise<void> {
    await flush()
    mockAudio._endedHandler!()  // prompt → voice1
    await flush()
    mockAudio._endedHandler!()  // voice1 → voice2
    await flush()
    mockAudio._endedHandler!()  // voice2 → end of cycle (advance or replay)
    await flush()
  }

  /** Every prompt the player actually STARTS, by what the learner hears. */
  function trackPrompts(player: SimplePlayer): string[] {
    const seen: string[] = []
    player.on('phase_changed', (d: any) => {
      if (d.phase === 'prompt') seen.push(`${d.cycle?.known?.text} | ${d.cycle?.target?.text}`)
    })
    return seen
  }

  /** Round 2 of spa_for_eng, as job #316 recorded it from the live route. */
  const spaRound2 = (): Round => roundOf('S0001L02', 2, [
    ['to speak', 'hablar'],
    ['to speak', 'hablar'],
    ['I want to speak', 'Quiero hablar'],
    ['I want to speak', 'Quiero hablar'],
  ])

  it('EASY: the adjacent identical BUILD/USE pair never sounds four times', async () => {
    const player = new SimplePlayer([spaRound2()], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 10; i++) await playOneCycleThrough()

    expect(longestRun(prompts)).toBeLessThanOrEqual(2)
    // Nothing is lost: every distinct prompt in the round is still heard.
    expect(new Set(prompts).size).toBe(2)
  })

  it('FAST: unchanged — the lawful pair is still heard twice, once each', async () => {
    const player = new SimplePlayer([spaRound2()], { getCycleRepeatCount: () => 1 })
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 6; i++) await playOneCycleThrough()

    expect(prompts).toEqual([
      'to speak | hablar',
      'to speak | hablar',
      'I want to speak | Quiero hablar',
      'I want to speak | Quiero hablar',
    ])
  })

  it('EASY: distinct prompts still get their two plays each', async () => {
    const player = new SimplePlayer(
      [roundOf('S0001L01', 1, [['I want', 'quiero'], ['to learn', 'aprender']])],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 4; i++) await playOneCycleThrough()

    expect(prompts).toEqual([
      'I want | quiero', 'I want | quiero',
      'to learn | aprender', 'to learn | aprender',
    ])
  })

  it('the cap holds ACROSS THE ROUND SEAM, where the counter reset used to hide it', async () => {
    const player = new SimplePlayer(
      [
        roundOf('S0001L01', 1, [['I want to speak', 'Quiero hablar']]),
        roundOf('S0001L02', 2, [['I want to speak', 'Quiero hablar'], ['and to learn', 'y aprender']]),
      ],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 8; i++) await playOneCycleThrough()

    expect(longestRun(prompts)).toBeLessThanOrEqual(2)
    expect(prompts).toContain('and to learn | y aprender')
  })

  it('punctuation and case do not buy a third hearing — identity is normalised', async () => {
    const player = new SimplePlayer(
      [roundOf('S0001L03', 3, [['Do you want?', 'Quieres?'], ['do you want', 'quieres']])],
      { getCycleRepeatCount: () => 2 },
    )
    const prompts = trackPrompts(player)
    player.play()
    for (let i = 0; i < 6; i++) await playOneCycleThrough()

    expect(prompts.length).toBeLessThanOrEqual(2)
  })

  /**
   * THE ONE EXCEPTION, STATED RATHER THAN HIDDEN. resume() deliberately
   * restarts the cycle the learner was on from the prompt — they have lost the
   * thread, so they get the whole cycle (Tom, 2026-08-09), and that restart
   * SPENDS a hearing rather than adding one. When the learner pauses on the
   * second half of an identical pair, that restart is a third hearing of the
   * same phrase: asked for by the learner, not handed to them by a mode. What
   * the walker guarantees is that it cannot compound — the run stops there,
   * and the next prompt is a different one.
   */
  it('a learner-initiated resume can re-hear the pair once more, but it never compounds', async () => {
    const player = new SimplePlayer([spaRound2()], { getCycleRepeatCount: () => 2 })
    const prompts = trackPrompts(player)
    player.play()
    await playOneCycleThrough()   // first cycle of the pair, heard once
    await playOneCycleThrough()   // second cycle of the pair, heard once
    player.pause()
    player.resume()               // the learner asks for that cycle again
    for (let i = 0; i < 8; i++) await playOneCycleThrough()

    expect(longestRun(prompts)).toBeLessThanOrEqual(3)
    expect(longestRun(prompts.slice(3))).toBeLessThanOrEqual(2)
  })
})
