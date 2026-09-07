/**
 * Taking ownership of an account somebody else may have minted first.
 *
 * WHY THIS RUNS ON EVERY SIGN-IN (job #345, 2026-09-07). The purchase flow
 * hands a session to whoever types an email address — deliberately, so that
 * nobody has to fetch a code from a mailbox before they are allowed to pay.
 * The cost of that, until this landed, was that typing a STRANGER's address
 * planted a password and a session on it, and the stranger's own sign-in
 * later did nothing about either. Reproduced end to end against the live
 * project before this was written.
 *
 * So: after any sign-in, ask the server whether this account was minted
 * without the mailbox ever being proved, and whether THIS sign-in is the one
 * that proves it. The server decides — it is the only party that can, because
 * the marker it reads is service-role-only and the session id and sign-in
 * method it compares come from GoTrue's own token claims (api/auth/claim-account.ts,
 * api/_utils/unclaimedMint.ts). The browser never gets a say.
 *
 * IT LIVES AT ONE CALL SITE ON PURPOSE. There are six screens in this app that
 * finish a code sign-in (SignInModal, RedeemCode, Onboarding, SchoolsContainer,
 * TeachContainer, WithTeacher). Hooking six is how you get five: this hangs off
 * useAuth's single SIGNED_IN handler instead, so a seventh screen is covered
 * the day it is written.
 *
 * WHEN IT CLAIMS, IT REPLACES THE SESSION. Claiming revokes every session on
 * the account — including the one that just signed in, because a sweep with an
 * exception in it is not a sweep — and the server mints a replacement. The
 * caller must adopt it or the person is signed out a moment after signing in.
 */

/** In flight, or already answered for this token. Adopting the replacement
 *  session re-fires SIGNED_IN; without this the second pass would ask again. */
const asked = new Set<string>()

export interface ClaimResult {
  claimed: boolean
  session?: { access_token: string; refresh_token: string } | null
}

/**
 * Ask the server to claim this account if this sign-in proves the mailbox.
 *
 * NEVER THROWS AND NEVER BLOCKS SIGN-IN. A claim that cannot be reached leaves
 * the person signed in exactly as before — the account stays marked unclaimed,
 * so the next sign-in tries again. Failing closed here would lock people out
 * of their own accounts over a network blip, which is a worse bug than the one
 * this closes.
 */
export async function claimAccountIfNeeded(
  client: { auth: { setSession: (s: { access_token: string; refresh_token: string }) => Promise<any> } },
  accessToken: string,
): Promise<ClaimResult> {
  if (!accessToken || asked.has(accessToken)) return { claimed: false }
  asked.add(accessToken)
  try {
    const res = await fetch('/api/auth/claim-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return { claimed: false }
    const body = (await res.json()) as ClaimResult
    if (!body?.claimed) return { claimed: false }

    if (body.session?.access_token && body.session?.refresh_token) {
      await client.auth.setSession({
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
      })
      console.info('[claimAccount] This account was created before anyone proved the address. Older credentials have been cleared.')
      return body
    }
    // Claimed, but no replacement session: the account IS secured and this
    // session is gone with the rest. Say so; the app's normal signed-out path
    // takes it from here.
    console.warn('[claimAccount] Account secured, but no replacement session — signing in again is needed.')
    return body
  } catch {
    return { claimed: false }
  }
}

/** Test seam — the memo is module-level state. */
export function __resetClaimMemo(): void {
  asked.clear()
}
