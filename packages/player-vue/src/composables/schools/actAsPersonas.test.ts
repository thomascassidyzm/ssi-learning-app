import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchDemoPersonas, roleLabel } from './actAsPersonas'

// Minimal fluent mock: any chained call (select/eq/in/order) returns the same
// thenable builder, which resolves to { data } for its table when awaited —
// enough to exercise fetchDemoPersonas' join logic without a real Supabase
// client. Filter predicates aren't re-implemented; each table's fixture data
// is pre-scoped to what the real query would have returned.
function makeClient(tables: Record<string, unknown[]>): SupabaseClient {
  const from = (table: string) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: unknown[] }) => void) =>
        resolve({ data: tables[table] ?? [] }),
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

describe('roleLabel', () => {
  it('labels govt_admin as Group leader', () => {
    expect(roleLabel('govt_admin')).toBe('Group leader')
  })
})

describe('fetchDemoPersonas', () => {
  it('surfaces a govt_admin (group leader) persona named by their group', async () => {
    const client = makeClient({
      schools: [],
      learners: [
        { user_id: 'u-ime', display_name: 'IME Group Leader', educational_role: 'govt_admin' },
      ],
      govt_admins: [{ user_id: 'u-ime', group_id: 'g-ime' }],
      groups: [{ id: 'g-ime', name: 'IME Demo Programme' }],
    })

    const personas = await fetchDemoPersonas(client)

    expect(personas).toEqual([
      {
        key: 'govt_admin:u-ime',
        userId: 'u-ime',
        role: 'govt_admin',
        name: 'IME Group Leader · IME Demo Programme',
      },
    ])
  })

  it('does not surface a govt_admin with no linked demo group', async () => {
    const client = makeClient({
      schools: [],
      learners: [
        { user_id: 'u-orphan', display_name: 'Orphan Leader', educational_role: 'govt_admin' },
      ],
      govt_admins: [],
      groups: [],
    })

    const personas = await fetchDemoPersonas(client)

    expect(personas).toEqual([])
  })

  it('combines school_admin/teacher and govt_admin personas, ordered leader-then-teacher-then-group', async () => {
    const client = makeClient({
      schools: [{ id: 's1', school_name: 'Ysgol Bro Morgannwg', admin_user_id: 'u-admin' }],
      learners: [
        { user_id: 'u-admin', display_name: 'Ana', educational_role: 'school_admin' },
        { user_id: 'u-teach', display_name: 'Tom', educational_role: 'teacher' },
        { user_id: 'u-ime', display_name: 'IME Group Leader', educational_role: 'govt_admin' },
      ],
      user_tags: [{ user_id: 'u-teach', tag_value: 'SCHOOL:s1' }],
      govt_admins: [{ user_id: 'u-ime', group_id: 'g-ime' }],
      groups: [{ id: 'g-ime', name: 'IME Demo Programme' }],
    })

    const personas = await fetchDemoPersonas(client)

    expect(personas.map((p) => p.role)).toEqual(['school_admin', 'teacher', 'govt_admin'])
    expect(personas[2].name).toBe('IME Group Leader · IME Demo Programme')
  })
})
