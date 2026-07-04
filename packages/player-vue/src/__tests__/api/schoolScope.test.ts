/**
 * Tests for the schools scope resolver (api/_utils/schoolScope.ts).
 *
 * The security contract: a caller only ever sees student learners inside their
 * own branch of the hierarchy — teacher ⊂ school ⊂ group/region. These drive
 * each branch with a fixture-backed mock of the service-role client and assert
 * the resolved learner/class sets.
 */

import { describe, it, expect } from 'vitest'
import { resolveVisibleScope } from '../../../../../api/_utils/schoolScope'

interface Filters {
  eqs: Record<string, unknown>
  ins: Record<string, unknown[]>
  likes: Record<string, string>
}

type Handler = (table: string, f: Filters) => { data: unknown }

// Minimal chainable Supabase mock: records the filter chain, then a per-test
// handler returns the rows for that (table, filters).
function makeClient(handler: Handler): any {
  return {
    from(table: string) {
      const f: Filters = { eqs: {}, ins: {}, likes: {} }
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { f.eqs[col] = val; return builder },
        in: (col: string, vals: unknown[]) => { f.ins[col] = vals; return builder },
        like: (col: string, val: string) => { f.likes[col] = val; return builder },
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(handler(table, f)),
        single: () => Promise.resolve(handler(table, f)),
        then: (onF: any) => Promise.resolve(handler(table, f)).then(onF),
      }
      return builder
    },
  }
}

describe('resolveVisibleScope', () => {
  it('teacher sees only their taught classes\' students', async () => {
    const client = makeClient((table, f) => {
      if (table === 'learners' && f.eqs.user_id === 'teacher-uid')
        return { data: { id: 'L-teacher', educational_role: 'teacher' } }
      if (table === 'class_teachers' && f.eqs.teacher_user_id === 'teacher-uid')
        return { data: [{ class_id: 'C1' }, { class_id: 'C2' }] }
      if (table === 'classes' && f.eqs.teacher_user_id === 'teacher-uid')
        return { data: [] } // no extra lead-pointer classes
      if (table === 'user_tags')
        return { data: [
          { tag_value: 'CLASS:C1', user_id: 's1-uid' },
          { tag_value: 'CLASS:C2', user_id: 's2-uid' },
        ] }
      if (table === 'learners' && Array.isArray(f.ins.user_id))
        return { data: [
          { id: 'L-s1', user_id: 's1-uid' },
          { id: 'L-s2', user_id: 's2-uid' },
        ] }
      return { data: null }
    })

    const scope = await resolveVisibleScope(client, 'teacher-uid')
    expect(scope.role).toBe('teacher')
    expect(scope.classIds.sort()).toEqual(['C1', 'C2'])
    expect(scope.learnerIds.sort()).toEqual(['L-s1', 'L-s2'])
    expect(scope.studentsByClass).toEqual({ C1: ['L-s1'], C2: ['L-s2'] })
  })

  it('school_admin sees the whole school, resolved via the SCHOOL: tag', async () => {
    const client = makeClient((table, f) => {
      if (table === 'learners' && f.eqs.user_id === 'sa-uid')
        return { data: { id: 'L-sa', educational_role: 'school_admin' } }
      if (table === 'user_tags' && f.eqs.tag_type === 'school')
        return { data: { tag_value: 'SCHOOL:SCH1' } }
      if (table === 'classes' && Array.isArray(f.ins.school_id))
        return { data: [{ id: 'C1' }, { id: 'C2' }, { id: 'C3' }] }
      if (table === 'user_tags' && f.eqs.tag_type === 'class')
        return { data: [
          { tag_value: 'CLASS:C1', user_id: 's1-uid' },
          { tag_value: 'CLASS:C3', user_id: 's3-uid' },
        ] }
      if (table === 'learners' && Array.isArray(f.ins.user_id))
        return { data: [
          { id: 'L-s1', user_id: 's1-uid' },
          { id: 'L-s3', user_id: 's3-uid' },
        ] }
      return { data: null }
    })

    const scope = await resolveVisibleScope(client, 'sa-uid')
    expect(scope.role).toBe('school_admin')
    expect(scope.classIds.sort()).toEqual(['C1', 'C2', 'C3'])
    expect(scope.learnerIds.sort()).toEqual(['L-s1', 'L-s3'])
  })

  it('govt_admin sees the group-path subtree\'s schools', async () => {
    const client = makeClient((table, f) => {
      if (table === 'learners' && f.eqs.user_id === 'gov-uid')
        return { data: { id: 'L-gov', educational_role: 'govt_admin' } }
      if (table === 'govt_admins')
        return { data: { region_code: 'WAL', group_id: 'G-wales' } }
      if (table === 'groups' && f.eqs.id === 'G-wales')
        return { data: { path: 'wales.' } }
      if (table === 'groups' && f.likes.path === 'wales.%')
        return { data: [{ id: 'G-wales' }, { id: 'G-cardiff' }] } // subtree
      if (table === 'schools' && Array.isArray(f.ins.group_id))
        return { data: [{ id: 'SCH1' }, { id: 'SCH2' }] }
      if (table === 'classes' && Array.isArray(f.ins.school_id))
        return { data: [{ id: 'C1' }] }
      if (table === 'user_tags' && f.eqs.tag_type === 'class')
        return { data: [{ tag_value: 'CLASS:C1', user_id: 's1-uid' }] }
      if (table === 'learners' && Array.isArray(f.ins.user_id))
        return { data: [{ id: 'L-s1', user_id: 's1-uid' }] }
      return { data: null }
    })

    const scope = await resolveVisibleScope(client, 'gov-uid')
    expect(scope.role).toBe('govt_admin')
    expect(scope.classIds).toEqual(['C1'])
    expect(scope.learnerIds).toEqual(['L-s1'])
  })

  it('govt_admin falls back to region_code when there is no group', async () => {
    const client = makeClient((table, f) => {
      if (table === 'learners' && f.eqs.user_id === 'gov2-uid')
        return { data: { id: 'L-gov2', educational_role: 'govt_admin' } }
      if (table === 'govt_admins')
        return { data: { region_code: 'SCO', group_id: null } }
      if (table === 'schools' && f.eqs.region_code === 'SCO')
        return { data: [{ id: 'SCH9' }] }
      if (table === 'classes' && Array.isArray(f.ins.school_id))
        return { data: [{ id: 'C9' }] }
      if (table === 'user_tags' && f.eqs.tag_type === 'class')
        return { data: [{ tag_value: 'CLASS:C9', user_id: 's9-uid' }] }
      if (table === 'learners' && Array.isArray(f.ins.user_id))
        return { data: [{ id: 'L-s9', user_id: 's9-uid' }] }
      return { data: null }
    })

    const scope = await resolveVisibleScope(client, 'gov2-uid')
    expect(scope.classIds).toEqual(['C9'])
    expect(scope.learnerIds).toEqual(['L-s9'])
  })

  it('returns an empty scope when the caller has no learner row', async () => {
    const client = makeClient(() => ({ data: null }))
    const scope = await resolveVisibleScope(client, 'nobody')
    expect(scope).toEqual({ learnerId: null, role: null, classIds: [], learnerIds: [], studentsByClass: {} })
  })

  it('a plain student gets no scope (not teacher/school/gov facing)', async () => {
    const client = makeClient((table, f) => {
      if (table === 'learners' && f.eqs.user_id === 'stu-uid')
        return { data: { id: 'L-stu', educational_role: 'student' } }
      return { data: null }
    })
    const scope = await resolveVisibleScope(client, 'stu-uid')
    expect(scope.learnerId).toBe('L-stu')
    expect(scope.role).toBe('student')
    expect(scope.learnerIds).toEqual([])
    expect(scope.classIds).toEqual([])
  })

  it('a teacher with no classes sees nobody', async () => {
    const client = makeClient((table, f) => {
      if (table === 'learners' && f.eqs.user_id === 't2-uid')
        return { data: { id: 'L-t2', educational_role: 'teacher' } }
      if (table === 'class_teachers') return { data: [] }
      if (table === 'classes') return { data: [] }
      return { data: null }
    })
    const scope = await resolveVisibleScope(client, 't2-uid')
    expect(scope.classIds).toEqual([])
    expect(scope.learnerIds).toEqual([])
  })
})
