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

/**
 * Make every read of `table` answer the way PostgREST does when the database
 * refuses it: `{ data: null, error }`, no throw. The route under test must turn
 * that into a loud failure rather than an empty result (RLS doctrine rule 8).
 */
export const FAILING_TABLES = new Map<string, { message: string; code?: string }>()

let seq = 0
export function makeChainable(db: DB, table: string) {
  let rows: Row[] = [...(db[table] ?? [])]
  let single: 'maybe' | 'single' | null = null
  let pending: { kind: 'insert' | 'update' | 'delete' | 'noop'; values: Row | Row[] } | null = null
  const filters: Array<(r: Row) => boolean> = []
  let rangeOf: [number, number] | null = null
  const builder: any = {
    select: () => builder,
    insert: (values: Row) => { pending = { kind: 'insert', values }; return builder },
    update: (values: Row) => { pending = { kind: 'update', values }; return builder },
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
    is: (col: string, val: unknown) => { filters.push((r) => r[col] == val); return builder },
    /** jsonb @> : the row's column carries every key the pattern names, recursively. */
    contains: (col: string, pattern: Record<string, unknown>) => {
      const subset = (have: any, want: any): boolean => {
        if (want === null || typeof want !== 'object') return have === want
        if (have === null || typeof have !== 'object') return false
        return Object.entries(want).every(([k, v]) => subset(have[k], v))
      }
      filters.push((r) => subset(r[col], pattern))
      return builder
    },
    upsert: (values: Row | Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
      const list = Array.isArray(values) ? values : [values]
      const fresh = list.filter((v) => !(db[table] ?? []).some((r) => r[opts.onConflict] != null && r[opts.onConflict] === v[opts.onConflict]))
      pending = fresh.length === 0 ? { kind: 'noop', values: {} } : { kind: 'insert', values: Array.isArray(values) ? fresh : fresh[0] }
      return builder
    },
    /**
     * PostgREST `or=(a,b)`: the comma-separated clauses, ANY of which may
     * match. Only the forms this repo actually writes are understood —
     * `col.not.is.null` and `col.is.null` — so an unsupported clause is loud
     * rather than quietly true.
     */
    or: (clauses: string) => {
      const tests = clauses.split(',').map((c) => {
        const notNull = c.match(/^(\w+)\.not\.is\.null$/)
        if (notNull) return (r: Row) => r[notNull[1]] != null
        const isNull = c.match(/^(\w+)\.is\.null$/)
        if (isNull) return (r: Row) => r[isNull[1]] == null
        throw new Error(`_testkit: unsupported or() clause "${c}"`)
      })
      filters.push((r) => tests.some((t) => t(r)))
      return builder
    },
    /** PostgREST paging: rows [from, to] of the filtered set. */
    range: (from: number, to: number) => { rangeOf = [from, to]; return builder },
    delete: () => { pending = { kind: 'delete', values: {} }; return builder },
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
      const failure = FAILING_TABLES.get(table)
      if (failure) return Promise.resolve({ data: null, error: failure, count: null }).then(resolve, reject)
      let out: Row[]
      if (pending?.kind === 'insert') {
        const list = Array.isArray(pending.values) ? pending.values : [pending.values]
        out = list.map((v) => {
          const row = { id: `row-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...v }
          ;(db[table] ||= []).push(row)
          return row
        })
      } else if (pending?.kind === 'update') {
        out = []
        for (const r of db[table] ?? []) if (filters.every((f) => f(r))) { Object.assign(r, pending.values as Row); out.push(r) }
      } else if (pending?.kind === 'delete') {
        out = (db[table] ?? []).filter((r) => filters.every((f) => f(r)))
        db[table] = (db[table] ?? []).filter((r) => !out.includes(r))
      } else if (pending?.kind === 'noop') {
        out = []
      } else {
        out = rows.filter((r) => filters.every((f) => f(r)))
        if (rangeOf) out = out.slice(rangeOf[0], rangeOf[1] + 1)
      }
      const data = single ? (out[0] ?? null) : out
      const error = single === 'single' && !out[0] ? { message: 'no row' } : null
      return Promise.resolve({ data, error, count: out.length }).then(resolve, reject)
    },
  }
  return builder
}

export function makeReq(init: { method?: string; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}): VercelRequest {
  return {
    method: init.method ?? 'GET',
    query: init.query ?? {},
    body: init.body,
    headers: { authorization: 'Bearer tok', ...(init.headers ?? {}) },
  } as any
}

/** A request made by an ssi_admin who is touring under View As. */
export const VIEW_AS_HEADERS = { 'x-ssi-view-as': '1' }

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
