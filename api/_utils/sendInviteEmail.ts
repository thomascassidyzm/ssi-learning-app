/**
 * sendInviteEmail — mail a personal invite's join link to the person it was
 * minted for.
 *
 * THE LINK IS THE INVITE (founder ruling 2026-08-05, after Deborah's staging
 * report: the email carried only a 6-digit code and no clickable link). The
 * first cut of this sender reused `auth.signInWithOtp`, whose MAGIC-LINK
 * template this estate has customised down to a branded "Your sign-in code"
 * card with 6 digits and NO link at all. The second cut moved to
 * `auth.admin.inviteUserByEmail`, which does carry a link — but wears
 * Supabase's stock copy: "You have been invited to create a user on
 * https://saysomethingin.app".
 *
 * THIS cut owns the whole mail. Tom's ruling 2026-08-05: "we use Resend as our
 * email service not Supabase". So we ask Supabase's admin API only for the
 * LINK (`auth.admin.generateLink`, which mints without sending), wrap it in
 * our own branded mail and post it through Resend. Supabase's templates are
 * out of the loop entirely. The words are fixed and name nobody — see
 * inviteEmailTemplate.ts for why (Tom's "or just no-one … as simple as
 * possible"), which is also why this function takes no inviter/org context.
 *
 * Verified live 2026-08-05 against a real disposable inbox on the live project:
 *  - `generateLink({ type: 'magiclink' })` works for BOTH an unconfirmed
 *    persona and one who has already clicked; following the link 303s to
 *    `<joinUrl>#access_token=…`, signing them in AND confirming the account.
 *    One link type covers every state, so THE 6-DIGIT FALLBACK IS RETIRED on
 *    this path — every invitee always gets something clickable.
 *  - Resend delivers from `noreply@contact.saysomethingin.app` (the domain is
 *    verified in Resend, and is the same address Supabase Auth already used).
 *
 * Two constraints carried forward:
 *  1. `redirectTo` must sit inside the project's redirect allow-list, or
 *     Supabase silently swaps it for the Site URL — this binds `generateLink`
 *     exactly as it bound `inviteUserByEmail`, because the constraint lives on
 *     Supabase's side, not the mailer's (re-verified 2026-08-05). Only the
 *     production origin is allow-listed today, hence `inviteEmailOrigin()`.
 *  2. Without `RESEND_API_KEY` we fall back to the previous Supabase path
 *     (`inviteUserByEmail`, then the code mail) rather than sending nothing —
 *     so a missing secret degrades to the old behaviour, never to silence.
 */
import { createClient } from '@supabase/supabase-js'
import { PERSONA_EMAIL_DOMAIN } from './provisionPersona'
import { renderInviteEmail } from './inviteEmailTemplate'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * The From address. `contact.saysomethingin.app` is the domain verified in
 * Resend (checked live 2026-08-05) and is the address Supabase Auth already
 * mailed from, so nothing changes in the invitee's inbox but the words.
 */
const INVITE_FROM = (process.env.INVITE_EMAIL_FROM || 'SaySomethingin <noreply@contact.saysomethingin.app>').trim()

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
  /** 'link' — a clickable way in. 'code' — the 6-digit legacy fallback. */
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

  // Primary: our own branded invitation, posted through Resend.
  const resendKey = (process.env.RESEND_API_KEY || '').trim()
  if (resendKey && supabaseServiceKey) {
    return sendViaResend(resendKey, address, url)
  }

  // No Resend key configured — degrade to the previous Supabase-mailer path
  // (stock copy, but a real link) rather than leaving the inbox empty.
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

/**
 * Mint the sign-in link ourselves, then send our own mail.
 *
 * `generateLink` GENERATES without sending — no Supabase template is involved
 * at any point, which is the whole reason we can write the words. `magiclink`
 * is the one type that works whether the persona has clicked before or not
 * (verified live), so there is no already-registered branch here and no code
 * mail: an invitee on this path always gets a clickable link.
 *
 * A failure is reported loudly rather than papered over with the code mail
 * this ruling retired — the link is already good in the dashboard, and the
 * caller falls back to "copy and send it yourself".
 */
async function sendViaResend(
  resendKey: string,
  address: string,
  url: string
): Promise<SendInviteEmailResult> {
  let actionLink: string
  try {
    const svc = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await svc.auth.admin.generateLink({
      type: 'magiclink',
      email: address,
      options: { redirectTo: url },
    })
    if (error) return { sent: false, error: error.message, url }
    actionLink = (data as { properties?: { action_link?: string } } | null)?.properties?.action_link || ''
    if (!actionLink) return { sent: false, error: 'could not mint a sign-in link', url }
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'could not mint a sign-in link', url }
  }

  const { subject, html, text } = renderInviteEmail(actionLink)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: INVITE_FROM, to: [address], subject, html, text }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { sent: false, error: `email provider refused the send (${res.status}) ${body}`.trim(), url }
    }
    return { sent: true, via: 'link', url }
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'send failed', url }
  }
}
