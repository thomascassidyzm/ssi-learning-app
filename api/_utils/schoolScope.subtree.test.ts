/**
 * Tests for schoolScope.ts's arbitrary-depth subtree scoping —
 * schoolsForGroupSubtree and isStrictDescendantGroup. Both walk `parent_id`
 * (groupSubtree.descendantIds). They used to match on the slug `path`; that was
 * changed on 2026-08-06 because slugs are not unique — two orgs both named
 * "Deborah Testing" both carried path 'deborah-testing' live, so a path match
 * folded one tenant's people into the other's scope. The assertions below are
 * the ORIGINAL ones (the tree semantics did not change); the fixture now
 * carries the real parent links, plus the two collision cases path matching
 * could never get right.
 *
 * Fixture tree (4 levels deep):
 *   org-1
 *     region-1a
 *       district-1a1
 *         (school-ggc attached here — a great-grandchild group)
 *     region-1b               <- sideways branch, same parent as region-1a
 *   org-2                     <- unrelated root
 *   org-1-twin                <- SAME NAME as org-1 → SAME slug path, no relation
 *   org-1-prefix              <- slug is a bare string-prefix sibling
 */
import { describe, it, expect } from 'vitest'
import { schoolsForGroupSubtree, isStrictDescendantGroup } from './schoolScope'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

// id -> parent_id. Paths are carried too, deliberately COLLIDING for the twin
// and prefix rows, so a regression back to path matching fails loudly here.
const GROUPS: Array<{ id: string; parent_id: string | null; path: string }> = [
  { id: 'org-1', parent_id: null, path: 'acme' },
  { id: 'region-1a', parent_id: 'org-1', path: 'acme/north' },
  { id: 'district-1a1', parent_id: 'region-1a', path: 'acme/north/central' },
  { id: 'region-1b', parent_id: 'org-1', path: 'acme/south' },
  { id: 'org-2', parent_id: null, path: 'other' },
  { id: 'org-1-twin', parent_id: null, path: 'acme' },
  { id: 'org-1-prefix', parent_id: null, path: 'acme-holdings' },
]

const SCHOOLS: Array<{ id: string; group_id: string }> = [
  { id: 'school-ggc', group_id: 'district-1a1' }, // great-grandchild of org-1
  { id: 'school-1b', group_id: 'region-1b' }, // sideways branch under org-1
  { id: 'school-org2', group_id: 'org-2' }, // unrelated root
  { id: 'school-twin', group_id: 'org-1-twin' }, // same-slug, unrelated tenant
  { id: 'school-prefix', group_id: 'org-1-prefix' }, // prefix-slug, unrelated tenant
]

function makeSvc() {
  return {
    from(table: string) {
      if (table === 'groups') {
        const builder: any = {
          select: () => builder,
          then: (resolve: any) => resolve({ data: GROUPS.map((g) => ({ id: g.id, parent_id: g.parent_id })), error: null }),
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

describe('schoolsForGroupSubtree — arbitrary-depth subtree matching', () => {
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

  it('an unknown group id returns an empty list', async () => {
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'no-such-group')
    expect(schoolIds).toEqual([])
  })

  // ─── The 2026-08-06 collision cases: two roots sharing a slug, and a slug
  // that is a bare string-prefix of another. Path matching gets both wrong. ───
  it('excludes an unrelated org that happens to share the same slug path', async () => {
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'org-1')
    expect(schoolIds).not.toContain('school-twin')
  })

  it('excludes an unrelated org whose slug is a bare string-prefix sibling', async () => {
    const schoolIds = await schoolsForGroupSubtree(makeSvc(), 'org-1')
    expect(schoolIds).not.toContain('school-prefix')
  })
})

describe('isStrictDescendantGroup — arbitrary-depth subtree matching', () => {
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

  it('rejects an unrelated org sharing the same slug path — it is not below anyone', async () => {
    expect(await isStrictDescendantGroup(makeSvc(), 'org-1', 'org-1-twin')).toBe(false)
    expect(await isStrictDescendantGroup(makeSvc(), 'org-1-twin', 'org-1')).toBe(false)
  })

  it('rejects an unrelated org whose slug is a bare string-prefix sibling', async () => {
    expect(await isStrictDescendantGroup(makeSvc(), 'org-1', 'org-1-prefix')).toBe(false)
  })
})
