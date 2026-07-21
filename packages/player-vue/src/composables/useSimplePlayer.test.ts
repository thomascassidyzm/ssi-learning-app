/**
 * Skip-bug regression suite (2026-07-21 staging report) — the reactive
 * composable layer real components read from.
 *
 * Covers, at the layer templates actually bind to:
 *   1. round-skip (skipRound) advances exactly one round.
 *   2. cycle-skip (stepCycle) keeps the reactive currentRound/currentCycle
 *      (what the display renders) and roundIndex/cycleIndex in lockstep.
 *   3. belt tap lands on the tapped belt: findRoundIndexForBeltThreshold
 *      resolves every belt threshold to a round whose OWN seed maps back
 *      to that exact belt via getBeltIndexForSeed — never the belt before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSimplePlayer } from './useSimplePlayer'
import { BELTS, getBeltIndexForSeed } from './useBeltProgress'
import type { Round } from '../playback/SimplePlayer'

interface MockAudio {
  src: string
  playbackRate: number
  volume: number
  loop: boolean
  paused: boolean
  error: { code: number } | null
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
}

function makeMockAudio(): MockAudio {
  return {
    src: '',
    playbackRate: 1,
    volume: 1,
    loop: false,
    paused: true,
    error: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  }
}

/** One round per LEGO, one cycle per round — mirrors SimplePlayer.test.ts's makeRound. */
function makeRound(legoId: string, roundNumber: number): Round {
  const seedId = legoId.slice(0, 5)
  return {
    roundNumber,
    legoId,
    seedId,
    cycles: [
      {
        id: `${legoId}-c1`,
        known: { text: legoId, audioUrl: `https://example.com/${legoId}-k.mp3` },
        target: {
          text: legoId,
          voice1Url: `https://example.com/${legoId}-t1.mp3`,
          voice2Url: `https://example.com/${legoId}-t2.mp3`,
        },
        pauseDuration: 0,
      },
    ],
  } as Round
}

/** roundsPerSeed rounds for every seed in [1, maxSeed], legoId-ordered. */
function makeRoundsForSeedRange(maxSeed: number, roundsPerSeed = 3): Round[] {
  const rounds: Round[] = []
  let roundNumber = 1
  for (let seed = 1; seed <= maxSeed; seed++) {
    const seedStr = String(seed).padStart(4, '0')
    for (let l = 1; l <= roundsPerSeed; l++) {
      rounds.push(makeRound(`S${seedStr}L${String(l).padStart(2, '0')}`, roundNumber++))
    }
  }
  return rounds
}

describe('useSimplePlayer — skip actions (reactive layer)', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(makeMockAudio))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skipRound advances exactly one round in the reactive state', () => {
    const sp = useSimplePlayer()
    sp.initialize(['S0001L01', 'S0002L01', 'S0003L01'].map((id, i) => makeRound(id, i + 1)))

    expect(sp.roundIndex.value).toBe(0)
    expect(sp.currentRound.value?.legoId).toBe('S0001L01')

    sp.skipRound()

    expect(sp.roundIndex.value).toBe(1)
    expect(sp.currentRound.value?.legoId).toBe('S0002L01')
  })

  it('stepCycle keeps reactive currentRound/currentCycle and roundIndex/cycleIndex in lockstep across a round boundary', () => {
    const sp = useSimplePlayer()
    sp.initialize(['S0001L01', 'S0002L01'].map((id, i) => makeRound(id, i + 1)))
    sp.play()

    sp.stepCycle(1)

    // The round/cycle index the display reads and the round/cycle OBJECT
    // the display renders must always agree — no separately-tracked mirror
    // that could point somewhere else.
    expect(sp.roundIndex.value).toBe(1)
    expect(sp.cycleIndex.value).toBe(0)
    expect(sp.currentRound.value?.legoId).toBe('S0002L01')
    expect(sp.currentCycle.value?.known.text).toBe('S0002L01')
    expect(sp.knownText.value).toBe('S0002L01')
  })

  it('every belt threshold resolves to a round whose OWN seed maps back to that exact belt', () => {
    const sp = useSimplePlayer()
    // Cover every belt including Black (400) with margin.
    sp.initialize(makeRoundsForSeedRange(420, 3))

    for (const belt of BELTS) {
      const targetSeed = belt.seedsRequired === 0 ? 1 : belt.seedsRequired
      const idx = sp.findRoundIndexForBeltThreshold(targetSeed)
      expect(idx, `belt ${belt.name} (threshold ${targetSeed}) must resolve to a loaded round`).toBeGreaterThanOrEqual(0)

      // Jump there (the real navigation primitive belt-skip uses) and read
      // back the seed the display/engine actually landed on.
      sp.jumpToRound(idx)
      const landedSeed = Number(sp.currentRound.value?.seedId?.slice(1))
      const expectedBeltIndex = BELTS.indexOf(belt)
      expect(
        getBeltIndexForSeed(landedSeed),
        `tapping ${belt.name} belt (threshold ${targetSeed}) landed on seed ${landedSeed}, ` +
        `which resolves to belt index ${getBeltIndexForSeed(landedSeed)}, not ${belt.name} (${expectedBeltIndex})`,
      ).toBe(expectedBeltIndex)
      // And it never lands EARLY (on a lower belt's content).
      expect(landedSeed).toBeGreaterThanOrEqual(targetSeed)
    }
  })
})
