/**
 * useSchoolCheckout — the school PLATFORM subscription trigger (lever-3).
 *
 * The school pays £15/TEACHER/mo for the dashboard. There is ONE per-seat
 * Paddle price (`schoolTeacherMonthlyPriceId`); the number of teacher seats is
 * the checkout QUANTITY, not a separate per-tier product. Paddle multiplies
 * (6 seats × £15 = one £90/mo subscription) and the webhook
 * (`handleSchoolPlatformSubscription`, kind:'school_platform') reads
 * `items[0].quantity` back into `schools.teacher_seats`.
 *
 * ⚠️ Scope: this opens the INITIAL subscription only. Changing the seat count on
 * an EXISTING subscription is NOT a fresh checkout — a second checkout creates a
 * second subscription and double-bills the school. That is a server-side
 * `PATCH /subscriptions/{id}` (quantity + proration) and lives elsewhere.
 *
 * Mirrors `useCheckout` (the consumer £15 trigger): money values come from the
 * webhook payload, never the client; we only open Paddle's overlay here.
 */

import { ref, inject, type Ref } from 'vue'
import { getPaddle, paddleConfig } from '@/lib/paddle'

const isOpeningCheckout = ref(false)
const checkoutError = ref('')

export interface StartSchoolCheckoutOptions {
  /** The school being subscribed — carried through Paddle so the webhook can set
   *  the platform columns on the right row (customData.school_id). Required. */
  schoolId: string
  /** Paid teacher seats = Paddle quantity. Clamped to >= 1. */
  seats: number
  /** Billing period. 'monthly' (default) uses the per-seat monthly price;
   *  'annual' uses the per-seat annual price (falls back to the tutor annual
   *  price — see paddleConfig.schoolTeacherAnnualPriceId). */
  billing?: 'monthly' | 'annual'
  /** When set, render Paddle's INLINE checkout into this class name (a sized,
   *  non-scrolly container on UpgradeView) instead of the default overlay. The
   *  target element must already exist in the DOM. On success Paddle redirects
   *  the parent window to the successUrl, exactly as the overlay does. */
  frameTarget?: string
}

export function useSchoolCheckout() {
  const supabase = inject<Ref<any>>('supabase', ref(null))

  async function startSchoolCheckout(opts: StartSchoolCheckoutOptions): Promise<void> {
    if (isOpeningCheckout.value) return
    const billing = opts.billing === 'annual' ? 'annual' : 'monthly'
    const priceId =
      billing === 'annual'
        ? paddleConfig.schoolTeacherAnnualPriceId
        : paddleConfig.schoolTeacherMonthlyPriceId
    if (!priceId) {
      checkoutError.value =
        billing === 'annual'
          ? 'Annual plan not configured — choose monthly'
          : 'School platform price not configured'
      return
    }
    if (!opts.schoolId) {
      checkoutError.value = 'No school to subscribe'
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
          kind: 'school_platform',
          school_id: opts.schoolId,
          supabase_user_id: userId,
          billing,
        },
        settings: {
          // INLINE = render into UpgradeView's sized container (no cramped,
          // scrolly overlay). Falls back to the overlay when no frameTarget is
          // given. Either way, on success Paddle redirects the parent window to
          // successUrl, so success handling is identical.
          ...(opts.frameTarget
            ? {
                displayMode: 'inline' as const,
                frameTarget: opts.frameTarget,
                frameInitialHeight: 450,
                frameStyle:
                  'width:100%; min-width:312px; background-color:transparent; border:none;',
              }
            : {}),
          // Drop the admin back on the billing tab; App boot re-reads
          // /api/school/subscription with the now-active platform status.
          successUrl: `${window.location.origin}/schools/settings?just_subscribed=1`,
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
    startSchoolCheckout,
  }
}
