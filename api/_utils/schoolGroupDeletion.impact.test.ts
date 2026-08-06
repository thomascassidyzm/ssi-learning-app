/**
 * computeGroupImpact — honest-delete preview (founder pass C, 2026-07-19).
 * The preview must mirror deleteGroupCascade's ACTUAL semantics: descendant
 * groups are deleted; schools with their own node in the subtree are deleted;
 * legacy-attached schools (group_id only) are ungrouped, not deleted; counts
 * cover only what is truly deleted (the deleted schools' classes/rosters).
 */
import { describe, it, expect, vi } from 'vitest'
import { computeGroupImpact } from './schoolGroupDeletion'

interface GroupRow { id: string; name: string; path: string | null; parent_id?: string | null }
interface SchoolRow { id: string; school_name: string; group_id: string | null; node_group_id: string | null }

function makeSupabase(opts: {
  groups: GroupRow[]
  schools: SchoolRow[]
  classesBySchool?: Record<string, string[]>
  sessions?: { class_id: string; cycles_completed: number }[]
  tags?: { user_id: string; role_in_context: string; tag_value: string }[]
}) {
  const classesBySchool = opts.classesBySchool || {}
  const sessions = opts.sessions || []
  const tags = opts.tags || []
  return {
    from: (table: string) => {
      const b: any = { _filters: {} as Record<string, unknown> }
      // A bare `groups` select (no filter) is the forest fetch the parent_id
      // subtree walk makes — resolve it straight away.
      b.select = vi.fn((cols: string) => (
        table === 'groups' && typeof cols === 'string' && cols.includes('parent_id')
          ? Promise.resolve({ data: opts.groups, error: null })
          : b
      ))
      b.eq = vi.fn((col: string, val: unknown) => { b._filters[col] = val; return b })
      b.is = vi.fn(() => b)
      b.maybeSingle = vi.fn(async () => ({
        data: opts.groups.find((g) => g.id === b._filters.id) ?? null,
        error: null,
      }))
      b.like = vi.fn((_col: string, pattern: string) =>
        Promise.resolve({
          data: opts.groups.filter((g) => g.path && g.path.startsWith(pattern.replace(/%$/, ''))),
          error: null,
        }))
      b.in = vi.fn((col: string, vals: string[]) => {
        if (table === 'schools') {
          return Promise.resolve({
            data: opts.schools.filter((s) => vals.includes((s as any)[col] as string)),
            error: null,
          })
        }
        if (table === 'classes') {
          const ids = vals.flatMap((sid) => classesBySchool[sid] || []).map((id) => ({ id }))
          return Promise.resolve({ data: ids, error: null })
        }
        if (table === 'class_sessions') {
          return Promise.resolve({ data: sessions.filter((s) => vals.includes(s.class_id)), error: null })
        }
        if (table === 'user_tags') {
          b._tagVals = vals
          return b // user_tags chains .is() after .in()
        }
        return Promise.resolve({ data: [], error: null })
      })
      if (table === 'user_tags') {
        b.is = vi.fn(() => Promise.resolve({
          data: tags.filter((t) => (b._tagVals || []).includes(t.tag_value)),
          error: null,
        }))
      }
      return b
    },
  } as any
}

describe('computeGroupImpact — subtree-honest preview', () => {
  it('splits deleted school-nodes from orphaned legacy attachments across the subtree', async () => {
    const supabase = makeSupabase({
      groups: [
        { id: 'prog', name: 'IME Demo Programme', path: 'ime', parent_id: null },
        { id: 'region', name: 'Pilot Districts Region', path: 'ime/region', parent_id: 'prog' },
        { id: 'school-node', name: 'Ysgol y Bont', path: 'ime/region/bont', parent_id: 'region' },
      ],
      schools: [
        // own node inside the subtree → deleted
        { id: 's1', school_name: 'Ysgol y Bont', group_id: 'region', node_group_id: 'school-node' },
        // legacy attach (no node) → orphaned to top level
        { id: 's2', school_name: 'Legacy High', group_id: 'region', node_group_id: null },
        // node OUTSIDE the subtree → orphaned, not deleted
        { id: 's3', school_name: 'Elsewhere Academy', group_id: 'prog', node_group_id: 'other-node' },
      ],
      classesBySchool: { s1: ['c1', 'c2'], s2: ['c-legacy'] },
      sessions: [{ class_id: 'c1', cycles_completed: 5 }],
      tags: [
        { user_id: 'u1', role_in_context: 'student', tag_value: 'SCHOOL:s1' },
        { user_id: 'u2', role_in_context: 'teacher', tag_value: 'SCHOOL:s1' },
        { user_id: 'u3', role_in_context: 'student', tag_value: 'SCHOOL:s2' },
      ],
    })
    const impact = await computeGroupImpact(supabase, 'prog')
    expect(impact.descendantGroupCount).toBe(2)
    expect(impact.descendantGroupNames).toEqual(['Pilot Districts Region', 'Ysgol y Bont'])
    expect(impact.schoolCount).toBe(1)
    expect(impact.schoolNames).toEqual(['Ysgol y Bont'])
    expect(impact.orphanedSchoolCount).toBe(2)
    expect(impact.orphanedSchoolNames).toEqual(expect.arrayContaining(['Legacy High', 'Elsewhere Academy']))
    // counts cover ONLY the deleted school — s2's class/roster survives
    expect(impact.classCount).toBe(2)
    expect(impact.sessionCount).toBe(1)
    expect(impact.learnerCount).toBe(1)
    expect(impact.teacherCount).toBe(1)
    expect(impact.hasRealActivity).toBe(true)
  })

  it('leaf group with nothing below reports zeros and no descendants', async () => {
    const supabase = makeSupabase({
      groups: [{ id: 'lone', name: 'Lone Group', path: 'lone', parent_id: null }],
      schools: [],
    })
    const impact = await computeGroupImpact(supabase, 'lone')
    expect(impact.descendantGroupCount).toBe(0)
    expect(impact.schoolCount).toBe(0)
    expect(impact.orphanedSchoolCount).toBe(0)
    expect(impact.classCount).toBe(0)
    expect(impact.hasRealActivity).toBe(false)
  })
})
