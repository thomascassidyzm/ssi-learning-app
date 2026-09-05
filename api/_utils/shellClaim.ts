/**
 * Shell-account CLAIMS — the one rule about which account shell an invite may
 * bind to.
 *
 * THE BUG THIS CLOSES (CWE-1188 account pre-hijacking, found 2026-09-05).
 * Asking for a sign-in code CREATES the auth user before the code is typed
 * (api/auth/send-code.ts, `shouldCreateUser: true` — inherent to OTP). So for
 * ANY address on the internet, anyone can leave behind an untouched shell:
 * never signed in, never confirmed, no learner role. api/auth/possession-redeem.ts
 * used to adopt such a shell on the strength of its SHAPE alone — "nobody has
 * ever been inside it, so there is nothing to take over". That reasoning is
 * wrong by one step: the shape says nothing about WHO asked for it. An attacker
 * could pre-create a shell for a teacher at a school they know, then walk in
 * holding any shared student join code and be handed a real session, a real
 * refresh token, on that teacher's address — before the teacher ever saw their
 * own invite.
 *
 * THE RULE, stated once, here: an invite may only bind an account shell that
 * THIS invite's own redemption flow created. Not "a shell that looks untouched"
 * — a shell this exact invite code made, minutes ago, on this same journey.
 *
 * THE MECHANISM: the creating path stamps a timestamped claim into the auth
 * user's `app_metadata` naming the invite code it was created for, and the
 * adoption path requires that claim to name the invite in hand and to be
 * fresher than SHELL_CLAIM_TTL_MS. `app_metadata` and not `user_metadata`
 * deliberately: `user_metadata` is writable by the account holder through
 * `supabase.auth.updateUser()`, `app_metadata` only by the service role — a
 * credential the browser never sees. A claim the subject can forge is not a
 * claim.
 *
 * WHY A TTL AT ALL. The only legitimate adoption left is a RETRY of the very
 * redemption that made the shell: possession-redeem creates the user, the
 * session mint then fails, its cleanup `deleteUser` also fails, and the person
 * presses the button again. That window is seconds. An hour is generous for a
 * human on a bad connection and still bounds the claim to one sitting rather
 * than leaving it live forever.
 *
 * WHAT THIS DELIBERATELY GIVES UP. The old adoption also rescued teachers whose
 * school mail gateway ate their OTP, leaving a shell behind (measured live
 * 2026-09-02: 81 such accounts). That case and the attack above are the SAME
 * SHAPE and cannot be told apart from the row — so they now get the same answer,
 * 409 already_registered → "sign in instead". The rescue for those teachers
 * lives on the authenticated, authorised path built for exactly it: their school
 * admin mints them a short access code (api/school/staff-signin-link.ts) which
 * they spend at api/auth/access-code-redeem.ts. A rescue that requires somebody
 * with authority to vouch for you is the whole difference.
 *
 * Any future endpoint that adopts an existing account shell imports these two
 * functions rather than re-deciding what "untouched" means.
 */

/** One sitting, generously measured. See "WHY A TTL AT ALL" above. */
export const SHELL_CLAIM_TTL_MS = 60 * 60 * 1000

/** The `app_metadata` key the claim lives under. Service-role-writable only. */
export const SHELL_CLAIM_KEY = 'possession_claim'

export interface ShellClaim {
  /** The invite_codes.id this shell was created for. */
  invite_code_id: string
  /** ISO timestamp of creation — the claim's freshness clock. */
  claimed_at: string
}

/**
 * The `app_metadata` fragment to pass to `auth.admin.createUser()` when a
 * redemption flow creates an account shell for a specific invite.
 */
export function buildShellClaim(inviteCodeId: string, now: Date = new Date()): Record<string, ShellClaim> {
  return { [SHELL_CLAIM_KEY]: { invite_code_id: inviteCodeId, claimed_at: now.toISOString() } }
}

/**
 * May THIS invite adopt THIS existing account shell?
 *
 * True only when the shell carries a claim naming this exact invite code and
 * that claim is still fresh. Everything else — no claim (the OTP residue, and
 * the pre-hijacking attack), a claim for a different code, an unparseable or
 * stale claim — is false. Refuses on any doubt, by construction: there is no
 * branch here that returns true without a matching invite id.
 */
export function shellClaimMatches(
  user: { app_metadata?: Record<string, unknown> | null } | null | undefined,
  inviteCodeId: string,
  now: Date = new Date(),
): boolean {
  if (!user || !inviteCodeId) return false
  const raw = (user.app_metadata || {})[SHELL_CLAIM_KEY] as Partial<ShellClaim> | undefined
  if (!raw || typeof raw !== 'object') return false
  if (raw.invite_code_id !== inviteCodeId) return false
  if (typeof raw.claimed_at !== 'string') return false
  const claimedAt = Date.parse(raw.claimed_at)
  if (!Number.isFinite(claimedAt)) return false
  const age = now.getTime() - claimedAt
  // A future-dated claim is a broken clock or a forgery attempt; both refuse.
  if (age < 0) return false
  return age <= SHELL_CLAIM_TTL_MS
}

/** The `app_metadata` patch that spends a claim, so one shell is adopted once. */
export function clearedShellClaim(existing: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...(existing || {}), [SHELL_CLAIM_KEY]: null }
}
