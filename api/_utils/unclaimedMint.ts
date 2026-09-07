/**
 * UNCLAIMED MINTS — the one rule about when a self-serve account is still
 * up for grabs, and what taking ownership of it destroys.
 *
 * THE BUG THIS CLOSES (job #345, found by Astra on 2026-09-07, confirmed
 * against the live project the same night, reproduced end to end before a
 * line of this was written).
 *
 * api/auth/buyer-account.ts minted an account for whatever address was typed
 * into the purchase form, with `email_confirm: false`, an OPTIONAL
 * CALLER-SUPPLIED PASSWORD, and a real session handed straight back — no mail
 * sent, nothing proved. What was missing was the other end of it: NOTHING
 * HAPPENED WHEN THE REAL MAILBOX OWNER TURNED UP.
 *
 * THAT ENDPOINT IS GONE. Tom reversed the product decision behind it the same
 * night: the purchase flow now verifies by emailed code BEFORE it takes a card,
 * so no account is ever created from an unverified address with a
 * caller-supplied password. This file did not die with it: every account
 * squatted through buyer-account while it was live is still out there, and is
 * swept the moment its real owner signs in. api/auth/possession-redeem.ts also
 * stamps the marker, but its mints are NOT swept — see PROVENANCE below.
 *
 * So: type a stranger's address, choose a password, get a session, walk away.
 * The address's real owner later signs in with a mailed code — into the SAME
 * account, because it already exists — and the squatter's password and
 * refresh token are still live beside them, for as long as the account lasts.
 * Measured live 2026-09-07: password sign-in, refresh and the original access
 * token all still worked after the owner's own OTP sign-in.
 *
 * THE RULE, stated once, here: an account minted by a self-serve path on an
 * UNPROVEN address stays UNCLAIMED until somebody proves the mailbox. The
 * first sign-in that proves it CLAIMS the account, and claiming destroys every
 * credential that existed before it — the password, and every other session.
 *
 * THE MECHANISM. The minting path stamps the id of the session it handed out
 * into `app_metadata` (service-role-writable only, exactly as
 * api/_utils/shellClaim.ts argues: `user_metadata` is writable by the account
 * holder through `supabase.auth.updateUser()`, so a marker the subject can
 * clear is not a marker). api/auth/claim-account.ts then answers one question:
 * is the session asking to claim this account a DIFFERENT session from the one
 * the mint handed out, reached by PROVING THE MAILBOX?
 *
 * Both halves are load-bearing and both were checked against live GoTrue
 * (2026-09-07):
 *   - `session_id` is a real claim on every Supabase access token, and it is
 *     stable across refresh. So the squatter cannot launder their own session
 *     into a claim, and cannot clear their own marker.
 *   - `amr` names the method: `[{method:'password'}]` for a password sign-in,
 *     `[{method:'otp'}]` for a mailed code. So the squatter cannot use the
 *     password THEY planted to claim the account out from under the owner —
 *     the only thing that claims is receipt of mail.
 *
 * A claim is therefore only ever made by somebody holding the mailbox, and it
 * only ever DESTROYS access. There is no branch here that grants anything.
 *
 * PROVENANCE — WHOSE CREDENTIALS THIS IS ALLOWED TO DESTROY (job #354, live
 * breakage, 2026-09-07). The paragraph above said this rule covers
 * possession-redeem too. IT MUST NOT, and shipping it that way broke real
 * teachers within hours.
 *
 * The two paths are not the same shape, and the difference is whose password
 * it is:
 *   - PURCHASE (`buyer_account`). The address was typed by a stranger and the
 *     password was planted by that stranger. Destroying it costs the squatter
 *     nothing they were entitled to.
 *   - SCHOOLS (`possession_redeem`, `possession_adopt`). A teacher spends an
 *     invite code, and the flow mints IMMEDIATELY and invites a password up
 *     front — precisely because school mail gateways quarantine our codes, so
 *     a password is the teacher's only reliable way back in. That password is
 *     THEIRS. Rotating it, silently, on a routine second-device sign-in by
 *     code, is a total lockout the first time a gateway eats a code — and
 *     nothing visible goes wrong at the moment it happens.
 *
 * So `minted_by` is load-bearing: `mayClaim` fires only for the paths in
 * REVOCABLE_MINTS, and FAILS CLOSED on anything absent or unrecognised.
 * Destroying a real user's credential is far worse than leaving a squatted
 * purchase account revocable one beat longer — and the census of job #345
 * found zero accounts had ever been squatted, so the cost of the safe side is
 * currently nil.
 */

/** The `app_metadata` key the marker lives under. Service-role-writable only. */
export const UNCLAIMED_MINT_KEY = 'unclaimed_mint'

/** Sign-in methods that mean "this person received mail at this address".
 *  `password` is deliberately absent — see the header. */
const POSSESSION_METHODS = new Set(['otp', 'magiclink', 'email', 'emailotp', 'email_otp'])

/** THE MINTING PATHS WHOSE CREDENTIALS MAY BE DESTROYED. See the PROVENANCE
 *  section of the header: revocation exists for the purchase path, where the
 *  password on an unproven address was planted by whoever typed the address.
 *  It must never fire on a schools mint, where the password is the teacher's
 *  own and losing it is a lockout. Anything not named here is NOT revocable —
 *  the set is an allowlist and the default is to leave credentials alone. */
const REVOCABLE_MINTS = new Set(['buyer_account'])

/** Was this mint made by a path whose credentials revocation may destroy?
 *  False for a schools mint, and false for an absent or unrecognised
 *  provenance — fail closed, because destroying a real credential is worse
 *  than leaving a squatted purchase account revocable one beat longer. */
export function mintIsRevocable(mintedBy: string | null | undefined): boolean {
  return typeof mintedBy === 'string' && REVOCABLE_MINTS.has(mintedBy)
}

export interface UnclaimedMint {
  /** The `session_id` of the session the minting path handed out. */
  session_id: string
  /** Which endpoint minted it. A DECISION INPUT, not audit — `mayClaim`
   *  revokes only the paths named in REVOCABLE_MINTS below, and refuses on
   *  anything it does not recognise. See the PROVENANCE section of the
   *  header before changing this or the set. */
  minted_by: string
  /** ISO timestamp of the mint. Audit only; this marker has no TTL, because
   *  an unproven address does not become proven by the passage of time. */
  minted_at: string
}

/** The `app_metadata` fragment a minting path stamps once it knows the id of
 *  the session it is about to return. Merge it over the user's existing
 *  app_metadata — never replace, or a shell claim is lost with it. */
export function buildUnclaimedMint(
  sessionId: string,
  mintedBy: string,
  now: Date = new Date(),
): Record<string, UnclaimedMint> {
  return { [UNCLAIMED_MINT_KEY]: { session_id: sessionId, minted_by: mintedBy, minted_at: now.toISOString() } }
}

/** The marker on this user, or null when there is nothing to claim. */
export function readUnclaimedMint(
  user: { app_metadata?: Record<string, unknown> | null } | null | undefined,
): UnclaimedMint | null {
  const raw = (user?.app_metadata || {})[UNCLAIMED_MINT_KEY] as Partial<UnclaimedMint> | undefined
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.session_id !== 'string' || !raw.session_id) return null
  return {
    session_id: raw.session_id,
    minted_by: typeof raw.minted_by === 'string' ? raw.minted_by : 'unknown',
    minted_at: typeof raw.minted_at === 'string' ? raw.minted_at : '',
  }
}

/** The `app_metadata` patch that spends the marker, so an account is claimed once. */
export function clearedUnclaimedMint(
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...(existing || {}), [UNCLAIMED_MINT_KEY]: null }
}

/** Did this session get here by receiving mail at the address? Reads GoTrue's
 *  own `amr` claim. Refuses on any doubt: an absent or unreadable amr is not
 *  proof of anything. */
export function provedMailbox(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false
  return amr.some((entry) => {
    const method = typeof entry === 'string' ? entry : (entry as any)?.method
    return typeof method === 'string' && POSSESSION_METHODS.has(method.toLowerCase())
  })
}

/**
 * MAY THIS SESSION CLAIM THIS ACCOUNT?
 *
 * True only when there is a marker FROM A REVOCABLE PATH, this is NOT the
 * session the mint handed out, and this session proved the mailbox. Every
 * other shape — no marker (nothing to claim), a schools mint or an
 * unrecognised provenance (nothing this rule is allowed to destroy), the
 * mint's own session (the squatter, asking to be let off), a password sign-in
 * (the planted credential, asking to legitimise itself) — is false, by
 * construction.
 */
export function mayClaim(
  marker: UnclaimedMint | null,
  callerSessionId: string | null | undefined,
  callerAmr: unknown,
): boolean {
  if (!marker) return false
  // PROVENANCE FIRST. A schools mint carries the teacher's own password and
  // must never be swept; so must anything whose provenance we cannot read.
  if (!mintIsRevocable(marker.minted_by)) return false
  if (!callerSessionId) return false
  if (callerSessionId === marker.session_id) return false
  return provedMailbox(callerAmr)
}

/**
 * The `session_id` GoTrue stamps on every access token.
 *
 * Verified live 2026-09-07: present on this project's tokens and stable across
 * refresh, which is what makes it usable as the marker above. It lived in
 * api/auth/buyer-account.ts until that endpoint was retired; it belongs here,
 * beside the rule that is the only thing that reads it.
 */
export function readSessionId(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1] || '', 'base64').toString('utf8'))
    return typeof payload?.session_id === 'string' && payload.session_id ? payload.session_id : null
  } catch {
    return null
  }
}
