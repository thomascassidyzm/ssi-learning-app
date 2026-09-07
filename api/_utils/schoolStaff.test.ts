/**
 * Tests for the founding-admin membership writer + the one definition of
 * "school staff" (api/_utils/schoolStaff.ts).
 *
 * The class this closes (Chepstow, 2026-08-06): only the school_admin_join
 * CLAIM path ever wrote an admin's user_tags SCHOOL: row, so a school's
 * FOUNDING admin was invisible to every staff-keyed number in her own school.
 */
import { describe, it, expect } from 'vitest'
import {
  ensureSchoolAdminTag,
  isSchoolAdminOf,
  schoolMembershipsOf,
  schoolReachOf,
  SCHOOL_STAFF_ROLES,
} from './schoolStaff'

/**
 * `existingRow` models what the post-23505 re-read finds: the row that already
 * holds the `unique_active_tag` key. An ACTIVE one (removed_at null) is the
 * idempotent no-op; a SOFT-REMOVED one is the re-invite case that must be
 * reactivated rather than reported as a grant that never happened.
 */
function fakeClient(
  insertResult: { error: { code?: string; message?: string } | null },
  existingRow: { id: string; removed_at: string | null } | null = null,
) {
  const inserts: unknown[] = []
  const updates: Array<{ payload: any; id: string | null }> = []
  const client = {
    inserts,
    updates,
    from: (table: string) => ({
      insert: (payload: unknown) => {
        inserts.push({ table, payload })
        return Promise.resolve(insertResult)
      },
      select: () => {
        const b: any = {
          eq: () => b,
          is: () => b,
          maybeSingle: () => Promise.resolve({ data: existingRow, error: null }),
        }
        return b
      },
      update: (payload: any) => {
        const rec: { payload: any; id: string | null } = { payload, id: null }
        updates.push(rec)
        const b: any = {
          eq: (_col: string, val: string) => {
            rec.id = val
            return b
          },
          then: (resolve: any, reject: any) => Promise.resolve({ error: null }).then(resolve, reject),
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

  it('is idempotent — 23505 held by an ACTIVE tag is a no-op, not an error', async () => {
    // A re-provision, or a raced concurrent redemption, hits 23505 while the
    // grant this call asked for is already in force. Nothing to do, nothing to
    // report — and in particular no pointless UPDATE over a live row.
    const client = fakeClient({ error: { code: '23505', message: 'duplicate key value' } }, {
      id: 'tag-1',
      removed_at: null,
    })
    const err = await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })
    expect(err).toBeNull()
    expect(client.updates).toEqual([])
  })

  it('RE-INVITE: 23505 held by a REMOVED tag reactivates that row', async () => {
    // The live bug (NPTC onboarding, 2026-09-07). `unique_active_tag` is
    // UNIQUE (user_id, tag_type, tag_value) with NO removed_at predicate, so a
    // school admin removed by api/school/remove-staff.ts keeps the key. The
    // re-invite's INSERT therefore raises 23505 and writes nothing, and every
    // admin predicate requires removed_at IS NULL — so the person is still not
    // an admin, and the old code told the caller it had worked.
    const client = fakeClient({ error: { code: '23505', message: 'duplicate key value' } }, {
      id: 'tag-removed',
      removed_at: '2026-09-01T10:00:00.000Z',
    })
    const err = await ensureSchoolAdminTag(client, {
      userId: 'admin-uid',
      schoolId: 'school-1',
      addedBy: 'inviter-uid',
    })

    expect(err).toBeNull()
    expect(client.updates).toHaveLength(1)
    expect(client.updates[0].id).toBe('tag-removed')
    expect(client.updates[0].payload.removed_at).toBeNull()
    expect(client.updates[0].payload.role_in_context).toBe('admin')
    expect(client.updates[0].payload.added_by).toBe('inviter-uid')
    expect(typeof client.updates[0].payload.added_at).toBe('string')
  })

  it('23505 with no row found at all is a no-op — parity with redeem.ts insertTagReactivating', async () => {
    // The key was taken at INSERT time but the re-read finds nothing: a raced
    // concurrent delete, or a 23505 raised by some other constraint. The
    // reactivating shape used across the estate (api/code/redeem.ts's
    // insertTagReactivating, api/_utils/classTeacherTag.ts) treats this as a
    // no-op rather than inventing a second convention here. Before 2026-09-07
    // this branch ALSO covered the re-invite case, which is the bug the test
    // above now pins: a removed row holding the key is reactivated, not
    // reported as either success or failure.
    const client = fakeClient({ error: { code: '23505', message: 'duplicate key value' } }, null)
    const err = await ensureSchoolAdminTag(client, { userId: 'admin-uid', schoolId: 'school-1' })
    expect(err).toBeNull()
    expect(client.updates).toEqual([])
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
 * schoolReachOf — the WIDER question, for containment only: "does this account
 * touch anywhere else AT ALL", pupil seats included. The gap it closes
 * (2026-09-05): api/school/staff-signin-link.ts asked that question with the
 * STAFF resolver, so a teacher at school-1 who also studies at school-2 read as
 * reaching nowhere else, and school-1's admin could mint a live session that
 * opened their private pupil account at school-2.
 */
function reachClient(opts: {
  owned?: Array<{ id: string }>
  schoolTags?: Array<{ tag_value: string; role_in_context: string }>
  classTags?: Array<{ tag_value: string; role_in_context: string }>
  classes?: Array<{ id: string; school_id: string | null }>
}) {
  const chain = (rows: (calls: any[][]) => unknown) => {
    const calls: any[][] = []
    const b: any = {}
    for (const m of ['select', 'eq', 'in', 'is']) {
      b[m] = (...args: any[]) => {
        calls.push([m, ...args])
        return b
      }
    }
    b.then = (resolve: any, reject: any) => Promise.resolve(rows(calls)).then(resolve, reject)
    return b
  }
  const eqVal = (calls: any[][], col: string) => calls.find((c) => c[0] === 'eq' && c[1] === col)?.[2]
  return {
    from: (table: string) => {
      if (table === 'schools') return chain(() => ({ data: opts.owned || [], error: null }))
      if (table === 'classes') return chain(() => ({ data: opts.classes || [], error: null }))
      return chain((calls) => {
        const rows = eqVal(calls, 'tag_type') === 'class' ? opts.classTags || [] : opts.schoolTags || []
        const allowed = calls.find((c) => c[0] === 'in' && c[1] === 'role_in_context')?.[2] as string[] | undefined
        return { data: allowed ? rows.filter((r) => allowed.includes(r.role_in_context)) : rows, error: null }
      })
    },
  } as any
}

describe('schoolReachOf', () => {
  it('sees a PUPIL school tag that the staff-only resolver filters out', async () => {
    const client = reachClient({
      schoolTags: [
        { tag_value: 'SCHOOL:school-1', role_in_context: 'teacher' },
        { tag_value: 'SCHOOL:school-2', role_in_context: 'student' },
      ],
    })
    // The staff view — deliberately blind to the pupil seat. This asymmetry is
    // the whole bug, so both halves are asserted together.
    expect(await schoolMembershipsOf(client, 'uid-1')).toEqual([{ schoolId: 'school-1', role: 'teacher' }])
    expect(await schoolReachOf(client, 'uid-1')).toEqual([
      { schoolId: 'school-1', role: 'teacher' },
      { schoolId: 'school-2', role: 'student' },
    ])
  })

  it('resolves a pupil CLASS tag to its school — the only tag a student redemption writes', async () => {
    const out = await schoolReachOf(
      reachClient({
        classTags: [{ tag_value: 'CLASS:class-9', role_in_context: 'student' }],
        classes: [{ id: 'class-9', school_id: 'school-2' }],
      }),
      'uid-1',
    )
    expect(out).toEqual([{ schoolId: 'school-2', role: 'student' }])
  })

  it('keeps the founding-admin pointer, and the highest capacity wins per school', async () => {
    const out = await schoolReachOf(
      reachClient({
        owned: [{ id: 'school-1' }],
        schoolTags: [{ tag_value: 'SCHOOL:school-1', role_in_context: 'student' }],
        classTags: [{ tag_value: 'CLASS:class-3', role_in_context: 'teacher' }],
        classes: [{ id: 'class-3', school_id: 'school-1' }],
      }),
      'uid-1',
    )
    expect(out).toEqual([{ schoolId: 'school-1', role: 'admin' }])
  })

  it('ignores a class whose school_id is null rather than inventing a school', async () => {
    const out = await schoolReachOf(
      reachClient({
        classTags: [{ tag_value: 'CLASS:class-9', role_in_context: 'student' }],
        classes: [{ id: 'class-9', school_id: null }],
      }),
      'uid-1',
    )
    expect(out).toEqual([])
  })

  it('returns nothing for an empty uid, without querying', async () => {
    expect(await schoolReachOf(reachClient({ owned: [{ id: 'school-1' }] }), '')).toEqual([])
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
