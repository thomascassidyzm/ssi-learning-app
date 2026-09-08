/**
 * The in-page purchase signal.
 *
 * Paddle tells the page the moment a checkout completes. That signal — not the
 * success redirect, which a standalone PWA or a blocked top-level navigation
 * can swallow — is what makes the app converge on a purchase it has just taken
 * money for.
 *
 * It lives in its own module so the subscription state (loaded at boot) and the
 * Paddle loader (loaded only when somebody buys) can share the name without the
 * first one dragging in the second.
 */
export const CHECKOUT_COMPLETED_EVENT = 'ssi-checkout-completed'
