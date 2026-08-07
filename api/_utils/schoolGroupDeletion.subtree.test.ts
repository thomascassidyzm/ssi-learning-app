/**
 * deleteGroupCascade subtree semantics (THE MODEL, 2026-07-18): deleting a
 * node deletes its whole subtree, deepest-first; a school whose OWN node is
 * in the subtree dies with it (full school cascade); legacy-attached schools
 * (group_id only, node elsewhere/none) are ungrouped, not deleted.
 *
 * Membership walks parent_id, NOT the slug path (2026-08-06): nothing makes a
 * slug unique, so a path walk on one of two same-named orgs would delete the
 * OTHER tenant's children.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deleteGroupCascade } from './schoolGroupDeletion'

interface GroupRow { id: string; path: string | null; parent_id: string | null }
let groups: GroupRow[]
let nodeSchoolsByGroup: Record<string, { id: string }[]>
let deletedGroups: string[]
let deletedSchools: string[]
let ungroupedFor: string[]

function makeSupabase() {
  return {
    from: (table: string) => {
      const b: any = { _table: table, _filters: {} as Record<string, unknown> }
      // A bare `groups` select (no filter) is the forest fetch the parent_id
      // subtree walk makes — resolve it straight away.
      b.select = vi.fn((cols: string) => (
        table === 'groups' && typeof cols === 'string' && cols.includes('parent_id')
          ? Promise.resolve({ data: groups, error: null })
          : b
      ))
      b.update = vi.fn((row: any) => { b._update = row; return b })
      b.delete = vi.fn(() => { b._delete = true; return b })
      b.insert = vi.fn(() => b)
      b.not = vi.fn(() => b)
      b.like = vi.fn((_col: string, pattern: string) => {
        b._like = pattern
        return Promise.resolve({
          data: groups.filter(g => g.path && g.path.startsWith(pattern.replace(/%$/, ''))),
          error: null,
        })
      })
      b.maybeSingle = vi.fn(async () => ({
        data: groups.find(g => g.id === b._filters.id) ?? null,
        error: null,
      }))
      b.eq = vi.fn((col: string, val: unknown) => {
        b._filters[col] = val
        // terminal thenable — resolves per table/operation
        b.then = (resolve: any) => {
          if (b._table === 'groups' && b._delete) {
            deletedGroups.push(String(b._filters.id))
            return resolve({ data: null, error: null })
          }
          if (b._table === 'schools' && b._delete) {
            deletedSchools.push(String(b._filters.id))
            return resolve({ data: null, error: null })
          }
          if (b._table === 'schools' && b._update && 'group_id' in b._update) {
            ungroupedFor.push(String(b._filters.group_id))
            return resolve({ data: null, error: null })
          }
          if (b._table === 'schools' && b._filters.node_group_id !== undefined && !b._delete && !b._update) {
            return resolve({ data: nodeSchoolsByGroup[String(b._filters.node_group_id)] ?? [], error: null })
          }
          return resolve({ data: [], error: null })
        }
        return b
      })
      return b
    },
  } as any
}

beforeEach(() => {
  groups = []
  nodeSchoolsByGroup = {}
  deletedGroups = []
  deletedSchools = []
  ungroupedFor = []
})

describe('deleteGroupCascade — subtree', () => {
  it('flat group with no children keeps the old shape: ungroup schools, delete group', async () => {
    groups = [{ id: 'g1', path: 'g-one', parent_id: null }]
    await deleteGroupCascade(makeSupabase(), 'g1')
    expect(deletedGroups).toEqual(['g1'])
    expect(deletedSchools).toEqual([])
    expect(ungroupedFor).toEqual(['g1'])
  })

  it('nested subtree deletes deepest-first and takes school-nodes with it', async () => {
    groups = [
      { id: 'root', path: 'r', parent_id: null },
      { id: 'mid', path: 'r/mid', parent_id: 'root' },
      { id: 'leaf', path: 'r/mid/leaf', parent_id: 'mid' },
    ]
    nodeSchoolsByGroup = { leaf: [{ id: 'school-leaf' }] }
    await deleteGroupCascade(makeSupabase(), 'root')
    expect(deletedGroups).toEqual(['leaf', 'mid', 'root'])
    expect(deletedSchools).toEqual(['school-leaf'])
  })

  it('a duplicate slug does not drag the other tenant\'s children in', async () => {
    // Both orgs are named "Deborah Testing" so both slug to 'deborah-testing'
    // (live, 2026-08-06). A `path LIKE 'deborah-testing/%'` walk would take the
    // SURVIVING org's child with the doomed twin. parent_id cannot confuse them.
    groups = [
      { id: 'doomed', path: 'deborah-testing', parent_id: null },
      { id: 'survivor', path: 'deborah-testing', parent_id: null },
      { id: 'survivor-child', path: 'deborah-testing/class-one', parent_id: 'survivor' },
    ]
    await deleteGroupCascade(makeSupabase(), 'doomed')
    expect(deletedGroups).toEqual(['doomed'])
    expect(deletedGroups).not.toContain('survivor')
    expect(deletedGroups).not.toContain('survivor-child')
  })

  it('missing root is a no-op', async () => {
    groups = []
    await deleteGroupCascade(makeSupabase(), 'ghost')
    expect(deletedGroups).toEqual([])
  })

  it('sibling slug prefixes are not swallowed (ang vs angharad)', async () => {
    groups = [
      { id: 'ang', path: 'ang', parent_id: null },
      { id: 'angharad', path: 'angharad', parent_id: null },
      { id: 'ang-child', path: 'ang/child', parent_id: 'ang' },
    ]
    await deleteGroupCascade(makeSupabase(), 'ang')
    expect(deletedGroups).toEqual(['ang-child', 'ang'])
    expect(deletedGroups).not.toContain('angharad')
  })
})
