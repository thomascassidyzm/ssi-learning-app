// Reinstated from kept test /d/e1d47d72 for the own-ledger identity contract.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

const { checkoutOpen } = vi.hoisted(() => ({ checkoutOpen: vi.fn() }))
vi.mock('@/lib/paddle', () => ({
  paddleConfig: { teacherMonthlyPriceId: 'pri_premium_test', familyMonthlyPriceId: 'pri_family_test' },
  getPaddle: async () => ({ Checkout: { open: checkoutOpen, close: vi.fn() } }),
}))
vi.mock('@/platform/paymentRoute', () => ({ canTakePayment: () => true, paddleBillingAvailable: () => true }))
vi.mock('@/composables/useAuthModal', () => ({ useAuthModal: () => ({ open: vi.fn() }) }))
vi.mock('./useSubscription', () => ({
  useSharedSubscription: () => ({
    isSubscribed: computed(() => false),
    subscription: computed(() => null),
    refresh: async () => {},
  }),
}))

import { useCheckout } from './useCheckout'
import { setSchoolsClient } from './schools/client'

const authId = '11111111-1111-4111-8111-111111111111'
const learnerId = '22222222-2222-4222-8222-222222222222'

describe('Paddle checkout → grants ledger learner identity', () => {
  beforeEach(() => {
    checkoutOpen.mockClear()
    const checkout = useCheckout()
    checkout.closeCheckout()
    checkout.closePlans()
    checkout.closeDetails()
  })

  it.each([
    { name: 'production checkout', mapMetadata: false, plan: 'premium' as const },
    { name: 'family checkout', mapMetadata: false, plan: 'family' as const },
    { name: 'explicit mapping positive control', mapMetadata: true, plan: 'premium' as const },
  ])('$name exposes the webhook learner ID to metadata detection', async ({ mapMetadata, plan }) => {
    const learnerLookup = vi.fn()
    const subscriptionWrite = vi.fn()
    // Model a real distinction: learners.user_id is the auth ID, learners.id
    // is the entitlement owner. Exercise the real webhook's resolution/write.
    const client: any = {
      auth: { getSession: async () => ({
        data: { session: { user: { id: authId, email: 'payer@example.test' } } },
      }) },
      from(table: string) {
        if (table === 'learners') {
          return { select: () => ({ eq: (column: string, value: string) => {
            learnerLookup(column, value)
            return { single: async () => ({
              data: column === 'user_id' && value === authId ? { id: learnerId } : null,
              error: null,
            }) }
          } }) }
        }
        if (table === 'subscriptions') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
            upsert: (row: unknown) => {
              subscriptionWrite(row)
              return { select: () => ({ single: async () => ({ data: { id: 'subscription-test' }, error: null }) }) }
            },
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    setSchoolsClient(client)
    await useCheckout().startCheckout({ plan, billingPeriod: 'monthly' })
    expect(checkoutOpen).toHaveBeenCalledTimes(1)
    const metadata = { ...checkoutOpen.mock.calls[0][0].customData }
    expect(metadata.supabase_user_id).toBe(authId)

    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
    try {
      const { handlePremiumSubscription, handleFamilySubscription } = await import('../../../../api/teacher/paddle-webhook')
      await (plan === 'family' ? handleFamilySubscription : handlePremiumSubscription)(client, {
        id: 'sub_test', status: 'active', items: [{ price: { id: 'pri_premium_test' } }],
      }, metadata)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(learnerLookup).toHaveBeenCalledWith('user_id', authId)
    expect(subscriptionWrite).toHaveBeenCalledTimes(1)
    expect(subscriptionWrite.mock.calls[0][0].learner_id).toBe(learnerId)

    if (mapMetadata) metadata.learner_id = learnerId

    // No assumed dashboard key: without even ONE exact learner-ID value,
    // no metadata-field setting can associate this purchase with that user.
    expect(Object.values(metadata),
      'grants ledger metadata must contain the entitlement owner, not only the auth ID',
    ).toContain(subscriptionWrite.mock.calls[0][0].learner_id)
  })
})

