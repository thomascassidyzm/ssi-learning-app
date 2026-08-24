/**
 * loginCode — the two shared pieces every email-OTP screen needs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Five screens sign a learner in with a six-digit emailed code, and each one
 * had the same two holes (diagnosis 2026-08-10):
 *
 * 1. A second submit after a SUCCESSFUL verify re-sends a token Supabase has
 *    already consumed, so the learner is shown "Token has expired or is
 *    invalid" while genuinely holding a live session. `Onboarding.vue` already
 *    guarded against this per-address; `hasLiveSessionFor` is the same idea
 *    expressed as a question anyone can ask: "did this actually work already?"
 *
 * 2. Nothing anywhere recorded a FAILED code attempt — only successes leave a
 *    timestamp — so "it told me my code was wrong" took reconstruction rather
 *    than a lookup. `useLoginCodeAudit` writes the failure into the existing
 *    `player_events` stream.
 *
 * Supabase returns ONE generic message for wrong / expired / already-used
 * ("Token has expired or is invalid"), so the string can never tell us which
 * happened. That is precisely why the event matters: it cannot disambiguate
 * the cause, but it does record that it happened, on which screen, and to whom.
 *
 * NEVER LOG THE CODE. Payload is email + screen + a normalised error type,
 * and nothing else. The submitted token, access/refresh tokens and any
 * password stay out of telemetry by construction — `classifyOtpError` returns
 * a fixed label rather than passing raw text through.
 */

import { usePlayerLog } from '../composables/usePlayerLog'

/** A failed six-digit login-code verification. Greppable on purpose. */
export const LOGIN_CODE_FAILED = 'login_code_failed'

/** A resubmit that hit an already-live session — a no-op, NOT a failure.
 *  Kept distinct so `login_code_failed` never counts the double-tap it fixed. */
export const LOGIN_CODE_ALREADY_SIGNED_IN = 'login_code_already_signed_in'

/** Stable screen slugs — the thing a future investigation greps for. */
export type LoginCodeScreen =
  | 'sign-in-modal'
  | 'redeem-code'
  | 'schools-container'
  | 'teach-container'
  | 'with-teacher'
  | 'onboarding'

export type LoginCodeErrorType =
  /** Supabase's one generic message: wrong, expired and spent all look alike. */
  | 'expired_or_invalid'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'other'

/**
 * Normalise a verify error to a coarse type. Deliberately returns a fixed
 * label rather than the raw message, so nothing the learner typed can ever
 * echo back into telemetry.
 */
export function classifyOtpError(message?: string | null): LoginCodeErrorType {
  const m = (message || '').toLowerCase()
  if (!m) return 'other'
  if (m.includes('expired') || m.includes('invalid') || m.includes('token')) return 'expired_or_invalid'
  if (m.includes('rate limit') || m.includes('for security purposes') || m.includes('too many')) return 'rate_limited'
  if (m.includes('fetch') || m.includes('network') || m.includes('offline')) return 'network'
  if (m.includes('500') || m.includes('unexpected_failure') || m.includes('server')) return 'server'
  return 'other'
}

/**
 * Is there ALREADY a live session, and does it belong to the address being
 * verified? The idempotent success check: a `true` here means the submit that
 * just "failed" was a resubmit of a code that already worked.
 *
 * Never throws — a client that cannot answer is treated as "no session", which
 * leaves the pre-existing error behaviour exactly as it was.
 */
export async function hasLiveSessionFor(client: any, email?: string | null): Promise<boolean> {
  try {
    if (!client?.auth?.getSession) return false
    const { data } = await client.auth.getSession()
    const user = data?.session?.user
    if (!user) return false
    const want = (email || '').trim().toLowerCase()
    if (!want) return true
    const have = (user.email || '').trim().toLowerCase()
    return have === want
  } catch {
    return false
  }
}

/**
 * The audit trail for one screen. Fire-and-forget and silent on failure —
 * diagnostic logging must never turn a login problem into a login outage.
 */
export function useLoginCodeAudit(screen: LoginCodeScreen) {
  let log: ReturnType<typeof usePlayerLog> | null = null
  try {
    log = usePlayerLog()
  } catch {
    log = null // outside a component instance (tests, SSR) — degrade to a no-op
  }

  const emit = (type: string, payload: Record<string, unknown>): void => {
    try {
      log?.event(type, payload)
      // Flush now rather than on the 5s timer: a learner who has just been told
      // their code is wrong is exactly the learner about to close the tab.
      void log?.flush()
    } catch { /* silent — telemetry never blocks the sign-in */ }
  }

  return {
    /** A verify that genuinely failed. */
    failed(email: string | null | undefined, message?: string | null): void {
      emit(LOGIN_CODE_FAILED, {
        screen,
        email: (email || '').trim().toLowerCase() || null,
        error_type: classifyOtpError(message),
      })
    },
    /** A resubmit that landed on an already-live session. Not a failure. */
    alreadySignedIn(email: string | null | undefined): void {
      emit(LOGIN_CODE_ALREADY_SIGNED_IN, {
        screen,
        email: (email || '').trim().toLowerCase() || null,
      })
    },
  }
}
