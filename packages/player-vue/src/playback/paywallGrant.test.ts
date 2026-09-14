/**
 * A grant only resumes automatically after a SUCCESSFUL restore of the held
 * real position (job #752 addition, from a cold verify of #745).
 *
 * Before: the liveEntitlements watcher tried the restore, and whether or not
 * it worked — the remembered LEGO not yet in the engine queue (lazy load not
 * there yet, or the queue still the preview window), or jumpToRound throwing —
 * it lowered the wall and resumed at the RETREATED position. Real test against
 * a fake engine, not a source-ordering read.
 */
import { describe, it, expect } from 'vitest'
import { createPaywallRetreat } from './paywallRetreat'
import { grantAction, restoreHeldPosition, type RestoreEngine } from './paywallGrant'

const upTo = (max: number) => (seed: number) => seed <= max

function fakeEngine(legos: string[], opts: { throwOnJump?: boolean } = {}) {
  let idx = 0
  const queue = [...legos]
  const engine: RestoreEngine & { idx: () => number; add: (more: string[]) => void } = {
    getEngineRounds: () => queue.map((legoId) => ({ legoId })),
    jumpToRound: (roundIndex) => {
      if (opts.throwOnJump) throw new Error('engine not ready')
      idx = roundIndex
    },
    currentLegoId: () => queue[idx] ?? null,
    idx: () => idx,
    add: (more) => { queue.push(...more) },
  }
  return engine
}

describe('restoreHeldPosition', () => {
  it('puts the engine on the held LEGO and reports success; the memory stays held for the play-on prompt', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 0, cycleIndex: 2, legoId: 'S0031L01' })
    const e = fakeEngine(['S0019L01', 'S0020L01', 'S0031L01'])
    expect(restoreHeldPosition(m, e, upTo(999))).toBe(true)
    expect(e.currentLegoId()).toBe('S0031L01')
    expect(m.blocksPersist()).toBe(true)
  })

  it('fails without moving when the LEGO is not in the queue yet, and succeeds once rounds arrive', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 0, cycleIndex: 0, legoId: 'S0031L01' })
    const e = fakeEngine(['S0019L01'])
    expect(restoreHeldPosition(m, e, upTo(999))).toBe(false)
    expect(e.currentLegoId()).toBe('S0019L01')
    expect(m.blocksPersist()).toBe(true)
    e.add(['S0020L01', 'S0031L01'])
    expect(restoreHeldPosition(m, e, upTo(999))).toBe(true)
    expect(e.currentLegoId()).toBe('S0031L01')
  })

  it('fails when the engine refuses the jump, keeping the memory', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 0, cycleIndex: 0, legoId: 'S0031L01' })
    const e = fakeEngine(['S0019L01', 'S0031L01'], { throwOnJump: true })
    expect(restoreHeldPosition(m, e, upTo(999))).toBe(false)
    expect(m.blocksPersist()).toBe(true)
  })

  it('does nothing while the held seed is still locked, or when nothing is held', () => {
    const m = createPaywallRetreat()
    const e = fakeEngine(['S0019L01', 'S0031L01'])
    expect(restoreHeldPosition(m, e, upTo(999))).toBe(false)
    m.remember({ roundIndex: 0, cycleIndex: 0, legoId: 'S0031L01' })
    expect(restoreHeldPosition(m, e, upTo(19))).toBe(false)
    expect(e.currentLegoId()).toBe('S0019L01')
  })
})

describe('grantAction', () => {
  it('a grant with nothing held lowers the wall and resumes', () => {
    expect(grantAction({ held: false, restored: false, accessNow: true })).toBe('lower-and-resume')
  })
  it('a grant whose restore succeeded lowers the wall and resumes on the real place', () => {
    expect(grantAction({ held: true, restored: true, accessNow: true })).toBe('lower-and-resume')
  })
  it('a grant whose restore FAILED lowers the wall but never resumes at the retreat', () => {
    expect(grantAction({ held: true, restored: false, accessNow: true })).toBe('lower-paused')
  })
  it('no access yet: the wall stays', () => {
    expect(grantAction({ held: true, restored: false, accessNow: false })).toBe('stay')
    expect(grantAction({ held: false, restored: false, accessNow: false })).toBe('stay')
  })
})
