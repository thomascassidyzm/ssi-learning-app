/**
 * REGRESSION: the queue mirror (M4, docs/player/pull-consistency-map.md).
 *
 * useSimplePlayer.roundsRef used to re-implement SimplePlayer's insertion/
 * splice algorithms by hand — one copy per mutation method (addRounds,
 * appendRounds, replaceQueueFromCurrent), each of which had to stay
 * bit-identical to the engine's or the reactive queue sheared against the
 * live one. The INF-PLAY full-script handoff shipped exactly that shear:
 * the displayed text sat before.length rounds AHEAD of the playing audio.
 *
 * Post-M4 the composable PULLS player.roundsSnapshot after every mutation.
 * These tests drive every mutation path at the composable layer (the layer
 * templates actually bind to) and assert the reactive queue and the engine
 * cursor can never disagree — including the exact handoff shape that sheared.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSimplePlayer } from '../composables/useSimplePlayer'
import type { Round } from './SimplePlayer'

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

function makeRound(legoId: string, roundNumber: number): Round {
  return {
    roundNumber,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: [
      {
        id: `${legoId}-r${roundNumber}-c1`,
        known: { text: `known-${roundNumber}`, audioUrl: `https://example.com/${roundNumber}-k.mp3` },
        target: {
          text: `target-${roundNumber}`,
          voice1Url: `https://example.com/${roundNumber}-t1.mp3`,
          voice2Url: `https://example.com/${roundNumber}-t2.mp3`,
        },
        pauseDuration: 0,
      },
    ],
  }
}

/** Walk the whole reactive queue via jumpToRound and return legoIds in order.
 * This reads exactly what the display layer reads (currentRound), so any
 * shear between roundsRef and the engine index surfaces as a wrong legoId. */
function walkQueue(sp: ReturnType<typeof useSimplePlayer>): string[] {
  const ids: string[] = []
  for (let i = 0; i < sp.roundCount.value; i++) {
    sp.jumpToRound(i)
    ids.push(sp.currentRound.value?.legoId ?? '<null>')
  }
  return ids
}

describe('rounds queue sync — the reactive queue is pulled from the engine (M4)', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(() => makeMockAudio()))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('initialize seeds queue and state from the engine (no pre-init default readable)', () => {
    const sp = useSimplePlayer()
    sp.initialize([makeRound('S0001L01', 1), makeRound('S0002L01', 2)])
    expect(sp.roundCount.value).toBe(2)
    expect(sp.state.value.phase).toBe('idle')
    expect(sp.currentRound.value?.legoId).toBe('S0001L01')
    expect(sp.currentCycle.value?.known.text).toBe('known-1')
  })

  it('addRounds: reactive queue matches the engine order/dedupe without a hand-mirrored algorithm', () => {
    const sp = useSimplePlayer()
    sp.initialize([makeRound('S0002L01', 2), makeRound('S0004L01', 4)])
    // Overlap (S0002L01 dupe) + out-of-order inserts before/between/after.
    sp.addRounds([
      makeRound('S0001L01', 1),
      makeRound('S0002L01', 99), // dupe legoId — engine drops it
      makeRound('S0003L01', 3),
      makeRound('S0005L01', 5),
    ])
    expect(sp.roundCount.value).toBe(5)
    expect(walkQueue(sp)).toEqual(['S0001L01', 'S0002L01', 'S0003L01', 'S0004L01', 'S0005L01'])
  })

  it('appendRounds: roundNumber-keyed dedupe, reused legoIds preserved (INF-PLAY expansion shape)', () => {
    const sp = useSimplePlayer()
    sp.initialize([makeRound('S0001L01', 1), makeRound('S0002L01', 2)])
    // INF-PLAY revival rounds REUSE legoIds with fresh roundNumbers; a dupe
    // roundNumber must be dropped, dupe legoIds kept.
    sp.appendRounds([
      makeRound('S0001L01', 3), // reused legoId, new roundNumber — kept
      makeRound('S0002L01', 2), // dupe roundNumber — dropped
      makeRound('S0002L01', 4), // reused legoId, new roundNumber — kept
    ])
    expect(sp.roundCount.value).toBe(4)
    expect(walkQueue(sp)).toEqual(['S0001L01', 'S0002L01', 'S0001L01', 'S0002L01'])
  })

  it('replaceQueueFromCurrent mid-play: display stays on the live round — the INF-PLAY handoff shear is impossible', () => {
    const sp = useSimplePlayer()
    // Bootstrap window: a cold resume loads FORWARD from the cursor only —
    // rounds 3..5 loaded, rounds 1..2 absent (the exact pre-shear setup).
    sp.initialize([makeRound('S0003L01', 3), makeRound('S0004L01', 4), makeRound('S0005L01', 5)])
    sp.play()
    expect(sp.currentCycle.value?.known.text).toBe('known-3')

    // Full script lands: rounds 1..8. Engine splices behind-rounds in front
    // and shifts its cursor; the reactive queue is pulled, not re-derived.
    const fullScript = [1, 2, 3, 4, 5, 6, 7, 8].map(n => makeRound(`S000${n}L01`, n))
    sp.replaceQueueFromCurrent(fullScript)

    // THE invariant that sheared pre-M4: the text the display reads after
    // the handoff is still the live round's — not a round before.length
    // positions away.
    expect(sp.currentCycle.value?.known.text).toBe('known-3')
    expect(sp.currentRound.value?.legoId).toBe('S0003L01')
    expect(sp.roundCount.value).toBe(8)

    // Skip-back now reaches the prepended behind-rounds, in order.
    expect(walkQueue(sp)).toEqual(
      ['S0001L01', 'S0002L01', 'S0003L01', 'S0004L01', 'S0005L01', 'S0006L01', 'S0007L01', 'S0008L01'],
    )
  })

  it('cursor/queue lockstep survives an interleaved mutation burst', () => {
    const sp = useSimplePlayer()
    sp.initialize([makeRound('S0002L01', 2)])
    sp.play()
    sp.addRounds([makeRound('S0001L01', 1)]) // insert BEFORE the playing round
    // Engine shifted its cursor to keep the live round playing; the pulled
    // queue agrees, so the displayed cycle is still round 2's.
    expect(sp.currentCycle.value?.known.text).toBe('known-2')
    sp.appendRounds([makeRound('S0001L01', 3)])
    sp.replaceQueueFromCurrent([1, 2, 3, 4].map(n => makeRound(`S000${n}L01`, n)))
    expect(sp.currentCycle.value?.known.text).toBe('known-2')
    expect(sp.roundCount.value).toBe(4)
  })
})
