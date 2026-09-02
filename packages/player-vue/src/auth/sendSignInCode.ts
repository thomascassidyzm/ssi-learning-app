/**
 * sendSignInCode — ask for a six-digit sign-in code, from any of the screens
 * that sign somebody in.
 *
 * Six screens each called `supabase.auth.signInWithOtp({ email })` directly,
 * which mails Supabase Auth's magic-link template: a subject line, six bare
 * digits, no text/plain part, no reply path. Welsh school (Hwb) domains were
 * binning it — 40-45% sign-in completion against 94% elsewhere, with SPF and
 * DKIM passing and Resend accepting every send. The mail is now ours, written
 * and posted by `POST /api/auth/send-code` (see api/_utils/signInCodeEmail.ts
 * for the evidence and the copy).
 *
 * THE FALLBACK IS THE POINT. If the route is missing, unconfigured, refused by
 * Resend or simply unreachable, this drops straight back to `signInWithOtp` —
 * exactly today's behaviour, an uglier email rather than a locked-out teacher.
 * A 429 is the one refusal we honour, because that IS the answer: a genuine
 * rate limit must not be laundered into a second send by the fallback.
 *
 * The verify side is untouched. Both paths mint the same OTP for the same
 * account, and `verifyOtp({ type: 'email' })` accepts it either way (verified
 * live against the production project, 2026-09-02).
 */

export interface SendSignInCodeResult {
  /** Absent on success. Ready to show a learner as-is. */
  error?: { message: string }
  /** Which path actually sent it — telemetry and debugging only. */
  via?: 'resend' | 'supabase'
}

const GENERIC = 'Unable to send code. Please try again.'

export async function sendSignInCode(client: any, email: string): Promise<SendSignInCodeResult> {
  const address = (email || '').trim()

  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address }),
    })

    if (res.ok) return { via: 'resend' }

    // A real throttle is a real answer — never retry it through the fallback.
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}))
      return { error: { message: body?.error || 'Too many codes requested. Please wait a few minutes.' }, via: 'resend' }
    }
    // Anything else (404 on an un-deployed route, 503 unconfigured, 502 from
    // the provider) falls through to Supabase's mailer below.
  } catch {
    // Offline, blocked, no route — same fallback.
  }

  try {
    const { error } = await client.auth.signInWithOtp({ email: address })
    if (error) return { error: { message: error.message || GENERIC }, via: 'supabase' }
    return { via: 'supabase' }
  } catch (err: any) {
    return { error: { message: err?.message || GENERIC }, via: 'supabase' }
  }
}
