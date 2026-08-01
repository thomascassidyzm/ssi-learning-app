/**
 * useOrgCheckout — the org/workplace PLATFORM subscription trigger, sibling
 * of useSchoolCheckout (lever-3, extended 2026-08-01 for the group-leader
 * lane, api/_utils/orgPlatform.ts).
 *
 * An org prices exactly like a school: £15/LEARNER seat/mo (per-seat Paddle
 * price, quantity = seats), or £150/seat/yr. The webhook
 * (handleOrgPlatformSubscription, kind:'org_platform') reads
 * `items[0].quantity` back into `groups.seats` and resolves the org by
 * customData.group_id.
 *
 * ⚠️ Scope: this opens the INITIAL subscription only. Changing seats on an
 * EXISTING subscription is a server-side PATCH (POST /api/org/update-seats,
 * no second checkout) — a second checkout would double-bill the org.
 */

import { ref, inject, type Ref } from 'vue'
import { getPaddle, paddleConfig } from '@/lib/paddle'

const isOpeningCheckout = ref(false)
const checkoutError = ref('')

export interface StartOrgCheckoutOptions {
  /** The org being subscribed — the group_id the caller leads (server also
   *  re-derives this from the caller's own govt_admins row on write paths;
   *  it's carried through Paddle so the webhook can set the platform
   *  columns on the right groups row). Required. */
  groupId: string
  /** Paid learner seats = Paddle quantity. Clamped to >= 1. */
  seats: number
  /** Billing period. 'monthly' (default) uses the per-seat monthly price;
   *  'annual' uses the per-seat annual price. */
  billing?: 'monthly' | 'annual'
  /** When set, render Paddle's INLINE checkout into this class name (a sized,
   *  non-scrolly container on UpgradeView) instead of the default overlay. */
  frameTarget?: string
}

export function useOrgCheckout() {
  const supabase = inject<Ref<any>>('supabase', ref(null))

  async function startOrgCheckout(opts: StartOrgCheckoutOptions): Promise<void> {
    if (isOpeningCheckout.value) return
    const billing = opts.billing === 'annual' ? 'annual' : 'monthly'
    const priceId =
      billing === 'annual' ? paddleConfig.orgSeatAnnualPriceId : paddleConfig.orgSeatMonthlyPriceId
    if (!priceId) {
      checkoutError.value =
        billing === 'annual'
          ? 'Annual plan not configured — choose monthly'
          : 'Organisation plan price not configured'
      return
    }
    if (!opts.groupId) {
      checkoutError.value = 'No organisation to subscribe'
      return
    }
    if (!supabase.value) {
      checkoutError.value = 'Sign in again to start checkout'
      return
    }

    const seats = Math.max(1, Math.floor(Number(opts.seats) || 1))

    isOpeningCheckout.value = true
    checkoutError.value = ''
    try {
      const { data: { session } } = await supabase.value.auth.getSession()
      const email = session?.user?.email
      const userId = session?.user?.id
      if (!email || !userId) {
        checkoutError.value = 'Sign in again to start checkout'
        return
      }

      const paddle = await getPaddle()
      paddle.Checkout.open({
        items: [{ priceId, quantity: seats }],
        customer: { email },
        customData: {
          kind: 'org_platform',
          group_id: opts.groupId,
          supabase_user_id: userId,
          billing,
        },
        settings: {
          ...(opts.frameTarget
            ? {
                displayMode: 'inline' as const,
                frameTarget: opts.frameTarget,
                frameInitialHeight: 450,
                frameStyle:
                  'width:100%; min-width:312px; background-color:transparent; border:none;',
              }
            : {}),
          successUrl: `${window.location.origin}/org/${opts.groupId}?just_subscribed=1`,
        },
      })
    } catch (err: any) {
      checkoutError.value = err?.message || 'Failed to open checkout'
    } finally {
      isOpeningCheckout.value = false
    }
  }

  return {
    isOpeningCheckout,
    checkoutError,
    startOrgCheckout,
  }
}
