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
}

export function useSchoolCheckout() {
  const supabase = inject<Ref<any>>('supabase', ref(null))

  async function startSchoolCheckout(opts: StartSchoolCheckoutOptions): Promise<void> {
    if (isOpeningCheckout.value) return
    const priceId = paddleConfig.schoolTeacherMonthlyPriceId
    if (!priceId) {
      checkoutError.value = 'School platform price not configured'
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
        },
        settings: {
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
