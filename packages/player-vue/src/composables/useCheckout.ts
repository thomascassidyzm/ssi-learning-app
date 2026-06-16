/**
 * useCheckout — the single Premium-subscription checkout trigger.
 *
 * Lifted out of the (now-deleted) PremiumView so the in-player paywall is the
 * one place a non-subscriber converts. Two concerns:
 *
 *   1. If signed out, open the auth modal and chain into Paddle on success.
 *   2. If signed in, open Paddle's £15/mo Premium checkout directly.
 *
 * The money-capture backend (Paddle webhooks, subscription rows) is untouched —
 * this only opens the existing `getPaddle().Checkout.open` overlay. After the
 * Paddle success redirect lands back on `/?course=…` (or `/?openCourses=1`),
 * App boot re-resolves with the now-active subscription and the gate passes.
 */

import { ref, inject, type Ref } from 'vue'
import { getPaddle, paddleConfig } from '@/lib/paddle'
import { useAuthModal } from './useAuthModal'

// Module-level so the auth-success handler (wired once, app-wide) can complete a
// checkout that began before sign-in, regardless of which component triggered it.
const isOpeningCheckout = ref(false)
const checkoutError = ref('')
const pendingCourseCode = ref<string | null>(null)
const pendingAfterAuth = ref(false)

export interface StartCheckoutOptions {
  /** Course the user was unlocking — carried through Paddle for attribution
   *  and to drop them back into it after the success redirect. */
  courseCode?: string | null
}

export function useCheckout() {
  const supabase = inject<Ref<any>>('supabase', ref(null))
  const { open: openAuth } = useAuthModal()

  async function openPaddleCheckout(courseCode?: string | null): Promise<void> {
    if (isOpeningCheckout.value) return
    const priceId = paddleConfig.teacherMonthlyPriceId // single Premium product
    if (!priceId) {
      checkoutError.value = 'Premium price not configured'
      return
    }
    if (!supabase.value) {
      checkoutError.value = 'Sign in again to start checkout'
      return
    }
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
      const code = courseCode || null
      const paddle = await getPaddle()
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email },
        customData: {
          kind: 'premium',
          supabase_user_id: userId,
          ...(code ? { course: code } : {}),
        },
        settings: {
          // Carry the course through the Paddle redirect so the app drops the
          // learner straight back into it once the subscription is active.
          successUrl: code
            ? `${window.location.origin}/?course=${encodeURIComponent(code)}&just_subscribed=1`
            : `${window.location.origin}/?openCourses=1&just_subscribed=1`,
        },
      })
    } catch (err: any) {
      checkoutError.value = err?.message || 'Failed to open checkout'
    } finally {
      isOpeningCheckout.value = false
    }
  }

  /**
   * Start the subscription flow. Signed-out users get the auth modal first
   * (then auto-continue into Paddle via completePendingCheckout on success);
   * signed-in users go straight to Paddle.
   */
  async function startCheckout(opts: StartCheckoutOptions = {}): Promise<void> {
    const courseCode = opts.courseCode ?? null
    const isAuthed = await isSignedIn()
    if (!isAuthed) {
      pendingAfterAuth.value = true
      pendingCourseCode.value = courseCode
      openAuth()
      return
    }
    await openPaddleCheckout(courseCode)
  }

  async function isSignedIn(): Promise<boolean> {
    if (!supabase.value) return false
    try {
      const { data: { session } } = await supabase.value.auth.getSession()
      return !!session?.user?.id
    } catch {
      return false
    }
  }

  /**
   * Called by the app-wide auth-success handler. If a checkout was waiting on
   * sign-in, continue it into Paddle now.
   */
  async function completePendingCheckout(): Promise<void> {
    if (!pendingAfterAuth.value) return
    pendingAfterAuth.value = false
    const code = pendingCourseCode.value
    pendingCourseCode.value = null
    await openPaddleCheckout(code)
  }

  return {
    isOpeningCheckout,
    checkoutError,
    startCheckout,
    completePendingCheckout,
  }
}
