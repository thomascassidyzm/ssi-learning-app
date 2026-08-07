/**
 * Tests for the founding-admin membership writer + the one definition of
 * "school staff" (api/_utils/schoolStaff.ts).
 *
 * The class this closes (Chepstow, 2026-08-06): only the school_admin_join
 * CLAIM path ever wrote an admin's user_tags SCHOOL: row, so a school's
 * FOUNDING admin was invisible to every staff-keyed number in her own school.
 */
import { describe, it, expect, vi } from 'vitest'
import { ensureSchoolAdminTag, SCHOOL_STAFF_ROLES } from './schoolStaff'

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
