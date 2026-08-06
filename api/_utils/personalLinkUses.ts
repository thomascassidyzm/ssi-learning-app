/**
 * personalLinkUses — the honest "Uses" figure for a PERSONAL invite link.
 *
 * WHY THIS EXISTS (live diagnosis 2026-08-06, field report "USES 0 next to
 * someone who is plainly in"):
 *
 *   invite_codes.use_count is incremented in exactly one place —
 *   api/code/redeem.ts. A PERSONAL link (species 1, metadata.personal_
 *   auth_user_id) never reaches it. Its whole flow is:
 *     RedeemCode.vue validate -> pendingCode.personal -> handlePersonalSignIn()
 *       -> POST /api/auth/possession-redeem  (personal branch: mints a session
 *          for the BOUND account and returns; explicitly never touches
 *          use_count) -> router.replace(surface)
 *   /api/code/redeem is not called at all on that path, so use_count for a
 *   personal link is STRUCTURALLY frozen at 0 forever. Confirmed live: 27/27
 *   personal invite rows sit at use_count 0, while 37 shareable rows carry
 *   real non-zero counts — counting works fine, it just doesn't apply here.
 *
 *   The clicks were never lost, only recorded elsewhere: possession-redeem
 *   audit-logs every successful personal sign-in to possession_mint_attempts
 *   with outcome 'personal_signin' (invite_code_id, auth_user_id, created_at).
 *   The link the field report was about had TWO such rows. So the ledger was
 *   printing 0 next to a person who had signed in twice.
 *
 * WHAT WE DO ABOUT IT: derive the personal figure from that existing audit
 * log rather than inventing a new counter. No schema change, no new write, no
 * backfill — the history is already there, so every personal link's number is
 * right retroactively.
 *
 * WHAT WE DELIBERATELY DO NOT DO: make possession-redeem increment use_count.
 * A personal link is repeatable-until-revoked by design, and max_uses is
 * enforced against use_count — incrementing would let a leader's max_uses
 * lock the recipient out of their own account on the second click.
 *
 * Note the two figures are not the same KIND of number, which is why the
 * payload carries a discriminator rather than one anonymous integer:
 *   shareable -> 'redemption': distinct people who joined through this code.
 *   personal  -> 'signin':     times the one bound person opened their link.
 */

/** The audit-log outcome possession-redeem writes for a personal sign-in. */
export const PERSONAL_SIGNIN_OUTCOME = 'personal_signin'

export interface PersonalSigninAttempt {
  invite_code_id: string | null
  created_at: string
}

export interface UsesPayload {
  count: number
  max: number | null
  /** 'redemption' = people who joined; 'signin' = the bound person's logins. */
  kind: 'redemption' | 'signin'
  /** Most recent sign-in (personal links only); null when never used. */
  lastAt: string | null
}

export interface PersonalSigninTally {
  count: number
  lastAt: string | null
}

/**
 * Fold possession_mint_attempts rows into per-code tallies. Rows with a null
 * invite_code_id (pre-validation refusals) are ignored — they belong to no
 * code. Callers should already have filtered to PERSONAL_SIGNIN_OUTCOME; this
 * function does not re-check the outcome so it stays a pure fold.
 */
export function tallyPersonalSignins(
  attempts: readonly PersonalSigninAttempt[]
): Map<string, PersonalSigninTally> {
  const byCode = new Map<string, PersonalSigninTally>()
  for (const row of attempts) {
    const id = row.invite_code_id
    if (!id) continue
    const existing = byCode.get(id)
    if (!existing) {
      byCode.set(id, { count: 1, lastAt: row.created_at ?? null })
      continue
    }
    existing.count += 1
    if (row.created_at && (!existing.lastAt || row.created_at > existing.lastAt)) {
      existing.lastAt = row.created_at
    }
  }
  return byCode
}

/**
 * The figure the ledger should show for one invite row.
 *
 * Shareable links keep use_count exactly as-is — that number is real and this
 * change must not disturb it. Personal links report their sign-in tally, or a
 * truthful zero with lastAt null when the recipient has never opened the link
 * (which the UI renders as "Not yet", not "0").
 */
export function usesForLink(
  row: { id: string; use_count: number; max_uses: number | null },
  isPersonal: boolean,
  signins: ReadonlyMap<string, PersonalSigninTally>
): UsesPayload {
  if (!isPersonal) {
    return { count: row.use_count, max: row.max_uses, kind: 'redemption', lastAt: null }
  }
  const tally = signins.get(row.id)
  return {
    count: tally?.count ?? 0,
    max: row.max_uses,
    kind: 'signin',
    lastAt: tally?.lastAt ?? null,
  }
}
