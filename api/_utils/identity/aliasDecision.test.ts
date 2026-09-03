import { describe, it, expect } from 'vitest'
import { decideAlias, entitlementUnion, type AnonSummary } from './aliasDecision'

const verified = { sessionVerified: true }
const anonBase: AnonSummary = {
  anonId: 'anon-1234',
  entitlements: [],
  alreadyAliased: false,
  hasLocalProgress: false,
}

describe('decideAlias — the §4 state machine as one function', () => {
  it('I2: refuses everything without a verified session', () => {
    const d = decideAlias(
      { sessionVerified: false },
      { ...anonBase, entitlements: ['hin_for_eng'] },
      { learnerId: 'L1', entitlements: [] },
    )
    expect(d.action).toBe('refuse')
  })

  it('lands only when the install has no anon id', () => {
    const d = decideAlias(verified, { ...anonBase, anonId: null }, { learnerId: 'L1', entitlements: [] })
    expect(d.action).toBe('land_only')
  })

  it('I3: refuses an anon id that already aliased once', () => {
    const d = decideAlias(
      verified,
      { ...anonBase, alreadyAliased: true, entitlements: ['hin_for_eng'] },
      { learnerId: 'L1', entitlements: [] },
    )
    expect(d.action).toBe('refuse')
  })

  it('auto-aliases anon purchases into an account with none (buy-first, §3.5)', () => {
    const d = decideAlias(
      verified,
      { ...anonBase, entitlements: ['hin_for_eng'] },
      { learnerId: 'L1', entitlements: [] },
    )
    expect(d.action).toBe('auto_alias')
  })

  it('auto-aliases local progress even with no purchases anywhere', () => {
    const d = decideAlias(
      verified,
      { ...anonBase, hasLocalProgress: true },
      { learnerId: 'L1', entitlements: [] },
    )
    expect(d.action).toBe('auto_alias')
  })

  it('§6.6: OFFERS (never silently performs) the two-sided case', () => {
    const d = decideAlias(
      verified,
      { ...anonBase, entitlements: ['hin_for_eng'] },
      { learnerId: 'L1', entitlements: ['spa_for_eng'] },
    )
    expect(d.action).toBe('offer_alias')
  })

  it('§6.6 includes the duplicate-purchase shape (same course both sides)', () => {
    const d = decideAlias(
      verified,
      { ...anonBase, entitlements: ['hin_for_eng'] },
      { learnerId: 'L1', entitlements: ['hin_for_eng'] },
    )
    expect(d.action).toBe('offer_alias')
  })

  it('account-side purchases alone (anon empty) is a plain landing', () => {
    const d = decideAlias(verified, anonBase, { learnerId: 'L1', entitlements: ['spa_for_eng'] })
    expect(d.action).toBe('land_only')
  })
})

describe('entitlementUnion — the I4 assertion', () => {
  it('unions, dedupes and sorts', () => {
    expect(entitlementUnion(['b', 'a'], ['a', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('is idempotent on duplicate purchases (§6.6)', () => {
    expect(entitlementUnion(['hin_for_eng'], ['hin_for_eng'])).toEqual(['hin_for_eng'])
  })
})
