/**
 * Tests for schoolScope.ts's arbitrary-depth subtree scoping —
 * schoolsForGroupSubtree and isStrictDescendantGroup both rely on
 * path-prefix matching (materialized-path groups tree: org -> region ->
 * district -> school, arbitrary nesting via groups.parent_id/path).
 *
 * Fixture tree (4 levels deep):
 *   org-1        path "1"
 *     region-1a  path "1.1"
 *       district-1a1  path "1.1.1"
 *         (school-ggc attached here — a great-grandchild group)
 *     region-1b  path "1.2"        <- sideways branch, same parent as region-1a
 *   org-2        path "2"          <- unrelated root
 */
import { describe, it, expect } from 'vitest'
import { schoolsForGroupSubtree, isStrictDescendantGroup } from './schoolScope'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

const GROUP_PATHS: Record<string, string> = {
  'org-1': '1',
  'region-1a': '1.1',
  'district-1a1': '1.1.1',
  'region-1b': '1.2',
  'org-2': '2',
}

// group_id -> path prefix a school is attached under (schools.group_id points
// directly at ONE group; "attached to a great-grandchild" means group_id ===
// 'district-1a1').
const SCHOOLS: Array<{ id: string; group_id: string }> = [
  { id: 'school-ggc', group_id: 'district-1a1' }, // great-grandchild of org-1
  { id: 'school-1b', group_id: 'region-1b' }, // sideways branch under org-1
  { id: 'school-org2', group_id: 'org-2' }, // unrelated root
]

function makeSvc() {
  return {
    from(table: string) {
      if (table === 'groups') {
        const builder: any = {
          _mode: null as 'get' | 'like' | null,
          _id: undefined as string | undefined,
          _prefix: undefined as string | undefined,
          select: () => builder,
          eq: (_col: string, val: string) => { builder._mode = 'get'; builder._id = val; return builder },
          like: (_col: string, pattern: string) => { builder._mode = 'like'; builder._prefix = pattern.replace(/%$/, ''); return builder },
          maybeSingle: () => {
            const path = GROUP_PATHS[builder._id as string]
            return Promise.resolve({ data: path ? { path } : null, error: null })
          },
          then: (resolve: any) => {
            const prefix = builder._prefix as string
            const matches = Object.entries(GROUP_PATHS)
              .filter(([, p]) => p.startsWith(prefix))
              .map(([id]) => ({ id }))
            return resolve({ data: matches, error: null })
          },
        }
        return builder
      }
      if (table === 'schools') {
        const builder: any = {
          _groupIds: [] as string[],
          select: () => builder,
          in: (_col: string, ids: string[]) => { builder._groupIds = ids; return builder },
          then: (resolve: any) => {
            const matches = SCHOOLS.filter((s) => builder._groupIds.includes(s.group_id))
            return resolve({ data: matches, error: null })
          },
        }
        return builder
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as any
}

describe('schoolsForGroupSubtree — arbitrary-depth path-prefix matching', () => {
  it('includes a school attached to a great-grandchild group in the root org subtree', async () => {
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'org-1')
    expect(schoolIds).toContain('school-ggc')
  })

  it('excludes a sideways group (same parent, different branch)', async () => {
    // school-1b hangs off region-1b, a sibling of region-1a — querying the
    // region-1a subtree specifically must not pick it up.
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'region-1a')
    expect(schoolIds).not.toContain('school-1b')
    expect(schoolIds).toContain('school-ggc')
  })

  it('root org subtree includes every descendant school but excludes the unrelated org-2 branch', async () => {
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'org-1')
    expect(schoolIds.sort()).toEqual(['school-1b', 'school-ggc'].sort())
    expect(schoolIds).not.toContain('school-org2')
  })

  it('a leaf group with no schools returns an empty list', async () => {
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'district-1a1')
    expect(schoolIds).toEqual(['school-ggc'])
  })

  it('an unknown group id (no path) returns an empty list', async () => {
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'no-such-group')
    expect(schoolIds).toEqual([])
  })
})

describe('isStrictDescendantGroup — arbitrary-depth path-prefix matching', () => {
  it('identifies a great-grandchild as a strict descendant of the root', async () => {
    const result = await isStrictDescendantGroup(makeSvc(), 'org-1', 'district-1a1')
    expect(result).toBe(true)
  })

  it('identifies a direct child as a strict descendant', async () => {
    const result = await isStrictDescendantGroup(makeSvc(), 'org-1', 'region-1a')
    expect(result).toBe(true)
  })

  it('rejects the root as a descendant of itself', async () => {
    const result = await isStrictDescendantGroup(makeSvc(), 'org-1', 'org-1')
    expect(result).toBe(false)
  })

  it('rejects an unrelated branch (different root org)', async () => {
    const result = await isStrictDescendantGroup(makeSvc(), 'org-1', 'org-2')
    expect(result).toBe(false)
  })

  it('rejects a sideways group (sibling, not descendant)', async () => {
    const result = await isStrictDescendantGroup(makeSvc(), 'region-1a', 'region-1b')
    expect(result).toBe(false)
  })

  it('rejects an ancestor being called a descendant of its own child (direction matters)', async () => {
    const result = await isStrictDescendantGroup(makeSvc(), 'district-1a1', 'org-1')
    expect(result).toBe(false)
  })
})
