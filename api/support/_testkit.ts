/**
 * Shared doubles for the api/support/*.test.ts files: an in-memory PostgREST
 * builder over a plain-object DB, request/response fakes, and the mocked
 * auth + scope. resolveVisibleScope is mocked — authorization by scope is
 * that function's own responsibility (schoolScope.*.test.ts); what THESE
 * tests prove is that the routes derive everything from it and nothing from
 * the request.
 */
import { vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export type Row = Record<string, any>
export type DB = Record<string, Row[]>

let seq = 0
export function makeChainable(db: DB, table: string) {
  let rows: Row[] = [...(db[table] ?? [])]
  let single: 'maybe' | 'single' | null = null
  let pending: { kind: 'insert' | 'update'; values: Row } | null = null
  const filters: Array<(r: Row) => boolean> = []
  const builder: any = {
    select: () => builder,
    insert: (values: Row) => { pending = { kind: 'insert', values }; return builder },
    update: (values: Row) => { pending = { kind: 'update', values }; return builder },
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
    is: (col: string, val: unknown) => { filters.push((r) => r[col] == val); return builder },
    gte: (col: string, val: string) => { filters.push((r) => String(r[col]) >= val); return builder },
    order: (col: string, opts?: { ascending?: boolean }) => {
      const asc = opts?.ascending !== false
      filters.push(() => true)
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
      return builder
    },
    limit: () => builder,
    maybeSingle: () => { single = 'maybe'; return builder },
    single: () => { single = 'single'; return builder },
    then: (resolve: any, reject?: any) => {
      let out: Row[]
      if (pending?.kind === 'insert') {
        const row = { id: `row-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...pending.values }
        ;(db[table] ||= []).push(row)
        out = [row]
      } else if (pending?.kind === 'update') {
        out = []
        for (const r of db[table] ?? []) if (filters.every((f) => f(r))) { Object.assign(r, pending.values); out.push(r) }
      } else {
        out = rows.filter((r) => filters.every((f) => f(r)))
      }
      const data = single ? (out[0] ?? null) : out
      const error = single === 'single' && !out[0] ? { message: 'no row' } : null
      return Promise.resolve({ data, error, count: out.length }).then(resolve, reject)
    },
  }
  return builder
}

export function makeReq(init: { method?: string; query?: Record<string, string>; body?: unknown } = {}): VercelRequest {
  return {
    method: init.method ?? 'GET',
    query: init.query ?? {},
    body: init.body,
    headers: { authorization: 'Bearer tok' },
  } as any
}

export function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.end = vi.fn()
  return res
}

export const TEACHER_SCOPE = { learnerId: 'l-t', role: 'teacher', classIds: ['c1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
export const ADMIN_SCOPE = { learnerId: 'l-a', role: 'school_admin', classIds: ['c1'], learnerIds: [], studentsByClass: {}, schoolIds: ['s1'], groupId: null }
export const LEADER_SCOPE = { learnerId: 'l-g', role: 'govt_admin', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: ['s1', 's2'], groupId: 'g1' }
