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
import { useSharedSubscription } from './useSubscription'
import { resolveSupabase } from './schools/client'
import { useAuthModal } from './useAuthModal'
import { sendSignInCode } from '@/auth/sendSignInCode'
import {
  savePendingIntent,
  rememberIntentEmail,
  readPendingIntent,
  clearPendingIntent,
} from '@/checkout/pendingIntent'

// The class name the inline Paddle frame mounts into. The CheckoutOverlay host
// element MUST carry this exact class (Paddle frameTarget is a class name).
export const CHECKOUT_FRAME_TARGET = 'consumer-checkout-frame'

// How long the pre-checkout "are you already subscribed?" fetch may take before
// we fall back to whatever we already knew. Short: it sits in front of a tap.
const SUBSCRIPTION_CHECK_TIMEOUT_MS = 5000

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
// Drives the ACCOUNT step — the second page of the plan picker, shown to a
// signed-out buyer once they have chosen a plan.
//
// VERIFY, THEN PAY (Tom, 2026-09-07, ruling on his own earlier decision).
// For a few hours this step created the account outright from a typed address
// and an optional password, and went straight to the card field. That was a
// confirmed account takeover — anyone could type a stranger's address, plant a
// password, and hold a session for it (job #345). Tom's ruling replaces it
// rather than patching it:
//
//   "if they click upgrade and they haven't already got an account, once they
//    then verify their account by emailed code, it should take them straight
//    back to the payment page they previously clicked on. AND, when they click
//    upgrade they should be TOLD, please create an account first so we can be
//    sure you're a real person, or so we can make sure your payment links to
//    your verified account"
//
// So: address → emailed code → verified → the SAME plan opens in Paddle. The
// takeover has nowhere to live, because no account is ever created from an
// unverified address with a caller-supplied password, and no session is handed
// out until somebody has proved they read the mail.
//
// THE BALL-ACHE HE WAS AVOIDING WAS LOSING YOUR PLACE, not the verification —
// so the chosen plan is written to storage before the round-trip starts, and
// comes back with them. See src/checkout/pendingIntent.ts.
const detailsOpen = ref(false)
const detailsBusy = ref(false)
const detailsError = ref('')
// Which half of the account step is showing: type your address, or type the
// code we just sent. One overlay, two faces.
const detailsStep = ref<'email' | 'code'>('email')
// The address the code went to. Shown back on the code step, and used to
// verify. Restored from storage on a reload so the round-trip survives one.
const detailsEmail = ref('')
// Drives the ALREADY-SUBSCRIBED step of the plan picker overlay.
//
// WHY IT EXISTS (#255, 2026-09-07): nothing stopped a learner who was ALREADY
// paying for Premium from tapping Family and opening a SECOND, independent
// Paddle subscription. They would then be charged £15 + £25 a month, hold two
// live subscriptions, and get no Family plan at all — because the webhook's
// wouldStealLiveSubscriptionRow() correctly refuses to overwrite a live
// subscription row under a different provider_subscription_id, logs
// "REFUSED subscription-row write" and stops. Money in, nothing out.
// The block is the fix; this ref is the honest thing we say in its place.
//
// IT IS NO LONGER THE WHOLE ANSWER (2026-09-07). Premium → Family is a genuine
// upgrade, and it now runs as a Paddle PLAN CHANGE on the existing subscription
// (api/subscription/change-plan) rather than as a second checkout. The notice
// still catches every other case the guard was protecting — a second Premium, a
// second Family, a resumed checkout by somebody already paying.
const alreadySubscribedOpen = ref(false)

// The Premium → Family upgrade, in flight. Module-level for the same reason as
// everything above: whichever door started it, the app shows one truth.
const familyUpgradeBusy = ref(false)
const familyUpgradeError = ref('')
const familyUpgradeDone = ref(false)

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

  /**
   * Is this person ALREADY paying? The one question that must be answered
   * before any door opens a checkout.
   *
   * Always re-fetches rather than trusting the 5-minute cache, because the
   * cache is wrong in both directions that matter: a stale `true` would block a
   * genuine new purchase (lost sale), and a stale `false` would let the
   * double-buy through (the whole defect). The fetch is bounded so a dead
   * network cannot hang the buy button.
   *
   * FAILS OPEN, deliberately. If the API never answers, `subscription` keeps
   * whatever value it already had — so a known subscriber is still blocked and
   * an unknown person can still buy. We refuse a sale only on a positive
   * "you are subscribed", never on ignorance.
   */
  async function hasLiveSubscription(): Promise<boolean> {
    const sub = useSharedSubscription()
    try {
      await Promise.race([
        sub.refresh(),
        new Promise<void>((resolve) => setTimeout(resolve, SUBSCRIPTION_CHECK_TIMEOUT_MS)),
      ])
    } catch {
      // refresh() swallows its own errors; this is belt and braces.
    }
    return sub.isSubscribed.value
  }

  /**
   * What should this tap actually do? One authoritative read of "are you
   * already paying?", three answers:
   *
   *   buy      — not subscribed. Open Paddle, as always.
   *   upgrade  — on Premium, asking for Family. A PLAN CHANGE on the
   *              subscription they already hold, not a second one.
   *   blocked  — anything else a subscriber could tap. The notice, as before.
   *
   * The guard it replaces (#255) is intact: 'blocked' still catches a second
   * Premium, a second Family, and a checkout resumed by somebody who turns out
   * to be paying already. Only the one case that has a correct answer now gets
   * that answer instead of a dead end.
   */
  async function routeForPlan(plan?: CheckoutPlan): Promise<'buy' | 'upgrade' | 'blocked'> {
    if (!(await hasLiveSubscription())) return 'buy'
    if (plan === 'family' && canUpgradeToFamily()) return 'upgrade'
    plansOpen.value = false
    detailsOpen.value = false
    pendingAfterAuth.value = false
    alreadySubscribedOpen.value = true
    return 'blocked'
  }

  function closeAlreadySubscribed(): void {
    alreadySubscribedOpen.value = false
  }

  /**
   * Is this person on plain Premium, and therefore able to MOVE to Family
   * rather than buy it again? Read off the subscription's own plan name.
   *
   * Deliberately narrow. A family member's row is virtual ('SSi Family
   * (member)' — api/subscription/index.ts), an owner is already there, and the
   * tutor bundle is a different product with a dashboard grant hanging off it.
   * The server refuses all three too; this only keeps the door from appearing.
   */
  function canUpgradeToFamily(): boolean {
    const sub = useSharedSubscription()
    return sub.isSubscribed.value && sub.subscription.value?.planName === 'SSi Premium'
  }

  /**
   * THE UPGRADE. One POST; Paddle changes the price on the subscription they
   * already have, prorates the difference and keeps their billing anniversary.
   * No checkout, no second subscription, no gap in access.
   *
   * The price id lives on the server. All we send is monthly or annual, and
   * even that is optional — the endpoint matches whatever period they are on.
   */
  async function upgradeToFamily(billingPeriod?: 'monthly' | 'annual'): Promise<boolean> {
    if (familyUpgradeBusy.value) return false
    const client = supabase()
    if (!client) {
      familyUpgradeError.value = 'Sign in again to change your plan'
      return false
    }
    familyUpgradeBusy.value = true
    familyUpgradeError.value = ''
    familyUpgradeDone.value = false
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) {
        familyUpgradeError.value = 'Sign in again to change your plan'
        return false
      }
      const response = await fetch('/api/subscription/change-plan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'family', ...(billingPeriod ? { billingPeriod } : {}) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        familyUpgradeError.value = data?.error || 'Could not change your plan'
        return false
      }
      familyUpgradeDone.value = true
      // Re-read so the app reflects SSi Family at once — the endpoint has
      // already mirrored plan_name, and the webhook converges behind us.
      await useSharedSubscription().refresh()
      return true
    } catch (err: any) {
      familyUpgradeError.value = err?.message || 'Could not change your plan'
      return false
    } finally {
      familyUpgradeBusy.value = false
    }
  }

  function clearFamilyUpgrade(): void {
    familyUpgradeError.value = ''
    familyUpgradeDone.value = false
  }

  /** The manage-subscription route, offered from the notice so the block is
   *  never a dead end. Same hosted portal Settings uses. */
  async function openSubscriptionPortal(): Promise<void> {
    await useSharedSubscription().openPortal()
  }

  async function openPaddleCheckout(
    courseCode?: string | null,
    plan: CheckoutPlan = 'premium',
    billingPeriod: 'monthly' | 'annual' = 'monthly',
  ): Promise<void> {
    if (isOpeningCheckout.value) return
    // THE BACKSTOP. Every route to Paddle passes through here — the picker, the
    // buyer-details step, the 409 already_registered sign-in, and the OTP
    // resume (completePendingCheckout). Guarding the funnel is what makes the
    // 409 re-entry path safe rather than a second door onto the same trap.
    const route = await routeForPlan(plan)
    if (route === 'blocked') return
    if (route === 'upgrade') {
      // Premium → Family never reaches Paddle's checkout: it is a change to
      // the subscription they already have.
      await upgradeToFamily(billingPeriod)
      return
    }
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
    // THE FRONT DOOR. Checked before the picker opens, so an existing
    // subscriber never sees a price they cannot buy — in-player paywall,
    // belt-map lock, course picker and Settings all enter here. A Premium
    // subscriber who names Family goes to the plan change instead.
    const front = await routeForPlan(opts.plan)
    if (front === 'blocked') return
    if (front === 'upgrade') {
      await upgradeToFamily(opts.billingPeriod)
      return
    }
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
      // back by verifyBuyerCode in this tab, and by completePendingCheckout
      // for somebody who came back after the app was torn down.
      pendingAfterAuth.value = true
      pendingCourseCode.value = courseCode
      pendingPlan.value = plan
      pendingBillingPeriod.value = billingPeriod
      // WRITTEN DOWN BEFORE ANYTHING CAN GO WRONG. The refs above are memory
      // and memory does not survive going to read an email on a phone; this
      // does. It is the whole of "take them straight back to the payment page
      // they previously clicked on".
      savePendingIntent({ plan, billingPeriod, courseCode, email: null })
      detailsError.value = ''
      detailsStep.value = 'email'
      detailsEmail.value = ''
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
    // Sync, so it uses only what is already known — the authoritative check
    // lives in startCheckout and openPaddleCheckout, which every price button
    // goes through. This just stops a subscriber being shown the prices at all
    // when we already know the answer.
    if (useSharedSubscription().isSubscribed.value) {
      alreadySubscribedOpen.value = true
      return
    }
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
   * Step one of the account step: send them a six-digit code.
   *
   * IT ANSWERS THE SAME WAY WHETHER OR NOT THE ADDRESS ALREADY HAS AN ACCOUNT,
   * and that is not an accident. The old flow replied 409 already_registered so
   * it could offer a password box — which told any unauthenticated caller
   * whether a given address banks with us. Sending a code is the right answer
   * to both cases anyway: a new buyer gets an account, a returning one gets
   * signed in, and neither is told anything about the other. The enumeration
   * oracle is closed by the flow rather than patched around.
   *
   * `sendSignInCode` is the house helper — our own mail through Resend, with a
   * fall back to Supabase's mailer, so an outage degrades to an uglier email
   * rather than a dead purchase.
   */
  async function sendBuyerCode(input: { email: string }): Promise<void> {
    const client = supabase()
    if (!client) {
      detailsError.value = 'We could not reach the account service. Please try again.'
      return
    }
    const address = input.email.trim()
    detailsBusy.value = true
    detailsError.value = ''
    try {
      const result = await sendSignInCode(client, address)
      if (result.error) {
        detailsError.value = result.error.message
        return
      }
      detailsEmail.value = address
      // Survive a reload of the code step itself, not just of the plan choice.
      rememberIntentEmail(address)
      detailsStep.value = 'code'
    } catch (err: any) {
      detailsError.value = err?.message || 'We could not send that code. Please try again.'
    } finally {
      detailsBusy.value = false
    }
  }

  /**
   * Step two: they typed the code. This is the moment the address is PROVED,
   * and the only moment a session exists — so it is also the moment the plan
   * they chose is spent.
   *
   * The account may be brand new (send-code creates one for an address that has
   * none) or long-standing (they are simply signing in). Both land here and
   * both go straight on to the same Paddle checkout, which is what makes the
   * two cases one flow.
   */
  async function verifyBuyerCode(input: { code: string }): Promise<void> {
    const client = supabase()
    if (!client) {
      detailsError.value = 'We could not reach the account service. Please try again.'
      return
    }
    detailsBusy.value = true
    detailsError.value = ''
    try {
      const { error: verifyError } = await client.auth.verifyOtp({
        email: detailsEmail.value,
        token: input.code.trim(),
        type: 'email',
      })
      if (verifyError) {
        detailsError.value = 'That code did not work. Check it and try again, or ask for a new one.'
        return
      }
      detailsOpen.value = false
      // Straight back to the payment page they clicked, on the plan they
      // clicked. completePendingCheckout is not used here because we are
      // already in the tab that made the choice; it is the path for a person
      // who came back after a reload.
      pendingAfterAuth.value = false
      clearPendingIntent()
      await openPaddleCheckout(pendingCourseCode.value, pendingPlan.value, pendingBillingPeriod.value)
    } catch (err: any) {
      detailsError.value = err?.message || 'We could not check that code. Please try again.'
    } finally {
      detailsBusy.value = false
    }
  }

  /** Ask for another code — same address, same plan, no going back a step. */
  async function resendBuyerCode(): Promise<void> {
    if (!detailsEmail.value) return
    await sendBuyerCode({ email: detailsEmail.value })
  }

  /** Back from the code step to the address step, e.g. they mistyped it. */
  function editBuyerEmail(): void {
    detailsStep.value = 'email'
    detailsError.value = ''
  }

  /**
   * "I already have an account." Hands over to the ordinary sign-in modal —
   * password or code, their choice — and the plan comes with them.
   *
   * TOM ASKED FOR THIS EXPLICITLY: somebody who already has a verified account
   * "must not be sent round this loop at all — they sign in and pay". A
   * returning customer meeting a screen headed "Create your account" is exactly
   * the loop.
   *
   * IT LEAKS NOTHING, because THEY choose it. The door is on screen for
   * everybody, in the same words, whether or not the address they have in mind
   * has an account; nothing about the account we hold decides what they see.
   * That is the whole difference between this and the 409 it replaces, which
   * ANSWERED the question for any caller who asked.
   *
   * Deliberately NOT closeDetails(): that spends the intent, and the intent is
   * the thing that has to survive. pendingAfterAuth is already true, so
   * PlayerContainer's success handler resumes into the same Paddle checkout.
   */
  function signInInstead(): void {
    detailsOpen.value = false
    detailsError.value = ''
    detailsStep.value = 'email'
    openAuth()
  }

  function closeDetails(): void {
    detailsOpen.value = false
    detailsBusy.value = false
    detailsError.value = ''
    detailsStep.value = 'email'
    detailsEmail.value = ''
    pendingAfterAuth.value = false
    // They backed out on purpose. Leaving the intent behind would reopen a
    // checkout they just closed, next time the app started.
    clearPendingIntent()
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
    if (!canTakePayment()) { pendingAfterAuth.value = false; clearPendingIntent(); return }

    // TWO WAYS TO GET HERE, and the second one is the point of the rewrite.
    //
    //   in memory  — they never left the tab, so the refs still hold the plan.
    //   on disk    — they went to read their email, the phone tore the app
    //                down, and they came back to a cold start. The refs are
    //                gone; the written-down intent is not.
    //
    // Memory wins when both are present: it is the same decision, and the refs
    // are the one the current tab actually made.
    const stored = readPendingIntent()
    if (!pendingAfterAuth.value && !stored) return

    const code = pendingAfterAuth.value ? pendingCourseCode.value : stored!.courseCode
    const plan = pendingAfterAuth.value ? pendingPlan.value : stored!.plan
    const billingPeriod = pendingAfterAuth.value ? pendingBillingPeriod.value : stored!.billingPeriod

    // Spend it before opening, not after: openPaddleCheckout can throw or be
    // refused, and an intent that survives its own spending reopens a checkout
    // every time the app starts.
    pendingAfterAuth.value = false
    pendingCourseCode.value = null
    pendingPlan.value = 'premium'
    pendingBillingPeriod.value = 'monthly'
    clearPendingIntent()

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
    detailsStep,
    detailsEmail,
    pendingPlan,
    pendingBillingPeriod,
    sendBuyerCode,
    verifyBuyerCode,
    resendBuyerCode,
    editBuyerEmail,
    signInInstead,
    closeDetails,
    startCheckout,
    completePendingCheckout,
    closeCheckout,
    alreadySubscribedOpen,
    closeAlreadySubscribed,
    openSubscriptionPortal,
    canUpgradeToFamily,
    upgradeToFamily,
    clearFamilyUpgrade,
    familyUpgradeBusy,
    familyUpgradeError,
    familyUpgradeDone,
  }
}
