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
 * Subscription API response
 */
export interface SubscriptionResponse {
  subscription: Subscription | null
  isSubscribed: boolean
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
