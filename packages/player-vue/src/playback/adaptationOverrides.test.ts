import { describe, it, expect } from 'vitest'
import type { RoundPlan } from '@ssi/core'
import type { Round, Cycle } from './SimplePlayer'
import { computeAdaptOmitCycleIds, assembleBreatherRound } from './adaptationOverrides'

function cycle(id: string, type: string, legoId = 'S0010L01'): Cycle {
  return {
    id,
    type,
    legoId,
    known: { text: 'k', audioUrl: '' },
    target: { text: 't', voice1Url: '', voice2Url: '' },
  }
}

function plan(overrides: Partial<RoundPlan> = {}): RoundPlan {
  return {
    buildCount: 7,
    consolidateCount: 2,
    spacedRepCap: 12,
    insertBreather: false,
    returnReady: [],
    pauseMultiplier: () => 1.0,
    ...overrides,
  }
}

describe('computeAdaptOmitCycleIds', () => {
  it('omits nothing when the plan matches the scripted defaults', () => {
    const round: Round = {
      roundNumber: 5,
      legoId: 'S0010L01',
      seedId: 'S0010',
      cycles: [
        cycle('c1', 'build'),
        cycle('c2', 'build'),
        cycle('c3', 'use'),
        cycle('c4', 'use'),
        cycle('c5', 'spaced_rep'),
      ],
    }
    const omit = computeAdaptOmitCycleIds(round, plan())
    expect(omit.size).toBe(0)
  })

  it('culls BUILD cycles beyond buildCount', () => {
    const round: Round = {
      roundNumber: 5,
      legoId: 'S0010L01',
      seedId: 'S0010',
      cycles: [
        cycle('b1', 'build'),
        cycle('b2', 'build'),
        cycle('b3', 'build'),
        cycle('b4', 'build'),
        cycle('intro', 'intro'),
      ],
    }
    const omit = computeAdaptOmitCycleIds(round, plan({ buildCount: 2 }))
    expect(omit).toEqual(new Set(['b3', 'b4']))
  })

  it('culls USE cycles beyond consolidateCount', () => {
    const round: Round = {
      roundNumber: 5,
      legoId: 'S0010L01',
      seedId: 'S0010',
      cycles: [cycle('u1', 'use'), cycle('u2', 'use'), cycle('u3', 'use')],
    }
    const omit = computeAdaptOmitCycleIds(round, plan({ consolidateCount: 1 }))
    expect(omit).toEqual(new Set(['u2', 'u3']))
  })

  it('culls spaced_rep cycles beyond spacedRepCap', () => {
    const round: Round = {
      roundNumber: 5,
      legoId: 'S0010L01',
      seedId: 'S0010',
      cycles: [cycle('r1', 'spaced_rep'), cycle('r2', 'spaced_rep'), cycle('r3', 'spaced_rep')],
    }
    const omit = computeAdaptOmitCycleIds(round, plan({ spacedRepCap: 1 }))
    expect(omit).toEqual(new Set(['r2', 'r3']))
  })

  it('never omits non-build/use/spaced_rep cycles (intro/debut/listening/pod)', () => {
    const round: Round = {
      roundNumber: 5,
      legoId: 'S0010L01',
      seedId: 'S0010',
      cycles: [cycle('intro', 'intro'), cycle('debut', 'debut'), cycle('pod', 'pod')],
    }
    const omit = computeAdaptOmitCycleIds(round, plan({ buildCount: 0, consolidateCount: 0, spacedRepCap: 0 }))
    expect(omit.size).toBe(0)
  })
})

describe('assembleBreatherRound', () => {
  const anchor: Round = { roundNumber: 10, legoId: 'S0020L01', seedId: 'S0020', cycles: [] }

  it('returns null when nothing is mastered yet (early session)', () => {
    const loaded: Round[] = [
      {
        roundNumber: 1,
        legoId: 'S0001L01',
        seedId: 'S0001',
        cycles: [cycle('u1', 'use', 'S0001L01')],
      },
    ]
    const result = assembleBreatherRound(loaded, 0, anchor, () => 1.2) // acquisition ladder — never mastered
    expect(result).toBeNull()
  })

  it('pulls USE cycles from already-loaded rounds whose LEGO reads confident/mastered', () => {
    const loaded: Round[] = [
      { roundNumber: 1, legoId: 'S0001L01', seedId: 'S0001', cycles: [cycle('u1', 'use', 'S0001L01')] },
      { roundNumber: 2, legoId: 'S0002L01', seedId: 'S0002', cycles: [cycle('u2', 'use', 'S0002L01')] },
    ]
    const multipliers: Record<string, number> = { S0001L01: 0.7, S0002L01: 1.2 }
    const result = assembleBreatherRound(loaded, 1, anchor, (legoId) => multipliers[legoId] ?? 1.0)
    expect(result).not.toBeNull()
    expect(result!.cycles).toHaveLength(1)
    expect(result!.cycles[0].id).toBe('u1:breather:10')
    expect(result!.cycles[0].legoId).toBe('S0001L01')
  })

  it('sorts BEFORE the anchor round (fractional roundNumber) and carries a distinct legoId', () => {
    const loaded: Round[] = [
      { roundNumber: 1, legoId: 'S0001L01', seedId: 'S0001', cycles: [cycle('u1', 'use', 'S0001L01')] },
    ]
    const result = assembleBreatherRound(loaded, 0, anchor, () => 0.7)
    expect(result!.roundNumber).toBe(9.5)
    expect(result!.legoId).toBe('S0020L01:breather')
  })

  it('caps at BREATHER_MAX_CYCLES (12) and dedupes by legoId', () => {
    const loaded: Round[] = Array.from({ length: 20 }, (_, i) => ({
      roundNumber: i + 1,
      legoId: `S00${i}L01`,
      seedId: `S00${i}`,
      cycles: [cycle(`u${i}`, 'use', `S00${i}L01`), cycle(`u${i}b`, 'use', `S00${i}L01`)],
    }))
    const result = assembleBreatherRound(loaded, 19, anchor, () => 0.7)
    expect(result!.cycles.length).toBe(12)
    const legoIds = result!.cycles.map((c) => c.legoId)
    expect(new Set(legoIds).size).toBe(legoIds.length) // one per LEGO, no dupes
  })

  it('only considers rounds up to and including uptoRoundIndexInclusive', () => {
    const loaded: Round[] = [
      { roundNumber: 1, legoId: 'S0001L01', seedId: 'S0001', cycles: [cycle('u1', 'use', 'S0001L01')] },
      { roundNumber: 2, legoId: 'S0002L01', seedId: 'S0002', cycles: [cycle('u2', 'use', 'S0002L01')] },
    ]
    // Only round index 0 is in scope — round index 1's mastered LEGO must not appear.
    const result = assembleBreatherRound(loaded, 0, anchor, () => 0.7)
    expect(result!.cycles.map((c) => c.legoId)).toEqual(['S0001L01'])
  })
})

/**
 * COUNTING-UNIT MISMATCH (diagnosis, 2026-08-04 — latent, cannot fire today).
 *
 * `computeAdaptOmitCycleIds` counts PLAY-TIME CYCLES. The script generator's
 * own `spacedRepCount` budget (generateLearningScript.ts, MAX_SPACED_REP_
 * PHRASES = 12) counts REVIEW SLOTS. Those two units agree for ordinary
 * use-phrase reviews (1 slot = 1 cycle) but NOT for the drained SEED-PHASE
 * sandwich (offset >= 144), which is explicitly "one review slot, not
 * phraseCount" yet emits 3-4 `spaced_rep` sub-cycles (target/known/target/
 * target — see `emitSeedSandwich`, and toSimpleRounds.ts's per-role split).
 *
 * So a fully-scripted late-course round can legitimately carry far more than
 * 12 `spaced_rep` CYCLES while being within its 12-SLOT budget — and a plan
 * sitting at its scripted ceiling (spacedRepCap 12, i.e. "cull nothing") would
 * still cull the tail. This is pinned, not fixed: adaptation v2 is live in
 * SHADOW (`algorithm_config.adaptation_v2.shadow = true`, verified 2026-08-04)
 * so nothing is applied and no learner is affected. It must be fixed BEFORE
 * v2 is ever switched to applying.
 */
describe('computeAdaptOmitCycleIds — seed-sandwich counting-unit mismatch (latent)', () => {
  it('culls sandwich sub-cycles even at the scripted ceiling, because it counts cycles not review slots', () => {
    // Four drained seed sandwiches = 4 review SLOTS (well inside the
    // generator's 12-slot budget) but 16 spaced_rep CYCLES.
    const cycles: Cycle[] = []
    for (let slot = 0; slot < 4; slot++) {
      for (let sub = 0; sub < 4; sub++) {
        cycles.push(cycle(`sr${slot}_${sub}`, 'spaced_rep', `S00${slot}L01`))
      }
    }
    const round: Round = { roundNumber: 200, legoId: 'S0200L01', seedId: 'S0200', cycles }

    // plan.spacedRepCap === scripted ceiling === 12 === "cull nothing".
    const omit = computeAdaptOmitCycleIds(round, plan())

    // But four whole sub-cycles are culled anyway — cycles 13..16.
    expect(omit.size).toBe(4)
    expect([...omit]).toEqual(['sr3_0', 'sr3_1', 'sr3_2', 'sr3_3'])
  })
})
