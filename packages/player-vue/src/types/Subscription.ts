/**
 * Subscription.ts - Type definitions for payment/subscription system
 *
 * Provider-agnostic types that work with LemonSqueezy, Stripe, or any other provider.
 * The app only knows about these types - never the provider directly.
 */

/**
 * Subscription status
 * - active: User has an active subscription
 * - cancelled: Subscription cancelled but may still be in paid period
 * - past_due: Payment failed, subscription at risk
 * - none: No subscription (free user)
 */
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'none'

/**
 * Payment provider (for internal tracking)
 */
export type PaymentProvider = 'lemonsqueezy' | 'stripe' | 'manual'

/**
 * Subscription record (matches Supabase schema)
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string
  /** Learner ID this subscription belongs to */
  learnerId: string
  /** Current subscription status */
  status: SubscriptionStatus
  /** Plan identifier (e.g., 'monthly', 'annual') */
  planId: string | null
  /** Human-readable plan name */
  planName: string | null
  /** When current billing period ends */
  currentPeriodEnd: string | null
  /** Whether subscription will cancel at period end */
  cancelAtPeriodEnd: boolean
  /** Payment provider */
  provider: PaymentProvider
  /** A change the owner has scheduled for the end of the paid period (job #376·F, D2). */
  scheduledPlanName?: string | null
  scheduledPlanAt?: string | null
  /**
   * For a family MEMBER: when their family cover really ends (D6) — the paid
   * period plus the 30-day grace when the owner has changed to Premium.
   * Computed by the server (api/_utils/familyGrace.ts); never add days here.
   * Null while nothing ends.
   */
  familyEndsAt?: string | null
  /**
   * For the family OWNER: when the people on their plan stop being covered —
   * the same 30-day arithmetic, from the same server helper, offered before
   * they confirm as well as after. Null unless they hold the Family plan.
   */
  familyCoverEndsAt?: string | null
}

/**
 * Available subscription plan
 */
export interface SubscriptionPlan {
  /** Plan identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Price in smallest currency unit (pence for GBP) */
  price: number
  /** Currency code */
  currency: string
  /** Billing interval */
  interval: 'month' | 'year'
  /** LemonSqueezy variant ID (or Stripe price ID) */
  checkoutId: string
  /** Optional description */
  description?: string
  /** Is this the recommended plan? */
  recommended?: boolean
}

/**
 * Response from subscription checkout endpoint
 */
export interface CheckoutResponse {
  /** URL to redirect user to for checkout */
  checkoutUrl: string
}

/**
 * Response from subscription portal endpoint
 */
export interface PortalResponse {
  /** URL to redirect user to for managing subscription */
  portalUrl: string
}

/**
 * A learner's access is paid for by a funded organisation rather than by
 * themselves — the Canolfan free year (org_enrolments.free_access_until).
 * Reported by /api/subscription so that "should this person be shown a price?"
 * is answered from ONE place, whether the answer comes from a payment or from
 * a grant.
 */
export interface OrgFreeAccess {
  /** The org's `groups` row. */
  groupId: string
  /** Funder's display name, e.g. 'National Centre for Learning Welsh'. */
  orgName: string | null
  /** ISO timestamp the free period ends. */
  until: string
  /** The course codes this grant covers. Suppression is PER COURSE: a premium
   *  language outside this list is quoted the ordinary price, which is honest
   *  (Kai, 2026-09-08). */
  courses: string[]
}

/**
 * Subscription API response
 */
export interface SubscriptionResponse {
  subscription: Subscription | null
  isSubscribed: boolean
  /** True when this learner IS a parent-minted child account. A child has no
   *  email of their own and no way to pay, so no checkout is ever offered
   *  to them (job #376·F, D7). */
  isChildAccount?: boolean
  /** Non-null when this learner's access is already free through a funded org
   *  enrolment. Suppresses every paid-upgrade prompt (see useSubscription). */
  freeAccess?: OrgFreeAccess | null
  /** True when this learner's platform_role is 'ssi_admin'. Decided on the
   *  server from the learner row, never from the client's role cache, and used
   *  to suppress every "buy a plan" affordance: a platform admin outranks
   *  Premium and is never sold anything (Tom, 2026-09-08). */
  isPlatformAdmin?: boolean
}

/**
 * Default plans (configured in app, IDs match LemonSqueezy)
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'monthly',
    name: 'Monthly',
    price: 1499, // £14.99
    currency: 'GBP',
    interval: 'month',
    checkoutId: '', // Set from env VITE_LEMONSQUEEZY_MONTHLY_VARIANT_ID
    description: 'Billed monthly, cancel anytime',
  },
  {
    id: 'annual',
    name: 'Annual',
    price: 9999, // £99.99
    currency: 'GBP',
    interval: 'year',
    checkoutId: '', // Set from env VITE_LEMONSQUEEZY_ANNUAL_VARIANT_ID
    description: 'Save ~45% compared to monthly',
    recommended: true,
  },
]
