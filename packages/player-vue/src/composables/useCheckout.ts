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
 * this only opens the existing `getPaddle().Checkout` flow. After the Paddle
 * success redirect lands back on `/?course=…` (or `/?openCourses=1`), App boot
 * re-resolves with the now-active subscription and the gate passes.
 *
 * CHECKOUT HOSTING — app-controlled, safe-area-aware overlay.
 * The consumer paywall previously used Paddle's OWN overlay (`displayMode`
 * defaults to 'overlay'). On iOS PWA (standalone) Paddle's close "X" rendered
 * UNDER the iOS safe-area inset, so the user could get trapped mid-paywall with
 * no way to close it. We now render Paddle's INLINE checkout into our own
 * full-screen `CheckoutOverlay.vue` (Teleported to body, mounted once in
 * App.vue), which owns safe-area padding and a GUARANTEED close (button +
 * Escape + backdrop) independent of Paddle's chrome. Inline still honours the
 * successUrl redirect, so success handling is unchanged.
 *
 * State here is module-level so the single global overlay reflects checkout no
 * matter which component triggered it, and the app-wide auth-success handler can
 * resume a checkout that began before sign-in.
 */

import { ref, inject, nextTick, type Ref } from 'vue'
import { getPaddle, paddleConfig } from '@/lib/paddle'
import { useAuthModal } from './useAuthModal'

// The class name the inline Paddle frame mounts into. The CheckoutOverlay host
// element MUST carry this exact class (Paddle frameTarget is a class name).
export const CHECKOUT_FRAME_TARGET = 'consumer-checkout-frame'

// Module-level so the auth-success handler (wired once, app-wide) can complete a
// checkout that began before sign-in, and the single global overlay can reflect
// state regardless of which component triggered the checkout.
const isOpeningCheckout = ref(false)
const checkoutError = ref('')
const pendingCourseCode = ref<string | null>(null)
const pendingAfterAuth = ref(false)
// Drives the global CheckoutOverlay (App.vue). When true the overlay renders its
// safe-area chrome + the inline Paddle host.
const overlayOpen = ref(false)

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
      // Show our safe-area overlay FIRST and let Vue paint its host element, so
      // the inline Paddle frame has a mount target.
      overlayOpen.value = true
      await nextTick()
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
          // INLINE into our overlay's host (not Paddle's own overlay, whose
          // close X can land under the iOS safe-area in a standalone PWA).
          // Inline still redirects the parent window to successUrl on success.
          displayMode: 'inline',
          frameTarget: CHECKOUT_FRAME_TARGET,
          frameInitialHeight: 450,
          frameStyle: 'width:100%; min-width:286px; background-color:transparent; border:none;',
          // Carry the course through the Paddle redirect so the app drops the
          // learner straight back into it once the subscription is active.
          successUrl: code
            ? `${window.location.origin}/?course=${encodeURIComponent(code)}&just_subscribed=1`
            : `${window.location.origin}/?openCourses=1&just_subscribed=1`,
        },
      })
    } catch (err: any) {
      checkoutError.value = err?.message || 'Failed to open checkout'
      // Don't strand the user behind a half-open overlay if Paddle threw.
      closeCheckout()
    } finally {
      isOpeningCheckout.value = false
    }
  }

  /**
   * Guaranteed exit. Closes Paddle (guarded — it may be mid-load or not yet
   * initialised) AND tears down our overlay + resets state, so the user can
   * always escape even if Paddle never finished loading.
   */
  function closeCheckout(): void {
    overlayOpen.value = false
    checkoutError.value = ''
    // Best-effort: ask Paddle to close its inline frame. Never let a Paddle
    // error keep the overlay open.
    void (async () => {
      try {
        const paddle = await getPaddle()
        paddle.Checkout.close()
      } catch {
        // Paddle not loaded / already closed — overlay is already gone.
      }
    })()
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
    overlayOpen,
    startCheckout,
    completePendingCheckout,
    closeCheckout,
  }
}
