import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSimplePlayer } from './useSimplePlayer'
import type { Round } from '../playback/SimplePlayer'

// Minimal HTMLAudioElement mock — SimplePlayer's constructor calls `new Audio()`.
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
}

function makeMockAudio(): MockAudio {
  return {
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
}

// One round per LEGO id, seedId parsed the same way production rounds are
// built (toSimpleRounds): "S0020L01" → seedId "S0020".
function makeRound(legoId: string, roundNumber: number): Round {
  return {
    roundNumber,
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
        pauseDuration: 0,
      },
    ],
  }
}

describe('useSimplePlayer — belt-threshold seed→round resolution', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(() => makeMockAudio()))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Seed 19 (yellow) has two LEGOs, seed 20 (orange) has two LEGOs —
  // mirrors the real course shape from the reported bug (fromBelt:yellow
  // toBelt:orange targetSeed:20).
  const ROUNDS = [
    makeRound('S0019L01', 54),
    makeRound('S0019L02', 55),
    makeRound('S0020L01', 56),
    makeRound('S0020L02', 57),
    makeRound('S0021L01', 58),
  ]

  it('findRoundIndexForBeltThreshold(20) resolves to the FIRST round of seed 20, not seed 19', () => {
    const sp = useSimplePlayer()
    sp.initialize(ROUNDS)
    const idx = sp.findRoundIndexForBeltThreshold(20)
    expect(idx).toBe(2) // S0020L01
  })

  it('findLegoIdForBeltThreshold(20) lands ON the tapped belt (targetSeed 20 → S0020L01, never S0019L02)', () => {
    const sp = useSimplePlayer()
    sp.initialize(ROUNDS)
    expect(sp.findLegoIdForBeltThreshold(20)).toBe('S0020L01')
  })

  it('nearest-match: a threshold that does not sit exactly on a loaded seed resolves to the next available seed', () => {
    // Blue belt = seed 80, but the course jumps 78 → 83 (content gap).
    const rounds = [
      makeRound('S0078L01', 1),
      makeRound('S0083L01', 2),
      makeRound('S0083L02', 3),
    ]
    const sp = useSimplePlayer()
    sp.initialize(rounds)
    expect(sp.findLegoIdForBeltThreshold(80)).toBe('S0083L01')
  })

  it('returns -1 / null when no loaded round reaches the threshold (still loading / course too short)', () => {
    const sp = useSimplePlayer()
    sp.initialize([makeRound('S0001L01', 1)])
    expect(sp.findRoundIndexForBeltThreshold(400)).toBe(-1)
    expect(sp.findLegoIdForBeltThreshold(400)).toBeNull()
  })

  it('regression: resolving via a SEPARATE (diverged) rounds mirror at the same index gives the WRONG lego — the fencepost bug this fix removes', () => {
    // This reproduces the actual bug mechanism: some callers used to take
    // the index from findRoundIndexForBeltThreshold (searched against the
    // live engine queue) and re-use it to index into a DIFFERENT mirror
    // array (e.g. a component-level `cachedRounds` that had independently
    // been replaced by a whole-course array from the instant-playback
    // full-script handoff). When the two arrays disagree on ordering, the
    // shared index points at different rounds in each — landing one seed
    // short. findLegoIdForBeltThreshold cannot suffer this because it never
    // crosses arrays.
    const sp = useSimplePlayer()
    sp.initialize(ROUNDS)
    const idx = sp.findRoundIndexForBeltThreshold(20) // idx 2, S0020L01 in the live queue

    // A mirror that has ALREADY diverged (e.g. it picked up an extra round
    // ahead of the live queue during a background full-script handoff).
    const divergedMirror = [makeRound('S0018L01', 53), ...ROUNDS]
    const wrongLegoIdFromCrossIndexing = divergedMirror[idx]?.legoId
    expect(wrongLegoIdFromCrossIndexing).toBe('S0019L02') // the old bug: one seed short

    // The fix: resolve atomically against the SAME array — always correct.
    expect(sp.findLegoIdForBeltThreshold(20)).toBe('S0020L01')
  })
})
