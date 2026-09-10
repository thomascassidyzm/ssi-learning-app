/**
 * The ruling, as tests. Tom, 2026-09-10: a minted plain learner is a REAL
 * person and is INCLUDED; gifted is an entitlement fact on the money side with
 * no effect on analytics inclusion; only a not-a-person is ever excluded.
 */
import { describe, it, expect, vi } from 'vitest'
import { birthFlags, mintPerson, mintNotAPerson } from './mintLearner'

function fakeClient(opts: { entitlementFails?: boolean } = {}) {
  const writes: Record<string, any[]> = {}
  const deletes: string[] = []
  const client: any = {
    from(table: string) {
      const builder: any = {
        insert(payload: any) {
          writes[table] = writes[table] || []
          writes[table].push(payload)
          const fails = table === 'user_entitlements' && opts.entitlementFails
          builder._result = fails
            ? { data: null, error: { message: 'boom' } }
            : { data: { id: `${table}-1`, user_id: payload.user_id ?? null }, error: null }
          return builder
        },
        select() { return builder },
        eq(_col: string, val: string) { deletes.push(val); return Promise.resolve({ error: null }) },
        delete() { return builder },
        single() { return Promise.resolve(builder._result) },
        then(resolve: any) { return Promise.resolve(builder._result).then(resolve) },
      }
      return builder
    },
  }
  return { client, writes, deletes }
}

describe('birthFlags', () => {
  it('mints a person real and included', () => {
    expect(birthFlags('person')).toEqual({ is_demo: false, is_internal: false })
  })

  it('excludes only the things that are not people', () => {
    expect(birthFlags('demo')).toEqual({ is_demo: true, is_internal: false })
    expect(birthFlags('test')).toEqual({ is_demo: false, is_internal: true })
  })
})

describe('mintPerson', () => {
  it('writes a learner carrying no exclusion flag at all', async () => {
    const { client, writes } = fakeClient()
    const out = await mintPerson(client, { displayName: 'Pilot teacher' })
    expect('error' in out).toBe(false)
    expect(writes.learners[0].is_demo).toBe(false)
    expect(writes.learners[0].is_internal).toBe(false)
    expect(writes.user_entitlements).toBeUndefined()
  })

  it('a GIFTED learner is still born real and included', async () => {
    const { client, writes } = fakeClient()
    const out = await mintPerson(client, {
      displayName: 'Comped friend',
      gift: { access_type: 'full', duration_type: 'lifetime' },
      actorUserId: 'admin-uid',
    })
    expect(out).toMatchObject({ gifted: true })
    // The gift is on the money side...
    expect(writes.user_entitlements[0]).toMatchObject({ access_type: 'full', entitlement_code_id: null })
    // ...and changes nothing about whether they count.
    expect(writes.learners[0].is_internal).toBe(false)
    expect(writes.learners[0].is_demo).toBe(false)
  })

  it('records who gifted whom', async () => {
    const { client, writes } = fakeClient()
    await mintPerson(client, {
      displayName: 'Comped friend',
      gift: { access_type: 'full' },
      actorUserId: 'admin-uid',
    })
    expect(writes.role_change_audit[0]).toMatchObject({
      field: 'entitlement',
      new_value: 'full',
      source: 'mint-learner',
      actor_user_id: 'admin-uid',
    })
  })

  it('rolls the learner back rather than leaving a half-minted person', async () => {
    const { client, deletes } = fakeClient({ entitlementFails: true })
    const out = await mintPerson(client, { displayName: 'Comped friend', gift: { access_type: 'full' } })
    expect('error' in out).toBe(true)
    expect(deletes).toContain('learners-1')
  })

  it('refuses a nameless learner', async () => {
    const { client } = fakeClient()
    expect(await mintPerson(client, { displayName: '  ' })).toMatchObject({ error: 'display_name is required' })
  })
})

describe('mintNotAPerson', () => {
  it('is the only door that sets an exclusion flag', async () => {
    const { client, writes } = fakeClient()
    await mintNotAPerson(client, 'demo', { displayName: 'Demo pupil' })
    expect(writes.learners[0].is_demo).toBe(true)

    const second = fakeClient()
    await mintNotAPerson(second.client, 'test', { displayName: 'QA rig' })
    expect(second.writes.learners[0].is_internal).toBe(true)
  })
})
