/**
 * Tests for schoolNodeName — a school's name lives in two rows and the
 * dashboard heading reads the OTHER one. These pin both directions of the
 * sync, and pin that neither direction can ever throw at its caller: the
 * primary rename has already succeeded by the time they run.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { syncNodeNameForSchool, syncSchoolNameForNode } from './schoolNodeName'

interface Row { [k: string]: any }

let DB: { schools: Row[]; groups: Row[] }
let failOn: { table?: string; op?: 'select' | 'update' } = {}
let threw = false

/**
 * Minimal PostgREST-shaped fake: select/eq/maybeSingle for reads, and an
 * update()...eq() chain that is itself awaitable (which is how the helper
 * writes). Deliberately supports the failure the helper has to swallow.
 */
function makeClient(): any {
  return {
    from(table: string) {
      let rows: Row[] = (DB as any)[table] ?? []
      let patch: Row | null = null
      const builder: any = {
        select() {
          if (failOn.table === table && failOn.op === 'select') {
            builder._readErr = { message: 'boom (read)' }
          }
          return builder
        },
        eq(col: string, val: unknown) {
          rows = rows.filter((r) => (r[col] ?? null) === val)
          if (patch) {
            if (failOn.table === table && failOn.op === 'update') {
              builder._writeErr = { message: 'boom (write)' }
            } else {
              rows.forEach((r) => Object.assign(r, patch))
            }
          }
          return builder
        },
        update(p: Row) { patch = p; return builder },
        async maybeSingle() {
          if (builder._readErr) return { data: null, error: builder._readErr }
          return { data: rows[0] ?? null, error: null }
        },
        // the update chain is awaited directly
        then(resolve: (v: any) => void) {
          resolve({ data: null, error: builder._writeErr ?? null })
        },
      }
      return builder
    },
  }
}

beforeEach(() => {
  failOn = {}
  threw = false
  DB = {
    schools: [
      { id: 'school-1', school_name: 'Old Name', node_group_id: 'node-1', name_confirmed: false },
      { id: 'school-2', school_name: 'Nodeless School', node_group_id: null },
    ],
    groups: [
      { id: 'node-1', name: 'Old Name', name_confirmed: false },
      { id: 'plain-group', name: 'Just A Group' },
    ],
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('syncNodeNameForSchool (school → node)', () => {
  it('carries the school rename onto the node the heading reads', async () => {
    const nodeId = await syncNodeNameForSchool(makeClient(), 'school-1', 'Chepstow School')
    expect(nodeId).toBe('node-1')
    expect(DB.groups[0].name).toBe('Chepstow School')
  })

  it('confirms the node name too — typing your school\'s name IS confirming it', async () => {
    await syncNodeNameForSchool(makeClient(), 'school-1', 'Chepstow School')
    expect(DB.groups[0].name_confirmed).toBe(true)
  })

  it('trims, and does nothing at all for a blank name', async () => {
    await syncNodeNameForSchool(makeClient(), 'school-1', '  Padded School  ')
    expect(DB.groups[0].name).toBe('Padded School')
    await syncNodeNameForSchool(makeClient(), 'school-1', '   ')
    expect(DB.groups[0].name).toBe('Padded School')
  })

  it('is a no-op for a school with no node yet — the healthy case, not a failure', async () => {
    const nodeId = await syncNodeNameForSchool(makeClient(), 'school-2', 'Anything')
    expect(nodeId).toBeNull()
    expect(DB.groups.map((g) => g.name)).toEqual(['Old Name', 'Just A Group'])
  })

  it('swallows a read failure — the rename it follows has already succeeded', async () => {
    failOn = { table: 'schools', op: 'select' }
    const nodeId = await syncNodeNameForSchool(makeClient(), 'school-1', 'New').catch(() => { threw = true; return 'x' })
    expect(threw).toBe(false)
    expect(nodeId).toBeNull()
  })

  it('swallows a write failure', async () => {
    failOn = { table: 'groups', op: 'update' }
    const nodeId = await syncNodeNameForSchool(makeClient(), 'school-1', 'New').catch(() => { threw = true; return 'x' })
    expect(threw).toBe(false)
    expect(nodeId).toBeNull()
    expect(DB.groups[0].name).toBe('Old Name')
  })
})

describe('syncSchoolNameForNode (node → school)', () => {
  it('carries a node rename back onto the school record', async () => {
    const schoolId = await syncSchoolNameForNode(makeClient(), 'node-1', 'Chepstow School')
    expect(schoolId).toBe('school-1')
    expect(DB.schools[0].school_name).toBe('Chepstow School')
    expect(DB.schools[0].name_confirmed).toBe(true)
  })

  it('is a no-op for a group that is nobody\'s school node', async () => {
    const schoolId = await syncSchoolNameForNode(makeClient(), 'plain-group', 'Renamed')
    expect(schoolId).toBeNull()
    expect(DB.schools.map((s) => s.school_name)).toEqual(['Old Name', 'Nodeless School'])
  })

  it('swallows a write failure', async () => {
    failOn = { table: 'schools', op: 'update' }
    const schoolId = await syncSchoolNameForNode(makeClient(), 'node-1', 'New').catch(() => { threw = true; return 'x' })
    expect(threw).toBe(false)
    expect(schoolId).toBeNull()
    expect(DB.schools[0].school_name).toBe('Old Name')
  })
})
