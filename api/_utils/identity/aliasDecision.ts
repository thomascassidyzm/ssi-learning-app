/**
 * The alias/merge decision function — the state machine of
 * docs/identity/india-identity-model-2026-09-03.md §4/§6 as one pure
 * function, so the client and the eventual server endpoint cannot drift.
 *
 * Vocabulary (model D9, the distinction everything hangs on):
 *   ALIAS — attaching an ANONYMOUS id (no name, no email, no other door)
 *           to an account. Safe, effectively lossless.
 *   MERGE — joining two NAMED accounts. Never decided here: named-account
 *           merges are always human-offered and go through the mergeAudit
 *           primitive; this function only ever refuses them.
 *
 * Decisions:
 *   auto_alias  — anon id attaches to the account silently (audited).
 *   offer_alias — anon id attaches only on an explicit accepted offer
 *                 (the two-sided case, §6.6: both sides hold purchases —
 *                 shared family phones make silent swallowing dangerous,
 *                 and the tap makes the act attributable).
 *   land_only   — session lands on the account; no anon id to attach
 *                 (or nothing on it worth attaching — nothing to do).
 *   refuse      — an invariant would be violated; nothing moves.
 *
 * Invariants enforced (model §4):
 *   I2 — identity is never attached from an unproven address (the caller
 *        must pass sessionVerified; a false lands refuse).
 *   I3 — an anon id appears in at most one alias record ever.
 */

export interface AnonSummary {
  /** The install's anon id, e.g. 'anon-3f2c...'. Null = no anon id present. */
  anonId: string | null
  /** Entitlements currently attached to the anon id (course codes etc). */
  entitlements: string[]
  /** True if this anon id already appears in an alias record (I3). */
  alreadyAliased: boolean
  /** True if local (unsynced) progress exists under the anon id. */
  hasLocalProgress: boolean
}

export interface AccountSummary {
  learnerId: string
  /** Entitlements the account already owns. */
  entitlements: string[]
}

export interface SessionSummary {
  /** The door completed and the address it proved is attested by the auth
   *  layer (a verified Supabase session exists). Model I2: a caller that
   *  cannot assert this gets refuse, whatever else is true. */
  sessionVerified: boolean
}

export type AliasDecision =
  | { action: 'land_only'; reason: string }
  | { action: 'auto_alias'; reason: string }
  | { action: 'offer_alias'; reason: string; offerCopyKey: 'attach_purchase_to_account' }
  | { action: 'refuse'; reason: string }

export function decideAlias(
  session: SessionSummary,
  anon: AnonSummary,
  account: AccountSummary,
): AliasDecision {
  // I2 — no verified session, nothing moves.
  if (!session.sessionVerified) {
    return { action: 'refuse', reason: 'no verified session (I2)' }
  }

  // Nothing anonymous on this install → the door simply lands.
  if (!anon.anonId) {
    return { action: 'land_only', reason: 'no anon id on this install' }
  }

  // I3 — an anon id aliases at most once, ever.
  if (anon.alreadyAliased) {
    return { action: 'refuse', reason: 'anon id already aliased (I3)' }
  }

  const anonHasPurchases = anon.entitlements.length > 0
  const accountHasPurchases = account.entitlements.length > 0

  // Two-sided case (§6.6): both sides hold purchases. The one alias whose
  // consequences are not trivially safe — offered, never silent, audited
  // like a merge. Declining leaves the purchase on the anon id, playable
  // on this install (I1) and recoverable via Play restore.
  if (anonHasPurchases && accountHasPurchases) {
    return {
      action: 'offer_alias',
      reason: 'both anon id and account hold purchases (§6.6)',
      offerCopyKey: 'attach_purchase_to_account',
    }
  }

  // One-sided or empty: attaching an unnamed id's purchases and/or progress
  // to the only account in play loses nothing and blocks nobody (D9).
  if (anonHasPurchases || anon.hasLocalProgress) {
    return {
      action: 'auto_alias',
      reason: anonHasPurchases
        ? 'anon purchases, account has none — lossless attach'
        : 'local progress only — lossless attach',
    }
  }

  return { action: 'land_only', reason: 'anon id holds nothing worth attaching' }
}

/**
 * I4 helper — entitlement conservation. The union both sides held before an
 * alias/merge, stored on the audit row at write time and re-checked later by
 * the tripwire (model §9): any later resolution producing LESS than this for
 * the surviving account is the "somebody lost their purchases" detector.
 */
export function entitlementUnion(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b])).sort()
}
