import { describe, it, expect } from 'vitest'
import { buildPairs, expandFiredLegoIds } from './buildLegoPairs'
import { buildPairs as reExported } from './usePairingsTelemetry'

/**
 * Job #59. The class co-firing history is replayed into learner_lego_pairings
 * by scripts/backfill-class-lego-pairings.mjs, which imports these two
 * functions rather than reimplementing them. These tests pin the rule they
 * both now run — a drift here is a backfill that disagrees with live play.
 */
describe('the co-firing rule, shared by live play and the job #59 backfill', () => {
  it('is literally the same buildPairs the telemetry composable uses', () => {
    expect(reExported).toBe(buildPairs)
  })

  it('expands a cycle to its own LEGO plus the M-LEGO components, self excluded', () => {
    // A real cym_s_for_eng decomposition: "dw i'n moyn trio ymarfer siarad
    // Cymraeg" — one ghost token with no legoId, and the cycle's own LEGO
    // (S0004L01) appearing among its own components.
    const bound = ['S0001L01', 'S0004L01', 'S0001L02', 'S0001L03']
    expect(expandFiredLegoIds('S0004L01', bound))
      .toEqual(['S0004L01', 'S0001L01', 'S0001L02', 'S0001L03'])
  })

  it('drops empties and tolerates an absent component list', () => {
    expect(expandFiredLegoIds('S0006L01', undefined)).toEqual(['S0006L01'])
    expect(expandFiredLegoIds('S0006L01', ['', 'S0005L01'])).toEqual(['S0006L01', 'S0005L01'])
    expect(expandFiredLegoIds('', ['S0005L01'])).toEqual(['S0005L01'])
  })

  it('fires no pairs for an intro or debut cycle, which has no decomposition', () => {
    expect(buildPairs(expandFiredLegoIds('S0006L01', undefined))).toEqual([])
  })

  it('pairs every unordered combination of the fired set, deduped', () => {
    expect(buildPairs(expandFiredLegoIds('S0004L01', ['S0001L01', 'S0004L01'])))
      .toEqual([['S0004L01', 'S0001L01']])
    expect(buildPairs(['a', 'b', 'c'])).toEqual([['a', 'b'], ['a', 'c'], ['b', 'c']])
  })
})
