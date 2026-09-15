import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ db: null as any, auth: { valid: true, userId: 'auth' }, access: { canAccess: false } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => state.db }))
vi.mock('../_utils/auth', () => ({ verifyAuthToken: async () => state.auth }))
vi.mock('../_utils/courseAccess', () => ({ resolveServerCourseAccess: async () => state.access }))
import { createPlayRtdn } from './play-rtdn'
import { createPlayVerify } from './play-verify'
const owner = '11111111-1111-4111-8111-111111111111'
const caller = '22222222-2222-4222-8222-222222222222'
let existing: any
let rpc: any
let publisher: any
function response() {
  return { statusCode: 0, body: null as any, status(n: number) { this.statusCode = n; return this },
    json(body: any) { this.body = body; return this } } as any
}
function notification(type = 2, pkg = 'com.ssi.test') {
  return { method: 'POST', headers: { authorization: 'Bearer valid' }, body: { message: {
    messageId: 'message-1', data: Buffer.from(JSON.stringify({ packageName: pkg, eventTimeMillis: '1789470000000',
      subscriptionNotification: { notificationType: type, purchaseToken: 'token' } })).toString('base64'),
  } } } as any
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
  vi.stubEnv('GOOGLE_PLAY_PACKAGE_NAME', 'com.ssi.test')
  vi.stubEnv('GOOGLE_PLAY_SUBSCRIPTION_IDS', 'premium_monthly')
  existing = null
  state.auth = { valid: true, userId: 'auth' }
  state.access = { canAccess: false }
  rpc = vi.fn(async () => ({ data: owner, error: null }))
  state.db = { rpc, from(table: string) {
    const q: any = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: existing, error: null }),
      single: async () => ({ data: table === 'learners' ? { id: caller } : { course_code: 'welsh', pricing_tier: 'premium' }, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    }; return q
  } }
  publisher = { get: vi.fn(async () => ({ startTime: '2026-01-01T00:00:00Z', subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING', externalAccountIdentifiers: { obfuscatedExternalAccountId: owner },
    lineItems: [{ productId: 'premium_monthly', expiryTime: '2027-01-01T00:00:00Z' }],
  })), acknowledge: vi.fn(async () => {}) }
})
it('re-fetches the receipt, acknowledges it and writes one grant with a dedup key', async () => {
  const res = response()
  await createPlayRtdn(publisher, async () => true)(notification(), res)
  expect(res.statusCode).toBe(200)
  expect(publisher.get).toHaveBeenCalledWith('com.ssi.test', 'token')
  expect(publisher.acknowledge).toHaveBeenCalledWith('com.ssi.test', 'premium_monthly', 'token')
  expect(rpc).toHaveBeenCalledWith('apply_play_grant', expect.objectContaining({ p_learner_id: owner, p_token: 'token',
    p_event_id: 'message-1', p_expires_at: '2027-01-01T00:00:00.000Z', p_revoked_at: null }))
})
it.each([['authentication', false, 'com.ssi.test', 401], ['package', true, 'wrong', 400]])('rejects wrong %s before lookup', async (_, valid, pkg, status) => {
  const res = response()
  await createPlayRtdn(publisher, async () => Boolean(valid))(notification(2, String(pkg)), res)
  expect(res.statusCode).toBe(status)
  expect(publisher.get).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalled()
})
it('never writes an unverified receipt', async () => {
  publisher.get.mockRejectedValue(new Error('Invalid purchase'))
  const res = response()
  await createPlayRtdn(publisher, async () => true)(notification(), res)
  expect(res.statusCode).toBe(503)
  expect(rpc).not.toHaveBeenCalled()
})
it.each([['SUBSCRIPTION_STATE_ON_HOLD', true], ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', false]])('uses fetched expiry and state for %s', async (subscriptionState, revoked) => {
  const purchase = await publisher.get()
  publisher.get.mockResolvedValue({ ...purchase, subscriptionState, lineItems: [{ productId: 'premium_monthly', expiryTime: '2026-11-01T00:00:00Z' }] })
  const res = response()
  await createPlayRtdn(publisher, async () => true)(notification(6), res)
  const row = rpc.mock.calls[0][1]
  expect(row.p_expires_at).toBe('2026-11-01T00:00:00.000Z')
  expect(!!row.p_revoked_at).toBe(revoked)
})
it('revokes an authenticated revoked purchase', async () => {
  const purchase = await publisher.get()
  publisher.get.mockResolvedValue({ ...purchase, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' })
  const res = response()
  await createPlayRtdn(publisher, async () => true)(notification(12), res)
  expect(rpc.mock.calls[0][1].p_revoked_at).toEqual(expect.any(String))
})
it('restores to the existing owner and returns only the calling learner access', async () => {
  existing = { learner_id: owner }
  const res = response()
  await createPlayVerify(publisher)({ method: 'POST', headers: {}, body: { purchaseToken: 'token', courseCode: 'welsh' } } as any, res)
  expect(res.statusCode).toBe(200)
  expect(rpc.mock.calls[0][1].p_learner_id).toBe(owner)
  expect(res.body.access.canAccess).toBe(false)
})
it('does not write or acknowledge when acknowledgement fails', async () => {
  publisher.acknowledge.mockRejectedValue(new Error('Google unavailable'))
  const res = response()
  await createPlayRtdn(publisher, async () => true)(notification(), res)
  expect(res.statusCode).toBe(503)
  expect(rpc).not.toHaveBeenCalled()
})
it('denies an unauthenticated app call', async () => {
  state.auth = { valid: false, userId: '' }
  const res = response()
  await createPlayVerify(publisher)({ method: 'POST', headers: {}, body: { purchaseToken: 'token', courseCode: 'welsh' } } as any, res)
  expect(res.statusCode).toBe(401)
  expect(publisher.get).not.toHaveBeenCalled()
})

it('a delayed revoke cannot override a freshly verified recovery', async () => {
  const res = response()
  await createPlayRtdn(publisher, async () => true)(notification(12), res)
  expect(rpc.mock.calls[0][1].p_revoked_at).toBeNull()
})

it('a cancelled pending purchase creates no grant and needs no acknowledgement', async () => {
  const purchase = await publisher.get()
  publisher.get.mockResolvedValue({ ...purchase, subscriptionState: 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED',
    startTime: undefined, lineItems: [{ productId: 'premium_monthly' }] })
  const res = response()
  await createPlayRtdn(publisher, async () => true)(notification(20), res)
  expect(res.statusCode).toBe(200)
  expect(rpc).not.toHaveBeenCalled()
  expect(publisher.acknowledge).not.toHaveBeenCalled()
})
