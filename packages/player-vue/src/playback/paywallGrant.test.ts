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
import { grantAction, recoverHeldPosition, restoreHeldPosition, type RestoreEngine } from './paywallGrant'

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
  it('a grant whose restore FAILED lowers the wall and RECOVERS the place — never resumes at the retreat, never sits paused (job #757)', () => {
    expect(grantAction({ held: true, restored: false, accessNow: true })).toBe('lower-and-recover')
  })
  it('no access yet: the wall stays', () => {
    expect(grantAction({ held: true, restored: false, accessNow: false })).toBe('stay')
    expect(grantAction({ held: false, restored: false, accessNow: false })).toBe('stay')
  })
})

// Job #757: the held LEGO is absent because the queue is the PREVIEW the server
// issued before the grant. Waiting never brings it; a refetch under the grant
// does. Real test against a fake engine whose refetch grows the queue.
describe('recoverHeldPosition', () => {
  it('refetches when the live queue lacks the held LEGO, then restores onto it and reports success', async () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 0, cycleIndex: 0, legoId: 'S0031L01' })
    const e = fakeEngine(['S0019L01'])
    let refetches = 0
    const ok = await recoverHeldPosition(m, e, upTo(999), async () => { refetches += 1; e.add(['S0020L01', 'S0031L01']) })
    expect(ok).toBe(true)
    expect(refetches).toBe(1)
    expect(e.currentLegoId()).toBe('S0031L01')
    expect(m.blocksPersist()).toBe(true) // spent by the play-on prompt, not here
  })

  it('does not refetch when the LEGO is already in the queue', async () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 0, cycleIndex: 1, legoId: 'S0031L01' })
    const e = fakeEngine(['S0019L01', 'S0031L01'])
    let refetches = 0
    expect(await recoverHeldPosition(m, e, upTo(999), async () => { refetches += 1 })).toBe(true)
    expect(refetches).toBe(0)
    expect(e.currentLegoId()).toBe('S0031L01')
  })

  it('a refetch that throws, or that still lacks the LEGO, is a failure that keeps the memory and moves nothing', async () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 0, cycleIndex: 0, legoId: 'S0031L01' })
    const e = fakeEngine(['S0019L01'])
    expect(await recoverHeldPosition(m, e, upTo(999), async () => { throw new Error('offline') })).toBe(false)
    expect(await recoverHeldPosition(m, e, upTo(999), async () => { e.add(['S0020L01']) })).toBe(false)
    expect(e.currentLegoId()).toBe('S0019L01')
    expect(m.blocksPersist()).toBe(true)
  })

  it('never refetches when nothing is held or the held seed is still locked', async () => {
    const m = createPaywallRetreat()
    const e = fakeEngine(['S0019L01'])
    let refetches = 0
    const refetch = async () => { refetches += 1 }
    expect(await recoverHeldPosition(m, e, upTo(999), refetch)).toBe(false)
    m.remember({ roundIndex: 0, cycleIndex: 0, legoId: 'S0031L01' })
    expect(await recoverHeldPosition(m, e, upTo(19), refetch)).toBe(false)
    expect(refetches).toBe(0)
  })
})
