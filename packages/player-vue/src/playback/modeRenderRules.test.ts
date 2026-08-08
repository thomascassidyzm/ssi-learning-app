/**
 * ONE SCRIPT, TWO PLAY-TIME RULES (Tom, 2026-08-08).
 *
 *   "what we should really have is exactly the same script, but with different
 *    rules, so that if we toggle between easy and fast, you'll instantly get
 *    the correct audio... When I was going to Fast, having been in Easy, it was
 *    still playing double everything. And I had to clear the cache, and then
 *    restart the course, restart the player."
 *
 * This file replaces `easyRepeatCycles.test.ts` and `easyRepeatInstantPath.
 * test.ts`, which asserted that Easy's doubling was baked into the GENERATED
 * script and into the instant-playback rounds. Those assertions have been
 * flipped deliberately: baking the mode into a CACHED script is the bug Tom
 * hit, so "the script carries the doubling" is now asserting the defect. The
 * rules Tom gave on 2026-08-07 are unchanged — pairs never triples, intro and
 * the bare LEGO left alone, the seed sandwich left alone, count and types both
 * config — they are simply enforced at the cycle boundary instead.
 *
 * What this file pins:
 *   1. the pure rules, over a play-time Cycle;
 *   2. THE ACCEPTANCE CRITERION — with a WARM script and a session running,
 *      flipping the mode changes what the NEXT cycle plays, with no
 *      regeneration and nothing cleared;
 *   3. the skip half: an over-threshold cycle is passed over, the round still
 *      completes, and switching to Fast neither re-serves it nor leaves a hole;
 *   4. Fast is untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePlayer, type Round } from './SimplePlayer'
import type { Cycle } from '@ssi/core'
import {
  cyclePlayCountFor,
  shouldSkipForLength,
  DEFAULT_REPEATED_CYCLE_TYPES,
  MAX_PHRASE_REPEAT_COUNT,
  type ModeRenderRules,
} from './modeRenderRules'
import {
  normalizePhraseRepeatCount,
  normalizeRepeatedCycleTypes,
  normalizeMaxKnownSyllables,
} from '../composables/useAlgorithmConfig'

const EASY: ModeRenderRules = {
  repeatCount: normalizePhraseRepeatCount(2),
  repeatedTypes: normalizeRepeatedCycleTypes(undefined),
  maxKnownSyllables: normalizeMaxKnownSyllables(15),
}

const FAST: ModeRenderRules = {
  repeatCount: normalizePhraseRepeatCount(1),
  repeatedTypes: normalizeRepeatedCycleTypes(undefined),
  maxKnownSyllables: normalizeMaxKnownSyllables(0),
}

const cycle = (over: Partial<Cycle> = {}): Cycle => ({
  id: over.id ?? 'c1',
  type: 'use',
  known: { text: 'the known side', audioUrl: 'https://example.com/k.mp3' },
  target: { text: 'le côté connu', voice1Url: 'https://example.com/t1.mp3', voice2Url: 'https://example.com/t2.mp3' },
  pauseDuration: 0,
  ...over,
})

// One syllable per word — enough to make "how many" unambiguous in a test
// without pulling the real counter's language rules into the assertion.
const wordSyllables = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

describe('1. the pure rules', () => {
  it('doubles the four practice types and nothing else', () => {
    for (const type of ['build', 'spaced_rep', 'use']) {
      expect(cyclePlayCountFor(cycle({ type }), EASY)).toBe(2)
    }
    for (const type of ['intro', 'debut', 'listening', 'pod', 'component_intro', 'listen_intro', 'listen_outro']) {
      expect(cyclePlayCountFor(cycle({ type }), EASY)).toBe(1)
    }
  })

  it('leaves the SEED-PHASE production sandwich alone — doubling it would be 4x', () => {
    expect(cyclePlayCountFor(cycle({ type: 'spaced_rep', singleAudio: true }), EASY)).toBe(1)
  })

  it('the count and the type list are both CONFIG, and the ceiling of 2 is not', () => {
    expect(normalizePhraseRepeatCount(3)).toBe(MAX_PHRASE_REPEAT_COUNT)
    expect(normalizePhraseRepeatCount(99)).toBe(MAX_PHRASE_REPEAT_COUNT)
    for (const bad of [undefined, null, NaN, 0, -3, 1]) {
      expect(normalizePhraseRepeatCount(bad as number)).toBe(1)
    }
    // …and the rule itself refuses to exceed it even if handed a bad count.
    expect(cyclePlayCountFor(cycle({ type: 'build' }), { ...EASY, repeatCount: 5 })).toBe(2)
    // A row can add the debut, or repeat nothing at all.
    const withDebut = { ...EASY, repeatedTypes: normalizeRepeatedCycleTypes(['debut', 'build']) }
    expect(cyclePlayCountFor(cycle({ type: 'debut' }), withDebut)).toBe(2)
    expect(cyclePlayCountFor(cycle({ type: 'build' }), { ...EASY, repeatedTypes: normalizeRepeatedCycleTypes([]) })).toBe(1)
    expect([...normalizeRepeatedCycleTypes(undefined)].sort()).toEqual([...DEFAULT_REPEATED_CYCLE_TYPES].sort())
  })

  it('skips a REVIEW or USE cycle whose KNOWN side runs past the threshold', () => {
    const long = cycle({ type: 'use', known: { text: 'a b c d e f g h i j k l m n o p', audioUrl: 'x' } })
    const short = cycle({ type: 'use', known: { text: 'a b c', audioUrl: 'x' } })
    expect(shouldSkipForLength(long, EASY, wordSyllables)).toBe(true)
    expect(shouldSkipForLength(short, EASY, wordSyllables)).toBe(false)
    expect(shouldSkipForLength({ ...long, type: 'spaced_rep' }, EASY, wordSyllables)).toBe(true)
  })

  it('never skips a BUILD, a debut, an intro or a listening cycle — "no filtering on BLD phrases"', () => {
    const longText = { text: 'a b c d e f g h i j k l m n o p', audioUrl: 'x' }
    for (const type of ['build', 'debut', 'intro', 'listening', 'pod', 'listen_intro', 'listen_outro']) {
      expect(shouldSkipForLength(cycle({ type, known: longText }), EASY, wordSyllables)).toBe(false)
    }
    expect(shouldSkipForLength(cycle({ type: 'spaced_rep', known: longText, singleAudio: true }), EASY, wordSyllables)).toBe(false)
  })

  it('is INERT — never skips — when the known language has no syllable counter', () => {
    const long = cycle({ type: 'use', known: { text: 'a b c d e f g h i j k l m n o p', audioUrl: 'x' } })
    expect(shouldSkipForLength(long, EASY, () => null)).toBe(false)
  })

  it('FAST does neither', () => {
    const long = cycle({ type: 'use', known: { text: 'a b c d e f g h i j k l m n o p', audioUrl: 'x' } })
    expect(cyclePlayCountFor(long, FAST)).toBe(1)
    expect(shouldSkipForLength(long, FAST, wordSyllables)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The acceptance criterion, at engine level.
// ─────────────────────────────────────────────────────────────────────────────

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
  currentTime?: number
}

function makeMockAudio(): MockAudio {
  const a: MockAudio = {
    src: '', playbackRate: 1, volume: 1, loop: false, paused: true, ended: false, error: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  }
  a.addEventListener.mockImplementation((event: string, handler: () => void) => {
    if (event === 'ended') a._endedHandler = handler
  })
  return a
}

/**
 * A warm, MODE-FREE script: one round of intro + two practice cycles, one of
 * them long enough to trip Easy's skip. Built once and never rebuilt — which
 * is the point of the whole exercise.
 */
function warmRounds(): Round[] {
  return [{
    roundNumber: 1,
    legoId: 'S0001L01',
    seedId: 'S0001',
    cycles: [
      cycle({ id: 'intro', type: 'intro', known: { text: 'the word', audioUrl: 'https://example.com/i.mp3' } }),
      cycle({ id: 'short', type: 'use', known: { text: 'a b c', audioUrl: 'https://example.com/s.mp3' } }),
      cycle({ id: 'long', type: 'use', known: { text: 'a b c d e f g h i j k l m n o p q', audioUrl: 'https://example.com/l.mp3' } }),
    ],
  }]
}

describe('2. flipping the mode changes what the NEXT cycle plays — warm script, no rebuild', () => {
  let mockAudio: MockAudio
  let player: SimplePlayer
  let mode: 'easy' | 'fast'
  let played: string[]

  const rulesNow = (): ModeRenderRules => (mode === 'easy' ? EASY : FAST)

  /**
   * The cycle that is sounding runs prompt → voice1 → voice2 and then hits the
   * boundary, where the repeat/skip decision is taken. `endPhase()` is one of
   * those three steps, so a test can flip the mode MID-cycle — which is what a
   * learner does — and watch the decision land at the very next boundary.
   */
  const endPhase = () => { mockAudio._endedHandler?.() }
  const finishCycle = () => { for (let phase = 0; phase < 3; phase++) endPhase() }

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    mode = 'easy'
    played = []
    player = new SimplePlayer(warmRounds(), {
      getCyclePlayCount: (c) => cyclePlayCountFor(c, rulesNow()),
      shouldSkipCycle: (c) => shouldSkipForLength(c, rulesNow(), wordSyllables),
    })
    player.on('cycle_completed', (data) => {
      played.push(((data as { cycle?: Cycle }).cycle?.id) ?? '?')
    })
  })

  afterEach(() => {
    player.dispose()
    vi.unstubAllGlobals()
  })

  it('EASY plays a practice cycle twice and the intro once', () => {
    player.play()
    finishCycle() // intro
    finishCycle() // short, play 1
    finishCycle() // short, play 2
    expect(played).toEqual(['intro', 'short', 'short'])
  })

  it('THE BUG: switching Easy→Fast mid-phrase stops the doubling on that very phrase', () => {
    player.play()
    finishCycle() // intro
    endPhase(); endPhase() // 'short' is sounding, part way through

    // The learner flips the toggle. Nothing is regenerated, no cache is
    // cleared, the player is not restarted — this single assignment is the
    // whole switch, because the rules are read at the boundary, not baked.
    mode = 'fast'

    endPhase()     // 'short' reaches its boundary → NO second play under Fast
    finishCycle()  // whatever plays next
    // 'short' does not double, and the LONG cycle — passed over under Easy —
    // is now served, because Fast has no length rule.
    expect(played).toEqual(['intro', 'short', 'long'])
  })

  it('and Fast→Easy starts the doubling on the very next phrase, equally live', () => {
    mode = 'fast'
    player.play()
    finishCycle()          // intro
    endPhase(); endPhase() // 'short' sounding under Fast
    mode = 'easy'
    endPhase()             // boundary → Easy says play it again
    finishCycle()          // the second play
    expect(played).toEqual(['intro', 'short', 'short'])
  })

  it('the script is never touched — the same round objects are still in the queue', () => {
    const before = player.roundsSnapshot
    player.play()
    finishCycle()
    mode = 'fast'
    finishCycle()
    const after = player.roundsSnapshot
    expect(after).toHaveLength(before.length)
    expect(after[0].cycles.map((c) => c.id)).toEqual(['intro', 'short', 'long'])
    expect(after[0]).toBe(before[0])
  })
})

describe('3. the skip leaves no hole — progress is position in the script', () => {
  let mockAudio: MockAudio
  let player: SimplePlayer
  let mode: 'easy' | 'fast'

  const finishCycle = () => { for (let phase = 0; phase < 3; phase++) mockAudio._endedHandler?.() }

  beforeEach(() => {
    mockAudio = makeMockAudio()
    vi.stubGlobal('Audio', vi.fn(() => mockAudio))
    mode = 'easy'
    player = new SimplePlayer(warmRounds(), {
      getCyclePlayCount: (c) => cyclePlayCountFor(c, mode === 'easy' ? EASY : FAST),
      shouldSkipCycle: (c) => shouldSkipForLength(c, mode === 'easy' ? EASY : FAST, wordSyllables),
    })
  })

  afterEach(() => {
    player.dispose()
    vi.unstubAllGlobals()
  })

  it('an Easy learner who skipped the long phrase has still COMPLETED the round', () => {
    const completed: number[] = []
    let sessionComplete = false
    player.on('round_completed', () => { completed.push(player.currentState.roundIndex) })
    player.on('session_complete', () => { sessionComplete = true })
    player.play()
    finishCycle() // intro
    finishCycle() // short ×1
    finishCycle() // short ×2 → the long cycle is passed over → the round ends
    // The round completes normally — the skip shortened it, it did not stall
    // it, and nothing is left pending to come back for.
    expect(completed).toEqual([0])
    expect(sessionComplete).toBe(true)
  })

  it('switching to Fast afterwards does not re-serve what Easy passed over', () => {
    const played: string[] = []
    player.on('cycle_completed', (d) => { played.push(((d as { cycle?: Cycle }).cycle?.id) ?? '?') })
    player.play()
    finishCycle(); finishCycle(); finishCycle() // intro, short ×2 → round ends
    mode = 'fast'
    // The cursor is past the round; nothing rewinds, and 'long' never appears.
    expect(played).toEqual(['intro', 'short', 'short'])
  })
})
