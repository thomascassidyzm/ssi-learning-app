/**
 * Tests for refreshDemoNodeActivity — the "Refresh demo activity" verb on a
 * DEMO Structure-tree node. The hard-safety contract is the point: it must be
 * impossible for this engine to touch non-demo data, whatever the caller
 * claims — guarded at the node, at every subtree school, and at every
 * learner, refusing (not skipping) on the first two and filtering on the
 * third.
 */
import { describe, it, expect } from 'vitest'
import { refreshDemoNodeActivity } from './demoNodeRefresh'

interface DB {
  groups: any[]
  schools: any[]
  classes: any[]
  user_tags: any[]
  learners: any[]
  course_enrollments: any[]
  course_seeds: any[]
}

interface WriteLog {
  deletes: { table: string; col: string; vals: unknown[] }[]
  inserts: { table: string; rows: any[] }[]
  updates: { table: string; patch: any; filters: [string, unknown][] }[]
}

function makeSupabase(db: DB, log: WriteLog) {
  return {
    from(table: string) {
      const allRows: any[] = [...((db as any)[table] ?? [])]
      let rows = allRows
      let isCount = false
      const builder: any = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) isCount = true
          return builder
        },
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        insert: (newRows: any) => {
          const arr = Array.isArray(newRows) ? newRows : [newRows]
          log.inserts.push({ table, rows: arr })
          return { error: null, select: () => ({ single: () => Promise.resolve({ data: arr[0], error: null }) }), then: (r: any) => Promise.resolve({ error: null }).then(r) }
        },
        update: (patch: any) => {
          const filters: [string, unknown][] = []
          const upd: any = {
            eq: (col: string, val: unknown) => { filters.push([col, val]); return upd },
            then: (resolve: any) => { log.updates.push({ table, patch, filters }); return Promise.resolve({ error: null }).then(resolve) },
          }
          return upd
        },
        delete: () => ({
          in: (col: string, vals: unknown[]) => { log.deletes.push({ table, col, vals }); return Promise.resolve({ error: null }) },
        }),
        then: (resolve: any) =>
          Promise.resolve(isCount ? { count: rows.length, error: null } : { data: rows, error: null }).then(resolve),
      }
      return builder
    },
  } as any
}

function makeDb(overrides: Partial<DB> = {}): DB {
  return {
    groups: [
      { id: 'g-demo', name: 'IME Demo Programme', is_demo: true, path: 'g-demo' },
      { id: 'g-child', name: 'Child', is_demo: true, path: 'g-demo/g-child' },
      { id: 'g-real', name: 'Real Org', is_demo: false, path: 'g-real' },
    ],
    schools: [{ id: 'sch-1', school_name: 'Sunrise', group_id: 'g-demo', is_demo: true }],
    classes: [{ id: 'cls-1', school_id: 'sch-1', course_code: 'eng_for_hin', teacher_user_id: 't-1', current_seed: 25 }],
    user_tags: [
      { user_id: 'u-demo', tag_value: 'CLASS:cls-1', role_in_context: 'student' },
      { user_id: 'u-real', tag_value: 'CLASS:cls-1', role_in_context: 'student' },
    ],
    learners: [
      { id: 'l-demo', user_id: 'u-demo', is_demo: true },
      // A NON-demo learner somehow tagged into a demo class — must never be touched.
      { id: 'l-real', user_id: 'u-real', is_demo: false },
    ],
    course_enrollments: [{ learner_id: 'l-demo', course_id: 'eng_for_hin', enrolled_at: '2026-05-01T00:00:00Z', highest_completed_seed: 20 }],
    course_seeds: Array.from({ length: 100 }, (_, i) => ({ course_code: 'eng_for_hin', seed_number: i + 1 })),
    ...overrides,
  }
}

function emptyLog(): WriteLog {
  return { deletes: [], inserts: [], updates: [] }
}

describe('refreshDemoNodeActivity — hard safety', () => {
  it('refuses a non-demo node outright, before any write', async () => {
    const log = emptyLog()
    await expect(refreshDemoNodeActivity(makeSupabase(makeDb(), log), 'g-real', 'admin-1'))
      .rejects.toThrow(/not a demo node/)
    expect(log.deletes).toHaveLength(0)
    expect(log.inserts).toHaveLength(0)
  })

  it('refuses when the subtree contains a non-demo school, before any write', async () => {
    const log = emptyLog()
    const db = makeDb({
      schools: [
        { id: 'sch-1', school_name: 'Sunrise', group_id: 'g-demo', is_demo: true },
        { id: 'sch-2', school_name: 'Real School', group_id: 'g-child', is_demo: false },
      ],
    })
    await expect(refreshDemoNodeActivity(makeSupabase(db, log), 'g-demo', 'admin-1'))
      .rejects.toThrow(/non-demo school/)
    expect(log.deletes).toHaveLength(0)
    expect(log.inserts).toHaveLength(0)
  })

  it('only is_demo learners ever enter the delete/insert set', async () => {
    const log = emptyLog()
    const result = await refreshDemoNodeActivity(makeSupabase(makeDb(), log), 'g-demo', 'admin-1')
    expect(result.learnersTouched).toBe(1)

    const learnerDeletes = log.deletes.filter((d) => d.col === 'learner_id')
    expect(learnerDeletes.length).toBeGreaterThan(0)
    for (const d of learnerDeletes) {
      expect(d.vals).toEqual(['l-demo'])
    }
    for (const ins of log.inserts.filter((i) => ['sessions', 'seed_progress', 'lego_progress'].includes(i.table))) {
      for (const row of ins.rows) expect(row.learner_id).toBe('l-demo')
    }
    for (const u of log.updates.filter((u) => u.table === 'course_enrollments')) {
      expect(u.filters).toContainEqual(['learner_id', 'l-demo'])
      expect(u.filters).toContainEqual(['course_id', 'eng_for_hin'])
    }
  })
})

describe('refreshDemoNodeActivity — replace + recency shape', () => {
  it('deletes existing telemetry before regenerating (replace, not stack)', async () => {
    const log = emptyLog()
    await refreshDemoNodeActivity(makeSupabase(makeDb(), log), 'g-demo', 'admin-1')
    const deletedTables = log.deletes.map((d) => d.table)
    expect(deletedTables).toEqual(expect.arrayContaining(['sessions', 'seed_progress', 'lego_progress', 'class_sessions']))
    const insertedTables = log.inserts.map((i) => i.table)
    expect(insertedTables).toEqual(expect.arrayContaining(['sessions', 'seed_progress', 'lego_progress', 'class_sessions']))
  })

  it('writes sessions inside the ~8-week window, none in the future, and advances the position coherently', async () => {
    const log = emptyLog()
    const result = await refreshDemoNodeActivity(makeSupabase(makeDb(), log), 'g-demo', 'admin-1')
    const now = Date.now()
    const sessions = log.inserts.filter((i) => i.table === 'sessions').flatMap((i) => i.rows)
    expect(sessions.length).toBe(result.sessionsWritten)
    expect(sessions.length).toBeGreaterThan(0)
    for (const s of sessions) {
      const t = new Date(s.started_at as string).getTime()
      expect(t).toBeLessThanOrEqual(now + 1000)
      expect(t).toBeGreaterThanOrEqual(now - 57 * 86400000)
    }
    // Enrollment cursor coherent with regenerated seed rows: highest seed in
    // seed_progress equals the enrollment's highest_completed_seed, >= where
    // the learner already was (anchored continuation, never teleported back).
    const patch = log.updates.find((u) => u.table === 'course_enrollments')!.patch
    expect(patch.highest_completed_seed).toBeGreaterThanOrEqual(20)
    const seedRows = log.inserts.filter((i) => i.table === 'seed_progress').flatMap((i) => i.rows)
    const maxSeedRow = Math.max(...seedRows.map((r: any) => parseInt((r.seed_id as string).slice(1), 10)))
    expect(maxSeedRow).toBe(patch.highest_completed_seed)
  })
})
