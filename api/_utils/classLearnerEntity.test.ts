/**
 * Tests for ensureClassLearnerEntity (owner ruling 2026-07-16: class as
 * first-class learner). Covers minting a new entity, idempotent re-use of
 * an existing one, and the enrollment upsert staying in sync with the
 * class's current course_code.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ensureClassLearnerEntity } from './classLearnerEntity'

let DB: {
  classes: Array<{ id: string; class_name: string; course_code: string; class_learner_id: string | null }>
  learners: Array<{ id: string; user_id: string; display_name: string; is_class_entity: boolean }>
  course_enrollments: Array<{ learner_id: string; course_id: string }>
}
let nextLearnerId = 0

function makeSupabase() {
  return {
    from(table: string) {
      const builder: any = {
        _filters: [] as Array<[string, unknown]>,
        _insertRow: null as any,
        select() { return builder },
        eq(col: string, val: unknown) { builder._filters.push([col, val]); return builder },
        insert(row: any) {
          builder._insertRow = row
          return builder
        },
        update(patch: any) {
          builder._updatePatch = patch
          return builder
        },
        upsert(row: any, _opts: any) {
          builder._upsertRow = row
          return builder
        },
        async single() {
          if (builder._insertRow) {
            const row = { id: `learner-${++nextLearnerId}`, ...builder._insertRow }
            ;(DB as any)[table].push(row)
            return { data: row, error: null }
          }
          const rows = filterRows()
          return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found', code: 'PGRST116' } }
        },
        async maybeSingle() {
          const rows = filterRows()
          return { data: rows[0] ?? null, error: null }
        },
        then(resolve: any) {
          // .update(...).eq(...) awaited directly (no .single())
          if (builder._updatePatch) {
            const rows = filterRows()
            rows.forEach((r: any) => Object.assign(r, builder._updatePatch))
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
          if (builder._upsertRow) {
            const existing = (DB as any)[table].find(
              (r: any) => r.learner_id === builder._upsertRow.learner_id && r.course_id === builder._upsertRow.course_id,
            )
            if (!existing) (DB as any)[table].push({ ...builder._upsertRow })
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
          return Promise.resolve({ data: filterRows(), error: null }).then(resolve)
        },
      }
      function filterRows() {
        let rows = [...((DB as any)[table] ?? [])]
        for (const [col, val] of builder._filters) rows = rows.filter((r: any) => r[col] === val)
        return rows
      }
      return builder
    },
  }
}

beforeEach(() => {
  nextLearnerId = 0
  DB = {
    classes: [{ id: 'class-1', class_name: 'Welsh Y7', course_code: 'cym_for_eng', class_learner_id: null }],
    learners: [],
    course_enrollments: [],
  }
})

describe('ensureClassLearnerEntity', () => {
  it('mints a new learners row and enrolls it in the class course', async () => {
    const svc = makeSupabase() as any
    const result = await ensureClassLearnerEntity(svc, 'class-1')
    expect('error' in result).toBe(false)
    if ('learnerId' in result) {
      expect(DB.learners).toHaveLength(1)
      expect(DB.learners[0].id).toBe(result.learnerId)
      expect(DB.learners[0].is_class_entity).toBe(true)
      expect(DB.learners[0].user_id).toBe('class-learner:class-1')
      expect(DB.classes[0].class_learner_id).toBe(result.learnerId)
      expect(DB.course_enrollments).toEqual([{ learner_id: result.learnerId, course_id: 'cym_for_eng' }])
    }
  })

  it('is idempotent — a class that already has a learner reuses it and does not duplicate the enrollment', async () => {
    DB.classes[0].class_learner_id = 'existing-learner'
    DB.course_enrollments.push({ learner_id: 'existing-learner', course_id: 'cym_for_eng' })
    const svc = makeSupabase() as any
    const result = await ensureClassLearnerEntity(svc, 'class-1')
    expect(result).toEqual({ learnerId: 'existing-learner' })
    expect(DB.learners).toHaveLength(0) // no new learner minted
    expect(DB.course_enrollments).toHaveLength(1) // no duplicate enrollment
  })

  it('returns an error when the class does not exist', async () => {
    const svc = makeSupabase() as any
    const result = await ensureClassLearnerEntity(svc, 'does-not-exist')
    expect(result).toEqual({ error: 'Class not found' })
  })
})
