/**
 * Two rules meeting in one file, and the test exists to prove they do not
 * collide (Tom, 2026-09-10):
 *
 *   - staff and QA are born excluded, wherever the privilege is granted;
 *   - a GIFT is not privilege, and a comped learner must stay a real learner.
 */
import { describe, it, expect } from 'vitest'
import { applyDashboardRole, grantGiftEntitlement, validateGift, computeEntitlementExpiry } from './entitlementGrant'

function fakeClient() {
  const writes: Record<string, any[]> = {}
  const client: any = {
    from(table: string) {
      const builder: any = {
        _result: { data: null, error: null },
        select() { return builder },
        insert(payload: any) {
          writes[table] = writes[table] || []
          writes[table].push({ op: 'insert', payload })
          builder._result = { data: { id: `${table}-1` }, error: null }
          return builder
        },
        update(payload: any) {
          writes[table] = writes[table] || []
          writes[table].push({ op: 'update', payload })
          return builder
        },
        eq() { return builder },
        single() { return Promise.resolve(builder._result) },
        then(resolve: any) { return Promise.resolve(builder._result).then(resolve) },
      }
      return builder
    },
  }
  return { client, writes }
}

describe('applyDashboardRole', () => {
  it('a dashboard grant is born excluded: is_internal rides with the role', async () => {
    const { client, writes } = fakeClient()
    const applied = await applyDashboardRole(client, 'learner-1', {
      access_type: 'full',
      grants_platform_role: 'popty_user',
    })
    expect(applied).toBe(true)
    const update = writes.learners.find((w) => w.op === 'update')
    expect(update.payload.platform_role).toBe('popty_user')
    expect(update.payload.is_internal).toBe(true)
  })

  it('touches the learner not at all when the grant carries no role — a gift is not privilege', async () => {
    const { client, writes } = fakeClient()
    await applyDashboardRole(client, 'learner-1', { access_type: 'full' })
    expect(writes.learners).toBeUndefined()
  })
})

describe('grantGiftEntitlement', () => {
  it('writes access without touching a single flag on the learner', async () => {
    const { client, writes } = fakeClient()
    const out = await grantGiftEntitlement(client, 'learner-1', { access_type: 'full' }, {
      actorUserId: 'admin-uid',
      source: 'grant-entitlement',
    })
    expect(out.ok).toBe(true)
    expect(writes.user_entitlements[0].payload).toMatchObject({
      learner_id: 'learner-1',
      access_type: 'full',
      entitlement_code_id: null,
      expires_at: null,
    })
    // The gifted learner's own row is never written to. Being comped cannot
    // make somebody fake.
    expect(writes.learners).toBeUndefined()
  })

  it('leaves a record of who gifted whom', async () => {
    const { client, writes } = fakeClient()
    await grantGiftEntitlement(client, 'learner-1', { access_type: 'courses', granted_courses: ['cym_for_eng'] }, {
      actorUserId: 'admin-uid',
      source: 'grant-entitlement',
    })
    expect(writes.role_change_audit[0].payload).toMatchObject({
      field: 'entitlement',
      new_value: 'courses',
      source: 'grant-entitlement',
      actor_user_id: 'admin-uid',
      target_learner_id: 'learner-1',
    })
  })

  it('dates a time-limited gift and leaves a lifetime one open', () => {
    expect(computeEntitlementExpiry({ access_type: 'full', duration_type: 'lifetime' })).toBeNull()
    const dated = computeEntitlementExpiry({ access_type: 'full', duration_type: 'time_limited', duration_days: 30 })
    expect(dated).not.toBeNull()
  })
})

describe('validateGift', () => {
  it('refuses a course gift with no courses on it', () => {
    expect(validateGift({ access_type: 'courses' })).toMatch(/granted_courses/)
    expect(validateGift({ access_type: 'full' })).toBeNull()
    expect(validateGift({ access_type: 'nonsense' as any })).toMatch(/access_type/)
  })
})
