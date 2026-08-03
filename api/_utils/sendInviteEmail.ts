/**
 * sendInviteEmail — mail a personal invite's join link to the person it was
 * minted for (tester feedback, Aran 2026-08-03: "I expected it to send the
 * invite email", founder-confirmed "we can probably get it to email them the
 * link — we definitely can").
 *
 * NO NEW EMAIL INFRA. The only sender this estate has is Supabase Auth's own
 * SMTP — the same one that mails the 6-digit signup codes from
 * `auth.signInWithOtp` in Onboarding/SignInModal/RedeemCode. This reuses it
 * verbatim, from the server, against the account the personal link already
 * pre-provisioned:
 *
 *   signInWithOtp({ email, shouldCreateUser: false, emailRedirectTo: joinUrl })
 *
 * so the person gets our existing sign-in mail, and following it lands them on
 * their own join link, signed in. `shouldCreateUser: false` is load-bearing —
 * this call must never mint a stray account; the persona already exists.
 * (`auth.admin.generateLink`, used by create-signin-link.ts / possession-
 * redeem.ts, does NOT send — it only mints a URL for out-of-band delivery.)
 *
 * KNOWN LIMIT, deliberately accepted: the body/subject are Supabase's sign-in
 * template, configured in the Supabase dashboard, not in this repo — so the
 * mail reads as "here's your way in", not as "X has invited you to Y". Making
 * it read like a true invitation is a template change outside the codebase (or
 * a transactional sender, which is docs/onboarding's separate lane).
 *
 * Never blocks the mint: every failure is returned, logged by the caller, and
 * surfaced as "we couldn't email it — here's the link to send yourself". The
 * copy-the-link path stays first-class (founder: WhatsApp is often better).
 */
import { createClient } from '@supabase/supabase-js'
import { PERSONA_EMAIL_DOMAIN } from './provisionPersona'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

export interface SendInviteEmailResult {
  sent: boolean
  error?: string
}

/** Placeholder personas (no email given at mint) live on a domain that never receives mail. */
export function isMailable(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase()
  return !!e && e.includes('@') && !e.endsWith(`@${PERSONA_EMAIL_DOMAIN}`)
}

export async function sendInviteEmail(
  email: string | null | undefined,
  joinUrl: string
): Promise<SendInviteEmailResult> {
  if (!isMailable(email)) return { sent: false, error: 'no mailable address for this person' }
  if (!supabaseUrl || !supabaseAnonKey) return { sent: false, error: 'email sender not configured' }

  try {
    const anon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.auth.signInWithOtp({
      email: (email as string).trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: joinUrl },
    })
    if (error) return { sent: false, error: error.message }
    return { sent: true }
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'send failed' }
  }
}
