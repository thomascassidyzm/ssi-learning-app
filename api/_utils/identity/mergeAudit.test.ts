import { describe, it, expect } from 'vitest'
import {
  buildMergeRecord,
  deriveUndoPlan,
  detectDeadSideActivity,
  violatesEntitlementConservation,
  type IdentitySnapshot,
  type MergeRecord,
} from './mergeAudit'

const anonSide: IdentitySnapshot = {
  learnerId: null,
  authUserIds: [],
  verifiedEmails: [],
  anonId: 'anon-1234',
  appUserId: 'anon:1234',
  entitlements: ['hin_for_eng'],
  displayName: null,
}

const namedSide: IdentitySnapshot = {
  learnerId: 'L-absorbed',
  authUserIds: ['auth-old'],
  verifiedEmails: ['ravi@gmail.com'],
  anonId: null,
  appUserId: 'learner:L-absorbed',
  entitlements: ['hin_for_eng'],
  displayName: 'Ravi',
}

function mergedRecord(): MergeRecord {
  return buildMergeRecord({
    kind: 'merge',
    initiatedBy: 'auth-new',
    from: namedSide,
    toLearnerId: 'L-survivor',
    toEntitlements: ['spa_for_eng'],
    movedRows: { sessions: ['s1', 's2'], course_enrollments: ['e1'] },
    evidence: { door: 'otp:ravi@gmail.com', offerAcceptedAt: '2026-09-03T10:00:00Z', notes: [] },
  })
}

describe('buildMergeRecord — snapshot before anything moves', () => {
  it('builds a full, attributable record with the I4 union asserted', () => {
    const r = mergedRecord()
    expect(r.initiatedBy).toBe('auth-new')
    expect(r.entitlementUnion).toEqual(['hin_for_eng', 'spa_for_eng'])
    expect(r.undoneAt).toBeNull()
  })

  it('refuses an unattributable act', () => {
    expect(() =>
      buildMergeRecord({
        kind: 'alias',
        initiatedBy: '',
        from: anonSide,
        toLearnerId: 'L1',
        toEntitlements: [],
        movedRows: {},
        evidence: { door: 'google:x@gmail.com', offerAcceptedAt: null, notes: [] },
      }),
    ).toThrow(/attributable/)
  })

  it('D9: a merge or two-sided alias without an accepted offer refuses', () => {
    for (const kind of ['merge', 'two_sided_alias'] as const) {
      expect(() =>
        buildMergeRecord({
          kind,
          initiatedBy: 'auth-new',
          from: kind === 'merge' ? namedSide : anonSide,
          toLearnerId: 'L1',
          toEntitlements: [],
          movedRows: {},
          evidence: { door: 'otp:x@y.z', offerAcceptedAt: null, notes: [] },
        }),
      ).toThrow(/accepted offer/)
    }
  })

  it('D9: refuses to record an unnamed absorption as a merge', () => {
    expect(() =>
      buildMergeRecord({
        kind: 'merge',
        initiatedBy: 'auth-new',
        from: anonSide,
        toLearnerId: 'L1',
        toEntitlements: [],
        movedRows: {},
        evidence: { door: 'otp:x@y.z', offerAcceptedAt: '2026-09-03T10:00:00Z', notes: [] },
      }),
    ).toThrow(/alias/)
  })

  it('refuses an alias record with no anon id', () => {
    expect(() =>
      buildMergeRecord({
        kind: 'alias',
        initiatedBy: 'auth-new',
        from: { ...anonSide, anonId: null },
        toLearnerId: 'L1',
        toEntitlements: [],
        movedRows: {},
        evidence: { door: 'google:x@gmail.com', offerAcceptedAt: null, notes: [] },
      }),
    ).toThrow(/anon id/)
  })

  it('refuses a self-merge', () => {
    expect(() =>
      buildMergeRecord({
        kind: 'merge',
        initiatedBy: 'auth-new',
        from: { ...namedSide, learnerId: 'L1' },
        toLearnerId: 'L1',
        toEntitlements: [],
        movedRows: {},
        evidence: { door: 'otp:x@y.z', offerAcceptedAt: '2026-09-03T10:00:00Z', notes: [] },
      }),
    ).toThrow(/itself/)
  })

  it('snapshots defensively — mutating inputs after build changes nothing', () => {
    const from = { ...namedSide, verifiedEmails: ['ravi@gmail.com'] }
    const moved = { sessions: ['s1'] }
    const r = buildMergeRecord({
      kind: 'merge',
      initiatedBy: 'auth-new',
      from,
      toLearnerId: 'L-survivor',
      toEntitlements: [],
      movedRows: moved,
      evidence: { door: 'otp:ravi@gmail.com', offerAcceptedAt: '2026-09-03T10:00:00Z', notes: [] },
    })
    from.verifiedEmails.push('planted@evil.com')
    moved.sessions.push('s-extra')
    expect(r.fromIdentity.verifiedEmails).toEqual(['ravi@gmail.com'])
    expect(r.movedRows.sessions).toEqual(['s1'])
  })
})

describe('deriveUndoPlan — the named undo, by recorded id', () => {
  it('restores the learner, its emails, its auth links and every moved row', () => {
    const plan = deriveUndoPlan(mergedRecord())
    const ops = plan.steps.map((s) => s.op)
    expect(ops).toContain('restore_learner')
    expect(ops).toContain('restore_verified_emails')
    expect(ops).toContain('restore_auth_link')
    const repoints = plan.steps.filter((s) => s.op === 'repoint_rows')
    expect(repoints.map((s) => s.table).sort()).toEqual(['course_enrollments', 'sessions'])
    expect(repoints.find((s) => s.table === 'sessions')?.rowIds).toEqual(['s1', 's2'])
  })

  it('states what is NOT restored rather than implying it (§6.8, D11)', () => {
    const plan = deriveUndoPlan(mergedRecord())
    expect(plan.notRestored.join(' ')).toMatch(/timestamp is the cut/)
    expect(plan.notRestored.join(' ')).toMatch(/RevenueCat/)
  })

  it('refuses to plan a second undo', () => {
    const r = { ...mergedRecord(), undoneAt: '2026-09-04T00:00:00Z' }
    expect(() => deriveUndoPlan(r)).toThrow(/already undone/)
  })

  it('an anon alias undo has no learner/email steps, only row re-points', () => {
    const r = buildMergeRecord({
      kind: 'alias',
      initiatedBy: 'auth-new',
      from: anonSide,
      toLearnerId: 'L1',
      toEntitlements: [],
      movedRows: { purchases: ['p1'] },
      evidence: { door: 'google:x@gmail.com', offerAcceptedAt: null, notes: [] },
    })
    const plan = deriveUndoPlan(r)
    expect(plan.steps.every((s) => s.op === 'repoint_rows')).toBe(true)
  })
})

describe('tripwire 1 — dead-side activity', () => {
  it('flags a sign-in animating an absorbed auth uid', () => {
    const r = mergedRecord()
    expect(detectDeadSideActivity({ authUserId: 'auth-old' }, [r])).toBe(r)
  })

  it('flags an absorbed email arriving through a fresh door, case-insensitively', () => {
    const r = mergedRecord()
    expect(detectDeadSideActivity({ email: 'Ravi@Gmail.com' }, [r])).toBe(r)
  })

  it('flags an absorbed app_user_id in a webhook', () => {
    const r = mergedRecord()
    expect(detectDeadSideActivity({ appUserId: 'learner:L-absorbed' }, [r])).toBe(r)
  })

  it('stays quiet for the survivor and for undone records', () => {
    const r = mergedRecord()
    expect(detectDeadSideActivity({ authUserId: 'auth-new' }, [r])).toBeNull()
    const undone = { ...r, undoneAt: '2026-09-04T00:00:00Z' }
    expect(detectDeadSideActivity({ authUserId: 'auth-old' }, [undone])).toBeNull()
  })
})

describe('tripwire 2 — entitlement conservation (I4)', () => {
  it('quiet when the union is intact (extra entitlements are fine)', () => {
    const r = mergedRecord()
    expect(violatesEntitlementConservation(r, ['hin_for_eng', 'spa_for_eng', 'fra_for_eng'])).toBe(false)
  })
  it('fires when the survivor resolves to less than the asserted union', () => {
    const r = mergedRecord()
    expect(violatesEntitlementConservation(r, ['spa_for_eng'])).toBe(true)
  })
})
