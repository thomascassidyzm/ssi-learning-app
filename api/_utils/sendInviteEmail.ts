/**
 * sendInviteEmail — mail a personal invite's join link to the person it was
 * minted for.
 *
 * THE LINK IS THE INVITE (founder ruling 2026-08-05, after Deborah's staging
 * report: the email carried only a 6-digit code and no clickable link). The
 * first cut of this sender reused `auth.signInWithOtp`, and that call sends
 * the project's MAGIC-LINK template — which this estate has customised down to
 * a branded "Your sign-in code" card with the 6 digits and NO link at all
 * (verified live 2026-08-05 by mailing a real inbox and reading the body). So
 * the invitee got a code they had nowhere to type, and the link stayed stuck
 * in the dashboard.
 *
 * The fix uses the OTHER stock Supabase template — the INVITE one, sent by
 * `auth.admin.inviteUserByEmail`. Verified live against the same inbox: it
 * arrives as "You have been invited … Accept the invite" with a real
 * `<a href>`, and following that href 303s to
 * `<joinUrl>#access_token=…&type=invite` — i.e. the person lands on their own
 * join link already signed in, zero code entry. Exactly the ruling.
 *
 * STILL NO NEW EMAIL INFRA: same Supabase Auth sender
 * (noreply@contact.saysomethingin.app), same project — just the template that
 * carries a link instead of the one that carries a code.
 *
 * Two constraints of that API, both handled here:
 *  1. It only mails an account that is NEW or still UNCONFIRMED. A personal
 *     link's persona is created with `email_confirm: false`, so the mint,
 *     resend and rotate paths all qualify — until the person actually clicks,
 *     which confirms them. After that Supabase answers "already been
 *     registered", and we fall back to the old code mail so a re-send still
 *     puts SOMETHING in their inbox; the reply carries `via: 'code'` so the
 *     caller can say so honestly and keep copy-the-link first-class.
 *  2. `redirectTo` must sit inside the project's redirect allow-list, or
 *     Supabase silently swaps it for the Site URL. Only the production origin
 *     is allow-listed today (verified 2026-08-05: a staging redirect came back
 *     as `https://saysomethingin.app`) — hence `inviteEmailOrigin()` below.
 */
import { createClient } from '@supabase/supabase-js'
import { PERSONA_EMAIL_DOMAIN } from './provisionPersona'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * The origin an EMAILED join link points at — production by default, whatever
 * origin minted the invite.
 *
 * An invite email is a real-world artifact landing in a real learner's inbox;
 * it should take them to the real app, never to a preview deployment. It also
 * has to: Supabase drops any `redirectTo` outside the project's allow-list,
 * and only `https://saysomethingin.app` is on it — a staging/dev link would
 * bounce the invitee to the production ROOT (signed in, but nowhere near their
 * join link). Pointing at production directly is the same destination, minus
 * the silent failure. dev/staging/prod share one database, so a code minted on
 * staging redeems on production unchanged.
 *
 * `INVITE_EMAIL_ORIGIN` overrides it — the escape hatch for once
 * `https://staging.saysomethingin.app/**` is added to Supabase's redirect
 * allow-list and staging invites should stay on staging.
 */
export function inviteEmailOrigin(): string {
  const override = (process.env.INVITE_EMAIL_ORIGIN || '').trim().replace(/\/+$/, '')
  return override || 'https://saysomethingin.app'
}

/** Rewrite a mint-origin join URL onto the origin an emailed link must use. */
export function toInviteEmailUrl(joinUrl: string): string {
  try {
    const u = new URL(joinUrl)
    return `${inviteEmailOrigin()}${u.pathname}${u.search}${u.hash}`
  } catch {
    return joinUrl
  }
}

export interface SendInviteEmailResult {
  sent: boolean
  /** 'link' — the invite template (a clickable way in). 'code' — the 6-digit fallback. */
  via?: 'link' | 'code'
  /** The URL actually put in the mail, so callers can log/echo the real artifact. */
  url?: string
  error?: string
}

/** Placeholder personas (no email given at mint) live on a domain that never receives mail. */
export function isMailable(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase()
  return !!e && e.includes('@') && !e.endsWith(`@${PERSONA_EMAIL_DOMAIN}`)
}

/** Supabase's way of saying "this account already accepted an invite — no re-issue". */
function isAlreadyRegistered(message: string): boolean {
  return /already been registered|already registered|already exists|email_exists/i.test(message)
}

export async function sendInviteEmail(
  email: string | null | undefined,
  joinUrl: string
): Promise<SendInviteEmailResult> {
  if (!isMailable(email)) return { sent: false, error: 'no mailable address for this person' }
  if (!supabaseUrl) return { sent: false, error: 'email sender not configured' }

  const address = (email as string).trim().toLowerCase()
  const url = toInviteEmailUrl(joinUrl)

  // Primary: the invite template — the one that carries a link.
  if (supabaseServiceKey) {
    try {
      const svc = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error } = await svc.auth.admin.inviteUserByEmail(address, { redirectTo: url })
      if (!error) return { sent: true, via: 'link', url }
      // Anything other than "they've already accepted one" is a real failure —
      // don't paper over it with the code mail this ruling just retired.
      if (!isAlreadyRegistered(error.message)) return { sent: false, error: error.message, url }
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : 'send failed', url }
    }
  }

  // Fallback: the person has already confirmed (or no service key is
  // configured) — Supabase will not re-issue an invite mail, so send the
  // sign-in code so the inbox isn't empty. The link still works if copied.
  if (!supabaseAnonKey) return { sent: false, error: 'email sender not configured', url }
  try {
    const anon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: url },
    })
    if (error) return { sent: false, error: error.message, url }
    return { sent: true, via: 'code', url }
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'send failed', url }
  }
}
