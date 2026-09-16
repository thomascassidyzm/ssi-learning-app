/**
 * Every producer of a Round stamps WHICH LOOP it belongs to (core
 * Round.revival). LearningPlayer's isMainLoopRound reads the stamp first and
 * only falls back to the round's shape when it is absent.
 *
 * Why (Tom, 2026-09-14): a Basque learner two seeds past the last LEGO with
 * audio saw the red infinite-play bar, a frozen belt and INF PLAY navigation
 * while the cursor still said seed 87 — the round was a MAIN-LOOP round whose
 * LEGO had no audio yet, so it carried no intro/debut/build cycle and the
 * shape check called it a revival round. Shape is a symptom; the stamp is the
 * fact.
 */
import { describe, it, expect } from 'vitest'
import { backendCyclesToRounds, infPlayCyclesToRounds } from './backendCyclesToRounds'
import { toSimpleRounds } from './toSimpleRounds'

const backendCycle = (over: Record<string, unknown> = {}) => ({
  lego_id: 'S0001L01',
  id: 'c-1',
  seed_number: 1,
  type: 'build',
  known_text: 'a prompt',
  target_text: 'une invite',
  audio: { known_id: 'k-1', target1_id: 't1-1', target2_id: 't2-1', presentation_id: 'p-1' },
  durations: { target1_ms: 1000, target2_ms: 1000 },
  ...over,
})

const scriptItem = (over: Record<string, unknown> = {}) => ({
  uuid: `u${Math.round(Number(over.cycleNum ?? 1))}`,
  cycleNum: 1,
  roundNumber: 1,
  seedId: 'S0001',
  legoKey: 'S0001L01',
  seedCode: 'S0001',
  legoCode: 'L01',
  type: 'spaced_rep',
  knownText: 'a prompt',
  targetText: 'une invite',
  knownAudioId: 'k-1',
  target1Id: 't1-1',
  target2Id: 't2-1',
  target1DurationMs: 1000,
  target2DurationMs: 1000,
  isNew: false,
  ...over,
})

describe('Round.revival — the producer says which loop a round belongs to', () => {
  it('instant-playback main-loop rounds are stamped revival:false even when review-only', () => {
    // The Basque shape: a main-loop round with NO intro/debut/build — only
    // reviews of earlier LEGOs, because this LEGO's own audio is missing.
    const cycles = [
      backendCycle({ type: 'review', lego_id: 'S0080L01', id: 'r-1' }),
      backendCycle({ type: 'review', lego_id: 'S0081L01', id: 'r-2', known_text: 'b', target_text: 'b-t' }),
    ]
    const rounds = backendCyclesToRounds(
      () => cycles as any,
      { rounds: [{ r: 87, legoId: 'S0087L01', seed: 87 }] } as any,
    )
    expect(rounds).toHaveLength(1)
    expect(rounds[0].revival).toBe(false)
  })

  it('INF PLAY wire rounds are stamped revival:true', () => {
    const rounds = infPlayCyclesToRounds([backendCycle({ inf_round: 1 })] as any, 10)
    expect(rounds).toHaveLength(1)
    expect(rounds[0].revival).toBe(true)
  })

  it('the legacy generator path carries the item stamp onto the round, and leaves it off when the items have none', () => {
    const main = toSimpleRounds([scriptItem({ cycleNum: 1, revival: false })] as any)
    expect(main[0].revival).toBe(false)
    const tail = toSimpleRounds([scriptItem({ cycleNum: 1, roundNumber: 900, revival: true })] as any)
    expect(tail[0].revival).toBe(true)
    // A cached script written before the stamp existed: no field, so the
    // consumer falls back to shape rather than being told a falsehood.
    const old = toSimpleRounds([scriptItem({ cycleNum: 1 })] as any)
    expect('revival' in old[0]).toBe(false)
  })
})
