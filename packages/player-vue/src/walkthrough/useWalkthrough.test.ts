// Runtime state-machine tests — start/next/back/terminal/stop, offer
// filtering, and the DOM breadcrumb the e2e harness asserts on.
import { describe, it, expect, beforeEach } from 'vitest'
import { useWalkthrough, walksFor, walkById, startWalk, stopWalk } from './useWalkthrough'
import pack from './pack.json'

const w = useWalkthrough()

beforeEach(() => stopWalk())

describe('pack shape', () => {
  it('bundles the five founding walks', () => {
    const ids = pack.walks.map((x) => x.id)
    for (const id of ['invite-first-teacher', 'run-class-session', 'ways-in', 'reading-insights', 'invites-desk']) {
      expect(ids).toContain(id)
    }
  })
})

describe('walksFor (offer filtering)', () => {
  it('filters by persona × place × kind', () => {
    expect(walksFor('teacher', 'class-detail').map((x) => x.id)).toEqual(['run-class-session'])
    expect(walksFor('admin', 'admin-invites').map((x) => x.id)).toEqual(['invites-desk'])
    expect(walksFor('teacher', 'admin-invites')).toEqual([])
    // node-home kinds: invite-first-teacher is school-only; ways-in covers groups too
    const school = walksFor('leader', 'node-home', 'school').map((x) => x.id)
    expect(school).toContain('invite-first-teacher')
    expect(school).toContain('ways-in')
    const group = walksFor('leader', 'node-home', 'group').map((x) => x.id)
    expect(group).not.toContain('invite-first-teacher')
    expect(group).toContain('ways-in')
  })
})

describe('state machine', () => {
  it('never auto-plays: no active walk until startWalk is called', () => {
    expect(w.activeWalk.value).toBeNull()
    expect(document.documentElement.hasAttribute('data-walk-active')).toBe(false)
  })

  it('startWalk on an unknown id is a no-op returning false', () => {
    expect(startWalk('ghost')).toBe(false)
    expect(w.activeWalk.value).toBeNull()
  })

  it('walks forward, back, into terminal, and out', () => {
    expect(startWalk('ways-in')).toBe(true)
    const steps = walkById('ways-in')!.steps
    expect(w.stepIndex.value).toBe(0)
    expect(document.documentElement.getAttribute('data-walk-active')).toBe('ways-in:0')

    w.next()
    expect(w.stepIndex.value).toBe(1)
    w.back()
    expect(w.stepIndex.value).toBe(0)
    w.back() // at the start — stays
    expect(w.stepIndex.value).toBe(0)

    for (let i = 1; i < steps.length; i++) w.next()
    expect(w.stepIndex.value).toBe(steps.length - 1)

    w.next() // last step has terminal → terminal card, not exit
    expect(w.showingTerminal.value).toBe(true)
    expect(document.documentElement.getAttribute('data-walk-active')).toContain(':done')

    w.back() // back out of terminal to the last step
    expect(w.showingTerminal.value).toBe(false)
    expect(w.stepIndex.value).toBe(steps.length - 1)

    w.next()
    w.next() // Done → walk ends
    expect(w.activeWalk.value).toBeNull()
    expect(document.documentElement.hasAttribute('data-walk-active')).toBe(false)
  })

  it('stopWalk clears state and breadcrumb from any point', () => {
    startWalk('invites-desk')
    w.next()
    stopWalk()
    expect(w.activeWalk.value).toBeNull()
    expect(w.stepIndex.value).toBe(0)
    expect(document.documentElement.hasAttribute('data-walk-active')).toBe(false)
  })
})
