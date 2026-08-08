// Runtime state-machine tests — start/next/back/terminal/stop, offer
// filtering, and the DOM breadcrumb the e2e harness asserts on.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  useWalkthrough, walksFor, walkById, startWalk, stopWalk,
  isDestructiveAnchor, effectiveAdvance, type WalkStep,
} from './useWalkthrough'
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
    // Class detail is the teacher's whole desk: running a session, the three
    // co-teaching capabilities (A-74) — sharing, inviting, handover — and,
    // since 2026-08-08, reading the class↔teacher relationship the other way
    // round to move somebody between classes.
    expect(walksFor('teacher', 'class-detail').map((x) => x.id)).toEqual([
      'hand-over-the-lead', 'invite-a-supply-teacher', 'move-a-teacher-between-classes',
      'run-class-session', 'share-a-class',
    ])
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

  // Neutral dressing (kind 'org'): parity with schools — an org leader is
  // offered the same two node-home walks, in the neutral vocabulary. No
  // school-worded walk ever reaches them.
  it('offers the org dressing its own first-person walk plus ways-in', () => {
    const org = walksFor('leader', 'node-home', 'org').map((x) => x.id)
    expect(org).toContain('invite-first-person')
    expect(org).toContain('ways-in')
    expect(org).not.toContain('invite-first-teacher')
    expect(walksFor('admin', 'node-home', 'org').map((x) => x.id)).toContain('invite-first-person')
  })

  it('the org walk never says teacher, class or school', () => {
    const walk = pack.walks.find((x) => x.id === 'invite-first-person')!
    const words = walk.steps.map((s) => s.say).join(' ').toLowerCase()
    for (const ed of ['teacher', 'class', 'school', 'pupil']) expect(words).not.toContain(ed)
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

  it('Esc ends the walk from any step (engine-level escape hatch)', () => {
    startWalk('ways-in')
    w.next()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.activeWalk.value).toBeNull()
    expect(document.documentElement.hasAttribute('data-walk-active')).toBe(false)
    // After the walk ends, Esc is unbound — no lingering listener effects.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.activeWalk.value).toBeNull()
  })

  it('other keys do not end the walk', () => {
    startWalk('ways-in')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(w.activeWalk.value?.id).toBe('ways-in')
  })
})

describe('runtime destructive-verb mirror (stale-pack defence)', () => {
  const step = (anchor: string, on: 'next' | 'click' | 'visible' = 'click'): WalkStep =>
    ({ anchor, say: 'x', advance: { on } })

  it('flags the denylisted verb families', () => {
    for (const anchor of ['verb-delete', 'demo-purge', 'invite-form-submit', 'ways-in-remint', 'invites-active-toggle', 'class-play', 'entitlement-grant']) {
      expect(isDestructiveAnchor(anchor), anchor).toBe(true)
    }
    expect(isDestructiveAnchor('ways-in-ledger')).toBe(false)
    expect(isDestructiveAnchor('insights-measure')).toBe(false)
  })

  it('degrades click-advance on a destructive anchor to show-and-point', () => {
    expect(effectiveAdvance(step('verb-delete', 'click'))).toBe('next')
    expect(effectiveAdvance(step('verb-invite-person', 'click'))).toBe('click')
    expect(effectiveAdvance(step('verb-delete', 'next'))).toBe('next')
    expect(effectiveAdvance(step('some-form', 'visible'))).toBe('visible')
  })

  it('no step in the live pack click-advances a destructive anchor', () => {
    for (const walk of pack.walks) {
      for (const s of walk.steps) {
        if (s.advance.on === 'click') expect(isDestructiveAnchor(s.anchor), `${walk.id}:${s.anchor}`).toBe(false)
      }
    }
  })
})
