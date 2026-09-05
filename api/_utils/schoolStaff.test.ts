/**
 * Tests for the founding-admin membership writer + the one definition of
 * "school staff" (api/_utils/schoolStaff.ts).
 *
 * The class this closes (Chepstow, 2026-08-06): only the school_admin_join
 * CLAIM path ever wrote an admin's user_tags SCHOOL: row, so a school's
 * FOUNDING admin was invisible to every staff-keyed number in her own school.
 */
import { describe, it, expect, vi } from 'vitest'
import { ensureSchoolAdminTag, isSchoolAdminOf, schoolMembershipsOf, SCHOOL_STAFF_ROLES } from './schoolStaff'

/**
 * `activeTagAfter23505` models what the follow-up VERIFY read finds: whether an
 * ACTIVE tag actually holds the unique key (idempotent no-op) or a REMOVED one
 * does (the grant silently did not happen — see schoolStaff.ts's 23505 note).
 */
function fakeClient(
  insertResult: { error: { code?: string; message?: string } | null },
  activeTagAfter23505: boolean = true,
) {
  const inserts: unknown[] = []
  const client = {
    inserts,
    from: (table: string) => ({
      insert: (payload: unknown) => {
        inserts.push({ table, payload })
        return Promise.resolve(insertResult)
      },
      select: () => {
        const b: any = {
          eq: () => b,
          is: () => b,
          maybeSingle: () =>
            Promise.resolve({ data: activeTagAfter23505 ? { id: 'tag-1' } : null, error: null }),
        }
        return b
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

  it('is idempotent — 23505 with an ACTIVE tag already present is a no-op, not an error', async () => {
    // A re-provision, or a raced concurrent redemption, hits 23505 while the
    // grant this call asked for is already in force. Nothing to report.
    const client = fakeClient({ error: { code: '23505', message: 'duplicate key value' } }, true)
    const err = await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })
    expect(err).toBeNull()
  })

  it('23505 with NO active tag is a LOUD failure — the grant did not happen', async () => {
    // Verified live 2026-09-05: the constraint that fires is `unique_active_tag`
    // — UNIQUE (user_id, tag_type, tag_value) with NO `WHERE removed_at IS NULL`
    // (migration 20260717_user_tags_active_unique's partial index is still
    // unapplied). So a REVOKED tag keeps the key, and re-granting admin to a
    // previously-removed person inserts nothing while both admin predicates
    // still say "not an admin". Reporting success there is how a school ends up
    // with nobody able to administer it and no error anywhere. Two live rows
    // were in exactly this state on 2026-09-05.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = fakeClient({ error: { code: '23505', message: 'duplicate key value' } }, false)
    const err = await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })
    expect(err).toContain('school-1')
    expect(err).toContain('NOT granted')
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
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

/**
 * AGREEMENT TEST — the admin predicate is implemented TWICE, in two languages,
 * and both are live authority:
 *
 *   TS : isSchoolAdminOf() in this module (every API-route authz decision)
 *   SQL: public.is_school_admin_of(uuid) in supabase/schema.sql (RLS on
 *        classes_select, class_sessions, invite_codes INSERT)
 *
 * The SQL, verbatim in behaviour (schema.sql:4340):
 *   EXISTS (schools s WHERE s.id = p_school_id AND s.admin_user_id = auth.uid()::text)
 *   OR EXISTS (user_tags ut WHERE ut.user_id = auth.uid()::text
 *              AND ut.tag_type='school' AND ut.role_in_context='admin'
 *              AND ut.removed_at IS NULL AND ut.tag_value = 'SCHOOL:'||p_school_id)
 *
 * The only structural difference is WHOSE identity is asked about: SQL takes it
 * implicitly from auth.uid(), TS takes an explicit userId. Both hold the AUTH
 * UID (not the learner PK) — CLAUDE.md's identity table. Everything else must
 * match, over BOTH spellings, in every combination. When these two drift, reads
 * work and writes do not (or the reverse) — the estate's 2026-08-08 Harbour View
 * defect, where the DB knew the tag spelling and the API did not.
 */
const sqlIsSchoolAdminOf = (s: { pointerMatches: boolean; activeAdminTag: boolean }) =>
  s.pointerMatches || s.activeAdminTag

function adminFakeClient(state: {
  adminUserId: string | null
  tag: { role: string; removed: boolean } | null
}) {
  return {
    from: (table: string) => {
      if (table === 'schools') {
        const b: any = {
          select: () => b,
          eq: () => b,
          maybeSingle: () => Promise.resolve({ data: { admin_user_id: state.adminUserId }, error: null }),
        }
        return b
      }
      // user_tags — the TS query filters role_in_context='admin' AND
      // removed_at IS NULL, exactly as the SQL does.
      const b: any = {
        select: () => b,
        eq: () => b,
        is: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data: state.tag && state.tag.role === 'admin' && !state.tag.removed ? { id: 't1' } : null,
            error: null,
          }),
      }
      return b
    },
  } as any
}

describe('isSchoolAdminOf — TS agrees with SQL is_school_admin_of on every case', () => {
  const CASES: Array<{
    name: string
    adminUserId: string | null
    tag: { role: string; removed: boolean } | null
  }> = [
    { name: 'neither spelling', adminUserId: null, tag: null },
    { name: 'pointer only (founding admin, never tagged)', adminUserId: 'me', tag: null },
    { name: 'active admin tag only (invited/claimed admin)', adminUserId: 'someone-else', tag: { role: 'admin', removed: false } },
    { name: 'both spellings', adminUserId: 'me', tag: { role: 'admin', removed: false } },
    { name: 'tag REVOKED, no pointer — must be false', adminUserId: null, tag: { role: 'admin', removed: true } },
    { name: 'tag revoked but pointer still mine — still true', adminUserId: 'me', tag: { role: 'admin', removed: true } },
    { name: 'teacher tag only — not an admin', adminUserId: null, tag: { role: 'teacher', removed: false } },
    { name: 'pointer is another user', adminUserId: 'someone-else', tag: null },
  ]

  for (const c of CASES) {
    it(`agrees: ${c.name}`, async () => {
      const ts = await isSchoolAdminOf(adminFakeClient(c), 'me', 'school-1')
      const sql = sqlIsSchoolAdminOf({
        pointerMatches: c.adminUserId === 'me',
        activeAdminTag: !!c.tag && c.tag.role === 'admin' && !c.tag.removed,
      })
      expect(ts).toBe(sql)
    })
  }

  it('an empty userId or schoolId is never an admin (TS guard, no query fired)', async () => {
    expect(await isSchoolAdminOf(adminFakeClient(CASES[3]), '', 'school-1')).toBe(false)
    expect(await isSchoolAdminOf(adminFakeClient(CASES[3]), 'me', '')).toBe(false)
  })
})
