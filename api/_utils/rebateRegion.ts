/**
 * Rebate region exclusion — server-side, enforced where the rebate is COMPUTED.
 *
 * Founder ruling (Tom, 2026-09-02): "no rebates for India — pricing model is
 * much less anyway - and there's no possibility of us recovering transactions
 * costs."
 *
 * Why this exists: the tutor/affiliate rebate is a FLAT £5 (500 pence) against a
 * product listed at ~£15. Paddle country pricing can bill a buyer far below the
 * GBP list price on the SAME price id, so a deeply-discounted sale can pay out
 * more rebate than was ever collected. Capping the rebate as a percentage was
 * considered and rejected; the ruling is EXCLUSION.
 *
 * Scope discipline: INDIA IS THE ONLY REGION RULED ON. The reasoning generalises
 * to any deeply-discounted region, so further regions are addable by CONFIG
 * (REBATE_EXCLUDED_COUNTRIES env, comma-separated ISO-3166 alpha-2) — but none
 * is excluded today. IN is a hardcoded constant, not config, so the rule holds
 * even if the env var is unset, emptied or mis-typed later.
 */

import { paddle } from './paddle'

/** Ruled exclusions. Constant, not configurable — cannot be turned off by env. */
const RULED_EXCLUDED_COUNTRIES = ['IN'] as const

/**
 * Currencies that can ONLY belong to an excluded country. Used as a backstop
 * when the billing country can't be resolved from the payload — an INR
 * transaction is an India sale whatever else we can or can't read.
 */
const EXCLUDED_CURRENCIES: Record<string, string> = { INR: 'IN' }

/** Ruled exclusions ∪ any configured additions. */
export function excludedRebateCountries(): Set<string> {
  const configured = (process.env.REBATE_EXCLUDED_COUNTRIES || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
  return new Set<string>([...RULED_EXCLUDED_COUNTRIES, ...configured])
}

export function isRebateExcludedCountry(country: string | null | undefined): boolean {
  if (!country) return false
  return excludedRebateCountries().has(country.trim().toUpperCase())
}

/**
 * Billing country for a Paddle transaction payload, or null if undeterminable.
 *
 * Signal choice: the BILLING ADDRESS country on the transaction. That is what
 * Paddle itself localises price and charges tax on, so it is the same fact that
 * creates the hole — an IP or a locale guess is not. The webhook payload carries
 * `addressId`; the address is fetched server-side (never trusted from custom
 * data, which the browser composes).
 *
 * Throws if the address lookup fails. Callers on the money path let that 500 the
 * webhook so Paddle retries — a transient Paddle outage must never be resolved
 * by silently paying a rebate we couldn't check.
 */
export async function resolveTransactionCountry(txn: any): Promise<string | null> {
  const inline =
    txn?.address?.countryCode ??
    txn?.address?.country_code ??
    txn?.billingDetails?.address?.countryCode
  if (inline) return String(inline).trim().toUpperCase()

  const addressId = txn?.addressId ?? txn?.address_id
  const customerId = txn?.customerId ?? txn?.customer_id
  if (addressId && customerId) {
    const address = await paddle.addresses.get(customerId, addressId)
    const cc = (address as any)?.countryCode ?? (address as any)?.country_code
    if (cc) return String(cc).trim().toUpperCase()
  }

  return null
}

export interface RebateRegionDecision {
  excluded: boolean
  /** Resolved billing country, or null when it could not be determined. */
  country: string | null
  /** Human-readable reason, for the webhook log line. */
  reason: string
}

/**
 * The money-path gate. Returns excluded=true when no rebate may be paid on this
 * transaction.
 */
export async function rebateRegionDecision(txn: any): Promise<RebateRegionDecision> {
  const country = await resolveTransactionCountry(txn)
  if (isRebateExcludedCountry(country)) {
    return { excluded: true, country, reason: `excluded region ${country}` }
  }

  const currency = String(
    txn?.details?.totals?.currencyCode ?? txn?.currencyCode ?? txn?.currency_code ?? ''
  )
    .trim()
    .toUpperCase()
  const currencyCountry = EXCLUDED_CURRENCIES[currency]
  if (currencyCountry && excludedRebateCountries().has(currencyCountry)) {
    return {
      excluded: true,
      country: country || currencyCountry,
      reason: `billed in ${currency} (excluded region ${currencyCountry})`,
    }
  }

  return { excluded: false, country, reason: country ? `region ${country}` : 'region unknown' }
}
