/**
 * The people-first teacher↔class assignment seam.
 *
 * Three things this pins, because each is a way the feature could quietly
 * lie to a school leader:
 *   1. The DIFF — ticked-not-current adds, current-not-ticked removes. A
 *      "move Ana from 6B to 7A" must be exactly one add and one remove.
 *   2. set_lead — assigning a supply teacher to a staffed class must NEVER
 *      take the lead off its teacher. Only a class with nobody on it hands
 *      the lead over.
 *   3. PARTIAL failure stays visibly partial, naming the class and carrying
 *      the server's own error string (RLS doctrine rule 8 — no false "Saved").
 */
import { describe, it, expect, vi } from 'vitest'
import {
  computeAssignmentDiff,
  shouldSetLead,
  applyAssignmentDiff,
  summariseOutcomes,
  type AssignableClass,
} from './assignTeacherClasses'

function cls(id: string, over: Partial<AssignableClass> = {}): AssignableClass {
  return { id, class_name: id.toUpperCase(), isMember: false, hasActiveTeacher: true, ...over }
}

describe('computeAssignmentDiff', () => {
  it('adds newly-ticked classes and removes newly-unticked ones', () => {
    expect(computeAssignmentDiff(['6b'], ['7a'])).toEqual({ add: ['7a'], remove: ['6b'] })
  })

  it('is a no-op when nothing changed', () => {
    expect(computeAssignmentDiff(['6b', '7a'], ['7a', '6b'])).toEqual({ add: [], remove: [] })
  })

  it('handles a first assignment (no current classes)', () => {
    expect(computeAssignmentDiff([], ['6b', '7a'])).toEqual({ add: ['6b', '7a'], remove: [] })
  })

  it('handles taking a teacher off everything', () => {
    expect(computeAssignmentDiff(['6b', '7a'], [])).toEqual({ add: [], remove: ['6b', '7a'] })
  })
})

describe('shouldSetLead', () => {
  it('does NOT set lead when the class already has an active teacher', () => {
    expect(shouldSetLead({ hasActiveTeacher: true })).toBe(false)
  })

  it('sets lead only when the class has no active teacher at all', () => {
    expect(shouldSetLead({ hasActiveTeacher: false })).toBe(true)
  })
})

describe('applyAssignmentDiff', () => {
  const ok = { ok: true, error: null }

  it('adds and removes through the sanctioned helpers, adds first', async () => {
    const calls: string[] = []
    const add = vi.fn(async (classId: string) => { calls.push(`add:${classId}`); return ok })
    const remove = vi.fn(async (classId: string) => { calls.push(`remove:${classId}`); return ok })

    const outcomes = await applyAssignmentDiff({
      teacherUserId: 'u-ana',
      diff: { add: ['7a'], remove: ['6b'] },
      classes: [cls('6b', { isMember: true }), cls('7a')],
      addClassTeacher: add,
      removeClassTeacher: remove,
    })

    expect(calls).toEqual(['add:7a', 'remove:6b'])
    expect(add).toHaveBeenCalledWith('7a', 'u-ana', undefined)
    expect(remove).toHaveBeenCalledWith('6b', 'u-ana')
    expect(outcomes.every(o => o.ok)).toBe(true)
  })

  it('joins a staffed class as a CO-TEACHER — never sets the lead', async () => {
    const add = vi.fn(async () => ok)
    await applyAssignmentDiff({
      teacherUserId: 'u-supply',
      diff: { add: ['7a'], remove: [] },
      classes: [cls('7a', { hasActiveTeacher: true })],
      addClassTeacher: add,
      removeClassTeacher: vi.fn(async () => ok),
    })
    // undefined, not { lead: true } — the endpoint leaves the lead pointer alone.
    expect(add).toHaveBeenCalledWith('7a', 'u-supply', undefined)
  })

  it('takes the lead only on a class with no active teacher', async () => {
    const add = vi.fn(async () => ok)
    await applyAssignmentDiff({
      teacherUserId: 'u-ana',
      diff: { add: ['new1'], remove: [] },
      classes: [cls('new1', { hasActiveTeacher: false })],
      addClassTeacher: add,
      removeClassTeacher: vi.fn(async () => ok),
    })
    expect(add).toHaveBeenCalledWith('new1', 'u-ana', { lead: true })
  })

  it('reports EVERY write, so four saves and one failure stay partial', async () => {
    const add = vi.fn(async (classId: string) =>
      classId === '9c' ? { ok: false, error: 'Not authorised for this class' } : ok
    )
    const outcomes = await applyAssignmentDiff({
      teacherUserId: 'u-ana',
      diff: { add: ['6b', '7a', '8d', '9c', '10e'], remove: [] },
      classes: [cls('6b'), cls('7a'), cls('8d'), cls('9c'), cls('10e')],
      addClassTeacher: add,
      removeClassTeacher: vi.fn(async () => ok),
    })

    expect(outcomes).toHaveLength(5)
    const failed = outcomes.filter(o => !o.ok)
    expect(failed).toHaveLength(1)
    // The failing class is NAMED and carries the server's own words.
    expect(failed[0].className).toBe('9C')
    expect(failed[0].error).toBe('Not authorised for this class')
  })

  it('a thrown helper becomes a reported failure, never a swallowed one', async () => {
    const outcomes = await applyAssignmentDiff({
      teacherUserId: 'u-ana',
      diff: { add: [], remove: ['6b'] },
      classes: [cls('6b', { isMember: true })],
      addClassTeacher: vi.fn(async () => ok),
      removeClassTeacher: vi.fn(async () => { throw new Error('Network down') }),
    })
    expect(outcomes[0]).toMatchObject({ ok: false, error: 'Network down', action: 'remove' })
  })
})

describe('summariseOutcomes', () => {
  it('says plainly what happened on a clean move', () => {
    const s = summariseOutcomes([
      { classId: '7a', className: '7A', action: 'add', ok: true, error: null },
      { classId: '6b', className: '6B', action: 'remove', ok: true, error: null },
    ], 'Ana')
    expect(s).toBe('Ana added to 1 class and removed from 1 class.')
  })

  it('never says "Done" when part of it failed', () => {
    const s = summariseOutcomes([
      { classId: '7a', className: '7A', action: 'add', ok: true, error: null },
      { classId: '9c', className: '9C', action: 'add', ok: false, error: 'nope' },
    ], 'Ana')
    expect(s).toMatch(/Partly done/)
    expect(s).toMatch(/did NOT save/)
  })

  it('is honest when nothing at all saved', () => {
    const s = summariseOutcomes([
      { classId: '9c', className: '9C', action: 'add', ok: false, error: 'nope' },
    ], 'Ana')
    expect(s).toMatch(/Nothing was changed/)
  })
})
