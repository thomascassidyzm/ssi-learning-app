/**
 * groupSlug / findSiblingSlugCollisions / duplicateNameBody.
 *
 * The slug tests are the anti-drift net: `groupSlug()` must agree with
 * compute_group_path()'s one line in supabase/schema.sql —
 *   LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'))
 * — because a naive name-equality check would have missed every one of
 * Deborah's variants.
 */
import { describe, it, expect, vi } from 'vitest'
import { groupSlug, findSiblingSlugCollisions, duplicateNameBody } from './groupSlug'

describe('groupSlug — mirrors compute_group_path()', () => {
  it('the Deborah variants all slug to the same string', () => {
    for (const name of ['Deborah Testing', 'deborah testing', 'Deborah  Testing', 'Deborah-Testing', 'Deborah_Testing', 'DEBORAH  ---  TESTING']) {
      expect(groupSlug(name)).toBe('deborah-testing')
    }
  })

  it('a genuinely different name does NOT collide', () => {
    expect(groupSlug('Deborah Testing 2')).toBe('deborah-testing-2')
    expect(groupSlug('Deborah Testing 2')).not.toBe(groupSlug('Deborah Testing'))
  })

  it('does not trim leading/trailing separators — the SQL does not either', () => {
    // Callers trim the name before inserting, so this only matters if one ever
    // stops. Asserted so the mirror stays honest rather than "nicer".
    expect(groupSlug(' Cardiff ')).toBe('-cardiff-')
    expect(groupSlug('Cardiff!')).toBe('cardiff-')
  })

  it('non-ASCII is a separator, exactly like the SQL character class', () => {
    expect(groupSlug('Café Cymru')).toBe('caf-cymru')
  })

  it('is empty for a blank or symbol-free-only name', () => {
    expect(groupSlug('')).toBe('')
    expect(groupSlug(undefined as unknown as string)).toBe('')
  })
})

function fakeSupabase(rows: any[] | null, error: any = null, capture?: (c: any) => void) {
  const calls: any = {}
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { calls.eq = [col, val]; capture?.(calls); return builder },
    is: (col: string, val: unknown) => { calls.is = [col, val]; capture?.(calls); return builder },
    then: (resolve: any) => resolve({ data: rows, error }),
  }
  return { from: () => builder } as any
}

describe('findSiblingSlugCollisions', () => {
  const rows = [
    { id: 'g1', name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z', path: 'deborah-testing' },
    { id: 'g2', name: 'Cardiff Council', created_at: '2026-07-01T10:00:00Z', path: 'cardiff-council' },
  ]

  it('matches on the slug, not the raw name', async () => {
    const found = await findSiblingSlugCollisions(fakeSupabase(rows), 'deborah-TESTING', null)
    expect(found.map((g) => g.id)).toEqual(['g1'])
  })

  it('returns nothing for a non-colliding name', async () => {
    expect(await findSiblingSlugCollisions(fakeSupabase(rows), 'Deborah Testing 2', null)).toEqual([])
  })

  it('scopes root creation to parent_id IS NULL', async () => {
    let seen: any
    await findSiblingSlugCollisions(fakeSupabase(rows, null, (c) => { seen = c }), 'Anything', null)
    expect(seen.is).toEqual(['parent_id', null])
    expect(seen.eq).toBeUndefined()
  })

  it('scopes sub-group creation to that parent only — "Year 7" in school B is not school A\'s problem', async () => {
    let seen: any
    await findSiblingSlugCollisions(fakeSupabase([], null, (c) => { seen = c }), 'Year 7', 'school-a')
    expect(seen.eq).toEqual(['parent_id', 'school-a'])
  })

  it('FAILS OPEN on a lookup error — no warning, never a failed creation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await findSiblingSlugCollisions(fakeSupabase(null, { message: 'boom' }), 'Deborah Testing', null)).toEqual([])
    warn.mockRestore()
  })

  it('returns nothing for a blank name rather than matching every blank-slug row', async () => {
    expect(await findSiblingSlugCollisions(fakeSupabase(rows), '   ', null)).toEqual([])
  })
})

describe('duplicateNameBody', () => {
  const dupes = [{ id: 'g1', name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z', path: 'deborah-testing' }]

  it('redacts another tenant\'s id and path for a non-detailed caller', () => {
    const body = duplicateNameBody(dupes, { detailed: false })
    expect(body.code).toBe('duplicate_name')
    expect(body.duplicates).toEqual([{ name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z' }])
  })

  it('gives an admin, or an in-subtree collision, the full row', () => {
    expect(duplicateNameBody(dupes, { detailed: true }).duplicates[0]).toMatchObject({ id: 'g1', path: 'deborah-testing' })
  })

  it('names the thing being created — organisation or group', () => {
    expect(duplicateNameBody(dupes, { detailed: false }).error).toContain('an organisation called "Deborah Testing"')
    expect(duplicateNameBody(dupes, { detailed: true, noun: 'group' }).error).toContain('a group called "Deborah Testing"')
  })
})
