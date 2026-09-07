/**
 * useCheckout — the single Premium-subscription checkout trigger.
 *
 * Lifted out of the (now-deleted) PremiumView so the in-player paywall is the
 * one place a non-subscriber converts. Three concerns:
 *
 *   1. Choose a plan (PlanPicker) — every upgrade tap that names no plan.
 *   2. If signed out, take the buyer's details and mint their account and
 *      session with no email round-trip, then open Paddle. Verification is
 *      NOT a gate in front of a purchase (Tom, 2026-09-07).
 *   3. If signed in, open the chosen plan's Paddle checkout directly.
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
import { canTakePayment } from '@/platform/paymentRoute'
import { useAuthModal } from './useAuthModal'
import { resolveSupabase } from './schools/client'

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
const pendingPlan = ref<CheckoutPlan>('premium')
const pendingBillingPeriod = ref<'monthly' | 'annual'>('monthly')
// Drives the global CheckoutOverlay (App.vue). When true the overlay renders its
// safe-area chrome + the inline Paddle host.
const overlayOpen = ref(false)
// Which plan is open, so CheckoutOverlay can show the right title ("SSi Premium"
// vs "SSi Family") without re-deriving it from checkout internals.
const overlayPlan = ref<CheckoutPlan>('premium')
// Drives the global PlanPicker (App.vue) — the plan-selection step that now sits
// in front of Paddle. Every upgrade tap used to jump straight into a hardcoded
// £15 Premium checkout, so SSi Family (live in Paddle since 2026-09-07) was
// unreachable for every customer. The picker is the choice; nothing about the
// checkout below it changed.
const plansOpen = ref(false)
const plansCourseCode = ref<string | null>(null)
// Drives the DETAILS step — the second page of the plan picker, shown to a
// signed-out buyer once they have chosen a plan.
//
// WHY IT REPLACED THE SIGN-IN MODAL (Tom, 2026-09-07, walking the live flow):
// choosing Family used to open the OTP modal, so a person who wanted to pay
// was sent out of the app to a mailbox, told to fetch a six-digit code and
// type it back in BEFORE they were allowed to reach a card field. Verifying
// an email is not a thing a shop asks before it will take your money. Here
// they type the address, confirm it, optionally set a password, and go
// straight to Paddle; /api/auth/buyer-account mints the account and the
// session with no email sent, and marks it needs_verification so the
// existing verify-your-email apparatus picks it up afterwards.
const detailsOpen = ref(false)
const detailsBusy = ref(false)
const detailsError = ref('')
// The one branch that still needs a real sign-in: this address already has an
// account, and minting a session for it unasked would be account takeover.
const detailsExistingAccount = ref(false)

export type CheckoutPlan = 'premium' | 'family'

export interface StartCheckoutOptions {
  /** Course the user was unlocking — carried through Paddle for attribution
   *  and to drop them back into it after the success redirect. Ignored for
   *  the Family plan (checkout stays dumb — FAMILY-PLAN-SPEC.md §2.2). */
  courseCode?: string | null
  /** Which product to open. OMIT IT to show the plan picker — that is the
   *  path every upgrade entry point takes. Name it only when the choice has
   *  already been made (the picker does). */
  plan?: CheckoutPlan
  /** Monthly (default) or annual. Both plans offer both. */
  billingPeriod?: 'monthly' | 'annual'
}

export function useCheckout() {
  // inject() ONLY answers inside setup(). completePendingCheckout is called
  // from an @success event handler (PlayerContainer), where currentInstance is
  // null — so `injected` is the ref(null) default there and every resume died
  // silently on "Sign in again to start checkout". That is the whole of Tom's
  // "verified email with code / then got nothing of family plan": his Family
  // choice WAS remembered, and the code that would have spent it could not
  // find a Supabase client. resolveSupabase falls back to the module-level
  // client App.vue registers at boot, which is the same fix
  // useSharedSubscription already carries for the same reason.
  const injected = inject<Ref<any>>('supabase', ref(null))
  const supabase = () => resolveSupabase(injected)
  const { open: openAuth } = useAuthModal()

  async function openPaddleCheckout(
    courseCode?: string | null,
    plan: CheckoutPlan = 'premium',
    billingPeriod: 'monthly' | 'annual' = 'monthly',
  ): Promise<void> {
    if (isOpeningCheckout.value) return
    const priceId =
      plan === 'family'
        ? (billingPeriod === 'annual' ? paddleConfig.familyAnnualPriceId : paddleConfig.familyMonthlyPriceId)
        // Premium annual (£150/yr) is the same SSi Premium product as the £15/mo
        // price — already in the webhook's PRICE_CATALOG as tier 'premium', and
        // handlePremiumSubscription reads the period off Paddle's payload, so it
        // needs nothing else. The monthly path is byte-for-byte what it was.
        : (billingPeriod === 'annual' ? paddleConfig.teacherAnnualPriceId : paddleConfig.teacherMonthlyPriceId)
    if (!priceId) {
      checkoutError.value = plan === 'family' ? 'Family price not configured yet' : 'Premium price not configured'
      return
    }
    const client = supabase()
    if (!client) {
      checkoutError.value = 'Sign in again to start checkout'
      return
    }
    isOpeningCheckout.value = true
    checkoutError.value = ''
    try {
      const { data: { session } } = await client.auth.getSession()
      const email = session?.user?.email
      const userId = session?.user?.id
      if (!email || !userId) {
        checkoutError.value = 'Sign in again to start checkout'
        return
      }
      const code = plan === 'family' ? null : (courseCode || null) // Family checkout stays dumb (spec §2.2) — no course attribution
      // Show our safe-area overlay FIRST and let Vue paint its host element, so
      // the inline Paddle frame has a mount target.
      overlayPlan.value = plan
      overlayOpen.value = true
      await nextTick()
      const paddle = await getPaddle()
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email },
        customData:
          plan === 'family'
            ? { kind: 'family_plan', supabase_user_id: userId } // no other custom data — membership is managed by /api/family/* afterwards
            : { kind: 'premium', supabase_user_id: userId, ...(code ? { course: code } : {}) },
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
          // WHERE THE PAYER LANDS. Family goes to the surface that lets them
          // actually add their family (FamilyManagementModal, opened by
          // ?family=1) — buying six seats and being dropped on a course list
          // is the second half of what Tom hit. Premium is unchanged.
          successUrl:
            plan === 'family'
              ? `${window.location.origin}/?family=1&just_subscribed=1`
              : code
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
   * Start the subscription flow. THE CHOICE STEP LIVES HERE, not in the
   * callers: a caller that names no plan gets the picker, so every upgrade
   * entry point — today's three and any added tomorrow — inherits it and none
   * can silently reopen the old hardcoded-Premium path. Only a caller that
   * names a plan explicitly (the picker itself) goes straight to Paddle.
   *
   * Signed-out users get the auth modal after choosing (then auto-continue into
   * Paddle via completePendingCheckout on success).
   */
  async function startCheckout(opts: StartCheckoutOptions = {}): Promise<void> {
    // Route gate (platform/paymentRoute). Paddle is the WEB rail; a native
    // store shell must never reach it. Every caller also hides its control,
    // but this is the backstop that makes a missed one inert rather than a
    // dead button — and, in a store build, a review failure.
    if (!canTakePayment()) return
    const courseCode = opts.courseCode ?? null
    // No plan named = an upgrade tap = show the plans. This is the line that
    // makes the picker unskippable.
    if (!opts.plan) {
      openPlans(courseCode)
      return
    }
    const plan = opts.plan
    const billingPeriod = opts.billingPeriod ?? 'monthly'
    const isAuthed = await isSignedIn()
    if (!isAuthed) {
      // Remember the choice FIRST — this is the state Tom lost. It is read
      // back by submitBuyerDetails, by signInAndPay, and by
      // completePendingCheckout if they fall through to the code modal.
      pendingAfterAuth.value = true
      pendingCourseCode.value = courseCode
      pendingPlan.value = plan
      pendingBillingPeriod.value = billingPeriod
      detailsError.value = ''
      detailsExistingAccount.value = false
      detailsOpen.value = true
      return
    }
    await openPaddleCheckout(courseCode, plan, billingPeriod)
  }

  /**
   * Open the plan picker. startCheckout() calls this itself when no plan was
   * named, so an entry point never has to know the picker exists; it stays
   * exported for a caller that wants the plans without a checkout intent.
   */
  function openPlans(courseCode?: string | null): void {
    if (!canTakePayment()) return
    plansCourseCode.value = courseCode ?? null
    checkoutError.value = ''
    plansOpen.value = true
  }

  function closePlans(): void {
    plansOpen.value = false
  }

  /** Picker → Paddle. Closes the picker, then opens the chosen checkout. The
   *  plan is named here, so startCheckout does not bounce back to the picker. */
  async function choosePlan(plan: CheckoutPlan, billingPeriod: 'monthly' | 'annual'): Promise<void> {
    const courseCode = plansCourseCode.value
    plansOpen.value = false
    await startCheckout({ courseCode, plan, billingPeriod })
  }

  /**
   * The details step's submit. Creates the buyer's account and session with
   * NO email round-trip, then opens Paddle on the plan they already chose.
   *
   * Three outcomes, all of which leave the plan choice intact:
   *   ok               → session set, Paddle opens
   *   already_registered → we refuse to mint (takeover), and offer sign-in
   *   anything else    → an error on this step; the plan is still pending
   */
  async function submitBuyerDetails(input: {
    email: string
    password?: string
  }): Promise<void> {
    const client = supabase()
    if (!client) {
      detailsError.value = 'We could not reach the account service. Please try again.'
      return
    }
    detailsBusy.value = true
    detailsError.value = ''
    detailsExistingAccount.value = false
    try {
      const res = await fetch('/api/auth/buyer-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.password || undefined }),
      })
      const body = await res.json().catch(() => ({} as any))
      if (!res.ok || !body?.success) {
        if (body?.reason === 'already_registered') {
          detailsExistingAccount.value = true
          detailsError.value = body?.error || 'You already have an account with this email.'
          return
        }
        detailsError.value = body?.error || 'We could not set up your account. Please try again.'
        return
      }
      const { error: sessionError } = await client.auth.setSession({
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
      })
      if (sessionError) {
        detailsError.value = 'We could not sign you in. Please try again.'
        return
      }
      detailsOpen.value = false
      await openPaddleCheckout(pendingCourseCode.value, pendingPlan.value, pendingBillingPeriod.value)
    } catch (err: any) {
      detailsError.value = err?.message || 'We could not set up your account. Please try again.'
    } finally {
      detailsBusy.value = false
    }
  }

  /**
   * The already-registered branch: sign in with the password they typed, then
   * carry straight on into Paddle. No email, no code — they proved the account
   * is theirs with a credential they already hold.
   */
  async function signInAndPay(input: { email: string; password: string }): Promise<void> {
    const client = supabase()
    if (!client) {
      detailsError.value = 'We could not reach the account service. Please try again.'
      return
    }
    detailsBusy.value = true
    detailsError.value = ''
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      })
      if (signInError) {
        detailsError.value = 'That password did not work. Try again, or ask us to email you a code.'
        return
      }
      detailsOpen.value = false
      await openPaddleCheckout(pendingCourseCode.value, pendingPlan.value, pendingBillingPeriod.value)
    } catch (err: any) {
      detailsError.value = err?.message || 'We could not sign you in. Please try again.'
    } finally {
      detailsBusy.value = false
    }
  }

  /**
   * Last resort for an existing account whose password they don't have: hand
   * over to the OTP modal. pendingAfterAuth is already set, so the resume
   * carries the SAME plan into Paddle the moment they are in.
   */
  function emailMeACodeInstead(): void {
    detailsOpen.value = false
    detailsError.value = ''
    openAuth()
  }

  function closeDetails(): void {
    detailsOpen.value = false
    detailsBusy.value = false
    detailsError.value = ''
    detailsExistingAccount.value = false
    pendingAfterAuth.value = false
  }

  async function isSignedIn(): Promise<boolean> {
    const client = supabase()
    if (!client) return false
    try {
      const { data: { session } } = await client.auth.getSession()
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
    if (!canTakePayment()) { pendingAfterAuth.value = false; return }
    if (!pendingAfterAuth.value) return
    pendingAfterAuth.value = false
    const code = pendingCourseCode.value
    const plan = pendingPlan.value
    const billingPeriod = pendingBillingPeriod.value
    pendingCourseCode.value = null
    pendingPlan.value = 'premium'
    pendingBillingPeriod.value = 'monthly'
    await openPaddleCheckout(code, plan, billingPeriod)
  }

  return {
    isOpeningCheckout,
    checkoutError,
    overlayOpen,
    overlayPlan,
    plansOpen,
    openPlans,
    closePlans,
    choosePlan,
    detailsOpen,
    detailsBusy,
    detailsError,
    detailsExistingAccount,
    pendingPlan,
    pendingBillingPeriod,
    submitBuyerDetails,
    signInAndPay,
    emailMeACodeInstead,
    closeDetails,
    startCheckout,
    completePendingCheckout,
    closeCheckout,
  }
}
