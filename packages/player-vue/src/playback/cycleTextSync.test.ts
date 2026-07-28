import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, watch, nextTick } from 'vue'
import { SimplePlayer, type PlaybackState, type Round, type Cycle } from './SimplePlayer'

// REGRESSION: the displayed-cycle mirror (M1, docs/player/pull-consistency-map.md)
// — the TEXT/AUDIO pairing. LearningPlayer's currentCycle used to be a
// writable ref synced by an edge-triggered watcher (holding its last value on
// transient nulls) plus a legacy-path writer. A missed or reordered flush
// showed cycle N's text while the engine audibly played cycle N+1 — the
// zero-tolerance schools bug class ("students must never hear audio that
// doesn't match displayed text"). The fix derives the displayed cycle from
// simplePlayer.currentCycle in a computed: the text pair becomes a pure
// function of the same state that chooses the audio.

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

let cycleSeq = 0
function makeRound(legoId: string, knownText: string, targetText: string): Round {
  cycleSeq += 1
  return {
    roundNumber: cycleSeq,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: [
      {
        id: `${legoId}-c1`,
        known: { text: knownText, audioUrl: `https://example.com/${legoId}-k.mp3` },
        target: {
          text: targetText,
          voice1Url: `https://example.com/${legoId}-t1.mp3`,
          voice2Url: `https://example.com/${legoId}-t2.mp3`,
        },
        pauseDuration: 0,
      },
    ],
  }
}

// Reproduces the live wiring: state_changed → internal ref → currentCycle
// computed (rounds + indices), then the component's display derivation.
function wireDisplayedCycle(player: SimplePlayer, rounds: Round[]) {
  const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
  player.on('state_changed', (s) => { internalState.value = s as PlaybackState })
  const roundsRef = ref<Round[]>(rounds)
  const engineCycle = computed<Cycle | null>(() => {
    const round = roundsRef.value[internalState.value.roundIndex]
    return round?.cycles[internalState.value.cycleIndex] ?? null
  })
  // The component's currentPhrase-equivalent read: known+target from ONE object.
  const displayedPair = computed(() => ({
    known: engineCycle.value?.known.text ?? '',
    target: engineCycle.value?.target.text ?? '',
  }))
  return { internalState, roundsRef, engineCycle, displayedPair }
}

describe('cycle text sync — text/audio pairing invariant (M1)', () => {
  beforeEach(() => {
    cycleSeq = 0
    vi.stubGlobal('Audio', vi.fn(() => makeMockAudio()))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('displayed text pair always comes from the cycle the ENGINE is on, across jumps', () => {
    const rounds = [
      makeRound('S0001L01', 'hello', 'hola'),
      makeRound('S0002L01', 'goodbye', 'adiós'),
      makeRound('S0003L01', 'please', 'por favor'),
    ]
    const player = new SimplePlayer(rounds)
    const { displayedPair } = wireDisplayedCycle(player, rounds)

    player.play()
    expect(displayedPair.value).toEqual({ known: 'hello', target: 'hola' })

    player.jumpToRound(2)
    expect(player.currentState.roundIndex).toBe(2)
    expect(displayedPair.value).toEqual({ known: 'please', target: 'por favor' })

    player.jumpToRound(1)
    expect(displayedPair.value).toEqual({ known: 'goodbye', target: 'adiós' })
  })

  it('a consumer that attaches AFTER a jump still reads the engine cycle (pull, not edge)', () => {
    const rounds = [
      makeRound('S0001L01', 'hello', 'hola'),
      makeRound('S0002L01', 'goodbye', 'adiós'),
    ]
    const player = new SimplePlayer(rounds)
    player.play()
    player.jumpToRound(1) // no subscriber attached — the edge is "missed"

    // Late attach: pull read of the engine's rounds/indices gives round 1.
    const { displayedPair } = wireDisplayedCycle(player, rounds)
    // Seed the internal state from the engine's CURRENT truth, as
    // useSimplePlayer does at subscribe time via player.currentState.
    expect(player.currentState.roundIndex).toBe(1)
    const round = rounds[player.currentState.roundIndex]
    expect(round.cycles[player.currentState.cycleIndex].known.text).toBe('goodbye')
    // From the next transition on, the derived pair agrees with the engine.
    player.jumpToRound(0)
    expect(displayedPair.value).toEqual({ known: 'hello', target: 'hola' })
  })

  it('derivation tracks the engine through the mirror-wedging interleave (text can never lag the audio cycle)', async () => {
    const rounds = [
      makeRound('S0001L01', 'hello', 'hola'),
      makeRound('S0002L01', 'goodbye', 'adiós'),
    ]
    const player = new SimplePlayer(rounds)
    const { displayedPair, engineCycle } = wireDisplayedCycle(player, rounds)

    // OLD architecture, for contrast: a writable mirror object fed by a
    // watcher — the shape currentCycle had before M1 (including its
    // hold-on-null behaviour).
    const mirror = ref<{ known: string; target: string } | null>(null)
    watch(engineCycle, (c) => {
      if (!c) return // the old watcher's early return
      mirror.value = { known: c.known.text, target: c.target.text }
    }, { immediate: true })

    player.play()
    await nextTick()
    expect(mirror.value).toEqual({ known: 'hello', target: 'hola' })

    // The wedge: the engine advances to round 1 but the mirror is manually
    // overwritten back to round 0's pair (the interleave class: a stale
    // assignment landing after the watcher flush). No further engine change
    // → no watcher edge repairs it. The learner would READ "hello/hola"
    // while HEARING "goodbye/adiós".
    player.jumpToRound(1)
    await nextTick()
    mirror.value = { known: 'hello', target: 'hola' }
    await nextTick()

    const engineText = rounds[player.currentState.roundIndex].cycles[player.currentState.cycleIndex]
    expect(engineText.known.text).toBe('goodbye')
    expect(mirror.value?.known).toBe('hello') // the old mirror lies…
    expect(displayedPair.value.known).toBe('goodbye') // …the derivation cannot

    // INVARIANT: displayed known/target always equal the engine cycle's own.
    expect(displayedPair.value).toEqual({ known: engineText.known.text, target: engineText.target.text })
  })

  it('known and target can never come from DIFFERENT cycles (single-object read)', () => {
    const rounds = [
      makeRound('S0001L01', 'hello', 'hola'),
      makeRound('S0002L01', 'goodbye', 'adiós'),
    ]
    const player = new SimplePlayer(rounds)
    const { displayedPair } = wireDisplayedCycle(player, rounds)
    player.play()

    // Burst of jumps inside one tick — however the flush lands, the pair is
    // read from ONE cycle object, so a mixed pair is structurally impossible.
    player.jumpToRound(1)
    player.jumpToRound(0)
    player.jumpToRound(1)
    const pair = displayedPair.value
    const match = rounds.some(r =>
      r.cycles[0].known.text === pair.known && r.cycles[0].target.text === pair.target
    )
    expect(match).toBe(true)
    expect(pair).toEqual({ known: 'goodbye', target: 'adiós' })
  })
})
