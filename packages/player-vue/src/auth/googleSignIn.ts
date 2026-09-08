/**
 * Google as a DOOR, not as an account type.
 *
 * The India funnel's first-run ask is "let me in", and until now the account
 * screen offered exactly one way: an email address and a code posted to it.
 * For a stranger on a phone in India that is the point most of them stop. So
 * Google goes ABOVE the email field — email OTP untouched underneath it.
 *
 * WHAT THIS IS NOT. It is not an identity. `docs/identity/
 * india-identity-model-2026-09-03.md` §1-2 rules that an account is one row in
 * `learners`, named by its proven email addresses, and (D1) that nothing may
 * ever RESOLVE through a `provider` + `provider_user_id` pair. So this module
 * ends where every other door ends: at a Supabase session attesting one email
 * address, which the existing email-is-the-account machinery then owns. It
 * asks Google for `email profile` and nothing else — no extra scopes, and
 * therefore no Google verification review to sit through.
 *
 * DARK AS SHIPPED. Supabase has `external_google_enabled: false` with no
 * client id at the time of writing, so the provider answers "Unsupported
 * provider" until Tom creates the OAuth client and pastes its credentials in.
 * That is why `oauthErrorMessage` names that case in plain words rather than
 * showing a learner Supabase's internal wording.
 */

export const GOOGLE_SCOPES = 'email profile'

/** Params an OAuth return leaves behind — ours to strip before we go back. */
const RETURN_PARAMS = [
  'error',
  'error_code',
  'error_description',
  'provider_token',
  'provider_refresh_token',
]

/**
 * Where Google sends the learner back to: exactly where they were.
 *
 * The whole point of the redirect is that a sign-in does not cost the learner
 * their place — an enrolment link's `?code=`, a `?course=` deep link and the
 * path itself all survive the round trip. Any leftovers from a PREVIOUS failed
 * attempt are dropped, so an old error cannot reappear after a good sign-in.
 */
export function googleRedirectTo(loc: {
  origin: string
  pathname: string
  search?: string
}): string {
  const params = new URLSearchParams(loc.search || '')
  for (const p of RETURN_PARAMS) params.delete(p)
  const query = params.toString()
  return `${loc.origin}${loc.pathname || '/'}${query ? `?${query}` : ''}`
}

/**
 * What a learner is told when the door does not open.
 *
 * Supabase says "Unsupported provider: provider is not enabled" when the
 * Google client id has not been configured. A learner must never read that.
 */
export function oauthErrorMessage(err: { message?: string } | null | undefined): string {
  const raw = (err?.message || '').toLowerCase()
  if (!raw) return 'Could not open Google sign-in. Please use your email address below.'
  if (raw.includes('provider is not enabled') || raw.includes('unsupported provider')) {
    return 'Google sign-in is not switched on yet. Please use your email address below.'
  }
  if (raw.includes('access_denied') || raw.includes('cancel')) {
    return 'Google sign-in was cancelled.'
  }
  return 'Could not open Google sign-in. Please use your email address below.'
}

/**
 * An OAuth failure comes back in the URL fragment, not as a thrown error.
 * Read it once on the way back in so a learner sees why nothing happened
 * instead of a silently unchanged sign-in screen.
 */
export function readOAuthReturnError(hash: string | null | undefined): string | null {
  if (!hash) return null
  const frag = new URLSearchParams(hash.replace(/^#/, ''))
  const code = frag.get('error') || frag.get('error_code')
  if (!code) return null
  return oauthErrorMessage({ message: frag.get('error_description') || code })
}

export interface OAuthClient {
  auth: {
    signInWithOAuth(args: {
      provider: 'google'
      options?: { redirectTo?: string; scopes?: string }
    }): Promise<{ error: { message?: string } | null }>
  }
}

/**
 * Open the Google door. Resolves with a learner-facing message when it could
 * not be opened, and with null when the browser is on its way to Google —
 * there is no success case to handle here, because success arrives as a
 * page load carrying a session that useAuth's listener already owns.
 */
export async function startGoogleSignIn(
  client: OAuthClient | null | undefined,
  loc: { origin: string; pathname: string; search?: string },
): Promise<string | null> {
  if (!client) return 'Sign-in is unavailable right now. Please try again shortly.'
  try {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: googleRedirectTo(loc), scopes: GOOGLE_SCOPES },
    })
    return error ? oauthErrorMessage(error) : null
  } catch (err: any) {
    return oauthErrorMessage(err)
  }
}

/**
 * A failed OAuth return has to be read EARLY.
 *
 * Supabase's own `detectSessionInUrl` consumes the fragment and strips it
 * during client construction, so anything reading `window.location.hash`
 * later — the sign-in panel, say — finds a clean URL and shows a learner
 * nothing at all. So boot captures it once, before the client exists, and the
 * panel takes it when it opens.
 */
let capturedReturnError: string | null = null

export function captureOAuthReturnError(hash: string | null | undefined): void {
  const msg = readOAuthReturnError(hash)
  if (msg) capturedReturnError = msg
}

/** Read once and clear — an old failure must not haunt the next open. */
export function takeOAuthReturnError(): string | null {
  const msg = capturedReturnError
  capturedReturnError = null
  return msg
}
