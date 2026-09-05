/**
 * paymentRoute — the ONE declaration of how this build is allowed to take money.
 *
 * Why it exists: the app has fourteen places that start or show a payment, and
 * on 2026-09-04 the Capacitor Android build shipped all of them wired to
 * Paddle. Paddle cannot run inside a store build — an outside payment route for
 * digital goods is a hard rejection at review by both Apple and Google — so
 * pressing Pay did nothing. The fix is not fourteen `if`s. It is one question,
 * answered here, that every affordance asks.
 *
 * The answer is derived from the platform seam (platform/capabilities.ts) and
 * nothing else. There is deliberately no list of screens, no per-component
 * check, and no independent env var: add a payment surface tomorrow and it
 * inherits the right behaviour by asking, or it is wrong.
 *
 *   web  → 'paddle'  (institutions, B2C on the web — unchanged, byte for byte)
 *   webview → 'store' (Google Play Billing now, StoreKit later)
 *
 * TWO SEPARATE QUESTIONS, and conflating them is the bug that got us here:
 *
 *   1. WHICH route is this build's route          → paymentRoute()
 *   2. Is that route actually WIRED yet           → canTakePayment()
 *
 * (2) is false in a native build today, because Play Billing is part 2 and its
 * SKUs do not exist in Play Console yet. A control that calls a route which is
 * not wired is a dead button: a broken promise to the learner and a rejection
 * risk at review. So every affordance gates on canTakePayment(), not on the
 * route name, and flips to live the day part 2 lands by changing the one
 * constant below.
 *
 * INSTITUTIONAL / SEAT PURCHASE IS DIFFERENT AGAIN. It is not "pending" in a
 * store build — it must never exist there at all, at any point, because a seat
 * purchase is inherently an outside-payment route and even a hidden one is a
 * flag somebody can flip. So it is a BUILD-TIME constant, read from the same
 * VITE_APP_SHELL that names the shell, and the router does not register the
 * routes when it is false — the code is not in the bundle to be reached.
 */
import { isNativeShell } from './capabilities'

/** Which payment rail this build is allowed to use. */
export type PaymentRoute = 'paddle' | 'store'

/**
 * Is the store billing route implemented in this codebase yet?
 *
 * PART 2 FLIPS THIS. When Google Play Billing is wired (plugin installed,
 * SKUs configured in Play Console, server-side receipt verification live
 * against Supabase), set it true and every native payment affordance in the
 * app comes back on, in one edit, with no screen-by-screen sweep.
 */
export const STORE_BILLING_WIRED = false

/** The payment rail for the shell this build is running inside. */
export function paymentRoute(): PaymentRoute {
  return isNativeShell() ? 'store' : 'paddle'
}

/**
 * Can this build actually complete a consumer purchase right now?
 *
 * True on the web (Paddle, live). False in a native shell until part 2.
 * Every "Subscribe" / "Go Premium" / "Pay" control asks THIS.
 */
export function canTakePayment(): boolean {
  return paymentRoute() === 'paddle' || STORE_BILLING_WIRED
}

/**
 * Is Paddle's own account machinery — the hosted customer portal, invoices,
 * card updates, in-app cancellation — reachable from this build?
 *
 * A separate question from canTakePayment() on purpose: when part 2 lands,
 * a native build CAN take payment (through Play) while these stay false,
 * because a Play subscription is cancelled and invoiced by Play, never by
 * Paddle. One declaration, two honest answers.
 */
export function paddleBillingAvailable(): boolean {
  return paymentRoute() === 'paddle'
}

/**
 * Build-time: does this BUILD contain institutional / seat purchase at all?
 *
 * Deliberately not a runtime predicate, and deliberately a vite `define`
 * (`__INSTITUTIONAL_PURCHASE__`, set from VITE_APP_SHELL in vite.config.js)
 * rather than `import.meta.env`: Vite replaces `import.meta.env` with the whole
 * env OBJECT, so a key lookup off it is a property access Rollup cannot fold
 * and the branch survives into the bundle — measured, not assumed. A define is
 * a textual literal, so in a webview build this folds to `false` and every
 * branch guarded by it — the /schools/upgrade,
 * /org/upgrade and /tutors/dashboard/upgrade routes, and the lazy import of
 * UpgradeView they hang off — is dead code Rollup drops. There is nothing left
 * in the artifact to flip.
 *
 * Verified by `paymentRoute.test.ts` (routes absent) and by
 * `e2e/_payment-route-bundle-check.mjs` (no seat-purchase strings in a
 * VITE_APP_SHELL=webview build).
 */
export const INSTITUTIONAL_PURCHASE_IN_BUILD: boolean =
  typeof __INSTITUTIONAL_PURCHASE__ === 'boolean' ? __INSTITUTIONAL_PURCHASE__ : true

/**
 * THE answer for anything that RENDERS an institutional affordance — a nav tab,
 * a billing panel, a trial-expired wall, an Upgrade link.
 *
 * Visibility and capability are one fact, and this is where it is declared.
 * Deriving visibility from INSTITUTIONAL_PURCHASE_IN_BUILD instead is the
 * defect an outside review found on 2026-09-05: the constant is BUILD-time, so
 * in the case the Android shell actually uses — the WEB artifact loaded inside
 * a WebView, with `window.__SSI_PLATFORM__ = { shell: 'webview' }` injected at
 * boot, which capabilities.ts documents as a first-class path — the constant is
 * true while the capability is false. The panel rendered, Subscribe worked, and
 * Paddle opened inside a store app: an outside payment route for digital goods,
 * and a hard rejection at review.
 *
 * So the split is: the constant removes code from the ARTIFACT (routes, lazy
 * imports); this predicate decides what a learner or tutor SEES. Pinned by
 * `institutionalVisibility.test.ts`, which scans the source rather than any one
 * component, because the failure mode is the next surface written the old way.
 */
export function institutionalPurchaseAvailable(): boolean {
  return INSTITUTIONAL_PURCHASE_IN_BUILD && paymentRoute() === 'paddle'
}
