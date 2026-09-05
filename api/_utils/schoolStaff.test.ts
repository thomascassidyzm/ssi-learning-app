/**
 * Tests for the founding-admin membership writer + the one definition of
 * "school staff" (api/_utils/schoolStaff.ts).
 *
 * The class this closes (Chepstow, 2026-08-06): only the school_admin_join
 * CLAIM path ever wrote an admin's user_tags SCHOOL: row, so a school's
 * FOUNDING admin was invisible to every staff-keyed number in her own school.
 */
import { describe, it, expect, vi } from 'vitest'
import { ensureSchoolAdminTag, schoolMembershipsOf, SCHOOL_STAFF_ROLES } from './schoolStaff'

function fakeClient(insertResult: { error: { code?: string; message?: string } | null }) {
  const inserts: unknown[] = []
  const client = {
    inserts,
    from: (table: string) => ({
      insert: (payload: unknown) => {
        inserts.push({ table, payload })
        return Promise.resolve(insertResult)
      },
    }),
  }
  return client as any
}

describe('SCHOOL_STAFF_ROLES', () => {
  it('is teacher OR admin — the same definition school_summary.staff_practice_hours uses', () => {
    // If this ever narrows back to ['teacher'], the school's own admin drops
    // out of her own Teachers list while her practice stays in the headline —
    // the exact split-definition defect this module exists to prevent.
    expect([...SCHOOL_STAFF_ROLES]).toEqual(['teacher', 'admin'])
  })
})

describe('ensureSchoolAdminTag', () => {
  it('writes the admin membership row with role_in_context admin', async () => {
    const client = fakeClient({ error: null })
    const err = await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })

    expect(err).toBeNull()
    expect(client.inserts).toEqual([
      {
        table: 'user_tags',
        payload: {
          user_id: 'admin-uid',
          tag_type: 'school',
          tag_value: 'SCHOOL:school-1',
          role_in_context: 'admin',
          added_by: 'admin-uid',
        },
      },
    ])
  })

  it("never writes the founding admin as a 'teacher' (one convention, not two)", async () => {
    const client = fakeClient({ error: null })
    await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })
    expect((client.inserts[0] as any).payload.role_in_context).not.toBe('teacher')
  })

  it('honours an explicit addedBy (e.g. an ssi_admin creating the school)', async () => {
    const client = fakeClient({ error: null })
    await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 's1', addedBy: 'ssi-admin-uid' })
    expect((client.inserts[0] as any).payload.added_by).toBe('ssi-admin-uid')
  })

  it('is idempotent — 23505 on the active-tag unique index is a no-op, not an error', async () => {
    // user_tags_active_natural_key is UNIQUE on (user_id, tag_type, tag_value)
    // WHERE removed_at IS NULL, so a re-provision (or a raced concurrent
    // redemption) hits 23505 and must NOT fail the caller.
    const client = fakeClient({ error: { code: '23505', message: 'duplicate key value' } })
    const err = await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })
    expect(err).toBeNull()
  })

  it('reports a real failure', async () => {
    const client = fakeClient({ error: { code: '42501', message: 'permission denied' } })
    const err = await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })
    expect(err).toBe('permission denied')
  })
})

/**
 * schoolMembershipsOf — the ONE resolver, so the caller and the target of an
 * authz decision can never be asked different questions about the same thing.
 * The bug it closes is api/school/staff-signin-link.ts's asymmetry (2026-09-05):
 * the caller was resolved through both spellings, the target through user_tags
 * alone, so an untagged founding admin of another school read as reaching
 * nowhere.
 */
function membershipClient(owned: Array<{ id: string }>, tags: Array<{ tag_value: string; role_in_context: string }>) {
  const chain = (result: unknown) => {
    const b: any = {}
    for (const m of ['select', 'eq', 'in', 'is']) b[m] = () => b
    b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
    return b
  }
  return {
    from: (table: string) =>
      table === 'schools' ? chain({ data: owned, error: null }) : chain({ data: tags, error: null }),
  } as any
}

describe('schoolMembershipsOf', () => {
  it('sees a school held only through schools.admin_user_id, with no tag anywhere', async () => {
    const out = await schoolMembershipsOf(membershipClient([{ id: 'school-2' }], []), 'uid-1')
    expect(out).toEqual([{ schoolId: 'school-2', role: 'admin' }])
  })

  it('sees a school held only through an active SCHOOL: tag', async () => {
    const out = await schoolMembershipsOf(
      membershipClient([], [{ tag_value: 'SCHOOL:school-1', role_in_context: 'teacher' }]),
      'uid-1',
    )
    expect(out).toEqual([{ schoolId: 'school-1', role: 'teacher' }])
  })

  it('unions both spellings, and admin wins when they describe the same school', async () => {
    const out = await schoolMembershipsOf(
      membershipClient(
        [{ id: 'school-1' }],
        [
          { tag_value: 'SCHOOL:school-1', role_in_context: 'teacher' },
          { tag_value: 'SCHOOL:school-2', role_in_context: 'teacher' },
        ],
      ),
      'uid-1',
    )
    expect(out).toEqual([
      { schoolId: 'school-1', role: 'admin' },
      { schoolId: 'school-2', role: 'teacher' },
    ])
  })

  it('returns nothing for an empty uid, without querying', async () => {
    expect(await schoolMembershipsOf(membershipClient([{ id: 'school-1' }], []), '')).toEqual([])
  })
})
