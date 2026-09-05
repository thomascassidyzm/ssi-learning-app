/**
 * Tests for the founding-admin membership writer + the one definition of
 * "school staff" (api/_utils/schoolStaff.ts).
 *
 * The class this closes (Chepstow, 2026-08-06): only the school_admin_join
 * CLAIM path ever wrote an admin's user_tags SCHOOL: row, so a school's
 * FOUNDING admin was invisible to every staff-keyed number in her own school.
 */
import { describe, it, expect, vi } from 'vitest'
import { ensureSchoolAdminTag, schoolMembershipsOf, schoolReachOf, SCHOOL_STAFF_ROLES } from './schoolStaff'

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
