/**
 * The family-plan invite email — the mail the invited person receives when
 * somebody adds their address to a Family plan.
 *
 * WHY THIS EXISTS. The invite-by-email path wrote a `family_members` row and
 * told nobody. If the address already had an account it was attached on the
 * spot; if not, it pended until that person happened to sign in. Either way
 * the owner had to phone them and explain what to do, and from the outside
 * the feature looked broken. This closes that.
 *
 * NO MAGIC LINK, DELIBERATELY. The org invite (sendInviteEmail.ts) mints a
 * Supabase `magiclink` because for an org the link IS the invite — there is a
 * join URL to land on. A family invite has no such destination: the seat
 * attaches from the email address itself, at whatever moment that person next
 * signs in. Minting a link here would create an auth account for somebody who
 * has not asked for one, and would put a token in an inbox that expires long
 * before an unread family invite is read — a button that silently stops
 * working is worse than a sentence that never does. So the mail carries a
 * plain link to the app and one instruction: sign in with THIS address.
 *
 * TWO MAILS, NOT ONE. The two states need different words. Someone who
 * already has an account is being told "it is done, carry on as usual".
 * Someone who does not is being told "sign up with this exact address and it
 * attaches on your first sign-in". A single message would be wrong for both.
 *
 * NEVER FOR A CHILD SEAT. `create-child.ts` mints a synthetic
 * `@members.saysomethingin.app` address that receives no mail and hands the
 * parent a QR code instead; it does not call this module and must not.
 *
 * House style follows inviteEmailTemplate.ts: Mist palette, tables and inline
 * styles only, no web fonts, plain-text alternative always, British English.
 */

import { inviteEmailOrigin } from './sendInviteEmail'
import { postResendEmail } from './resendMail'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface FamilyInviteEmailInput {
  /** The invited address — quoted back, because it is the thing they must sign in with. */
  address: string
  /** The owner's display name, or null when we have nothing trustworthy to show. */
  inviterName: string | null
  /** True when that address already has an account and the seat attached immediately. */
  hasAccount: boolean
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A display name we are willing to put in somebody else's inbox.
 *
 * The auth trigger seeds `display_name` from an email's local part, which has
 * already leaked an address fragment into a test inbox once
 * (inviteEmailTemplate.ts). Anything address-shaped is treated as absent and
 * the mail falls back to naming nobody.
 */
export function safeInviterName(displayName: string | null | undefined): string | null {
  const name = (displayName || '').trim()
  if (!name) return null
  // An address, or the address-shaped local part of one: `j.smith92`,
  // `tom_c`, `grandpa1974`. A plain first name that happens to match a local
  // part ("Bethan" for bethan@…) is NOT dropped — it is her name, it is what
  // the app already shows her family, and losing it would cost the mail the
  // one thing the invitee most needs to see: who this is from.
  if (/[@._\d]/.test(name)) return null
  return name
}

export function renderFamilyInviteEmail(input: FamilyInviteEmailInput): RenderedEmail {
  const { address, inviterName, hasAccount } = input
  const subject = inviterName
    ? `${inviterName} has added you to their SaySomethingin family plan`
    : 'You have been added to a SaySomethingin family plan'

  const lead = inviterName
    ? `${inviterName} has added you to their family plan on SaySomethingin, so you have full access to the courses.`
    : 'You have been added to a family plan on SaySomethingin, so you have full access to the courses.'

  const instruction = hasAccount
    ? `There is nothing to set up. Sign in the way you normally do, with this email address: ${address}`
    : `You do not have an account yet. Sign in with this exact email address — ${address} — and your place is added the moment you do. You will be sent a six-digit code by email, and there is no password to set.`

  const origin = inviteEmailOrigin()
  const buttonLabel = hasAccount ? 'Open SaySomethingin' : 'Sign in to SaySomethingin'
  const closing = hasAccount
    ? 'If you were not expecting this, reply to this email and we will take the place back off your account.'
    : 'If you were not expecting this, you can ignore this email — no account has been created in your name.'

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#e8e3dd;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8e3dd;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8A8078;padding-bottom:20px;">SaySomethingin</td></tr>
        <tr><td style="font-size:19px;line-height:1.55;color:#2C2622;padding-bottom:20px;">${esc(lead)}</td></tr>
        <tr><td style="font-size:16px;line-height:1.6;color:#4A4440;padding-bottom:28px;">${esc(instruction)}</td></tr>
        <tr><td style="padding-bottom:28px;">
          <a href="${esc(origin)}" style="display:inline-block;background-color:#c23a3a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px;">${esc(buttonLabel)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#8A8078;border-top:1px solid #e8e3dd;padding-top:20px;">
          ${esc(closing)}<br>
          <a href="${esc(origin)}" style="color:#8A8078;word-break:break-all;">${esc(origin)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [lead, '', instruction, '', origin, '', closing].join('\n')

  return { subject, html, text }
}

/**
 * From `hello@` rather than `noreply@`, with a Reply-To a person reads — the
 * same pair the sign-in code mail settled on (send-code.ts): an unattended
 * mailbox name is a small negative deliverability signal, and somebody who
 * replies "who are you" to a family invite deserves an answer.
 */
const FAMILY_FROM = (process.env.FAMILY_EMAIL_FROM || process.env.SIGNIN_EMAIL_FROM || 'SaySomethingin <hello@contact.saysomethingin.app>').trim()
const FAMILY_REPLY_TO = (process.env.FAMILY_EMAIL_REPLY_TO || process.env.SIGNIN_EMAIL_REPLY_TO || 'admin@saysomethingin.com').trim()

export interface SendFamilyInviteResult {
  sent: boolean
  id?: string
  error?: string
}

/**
 * Best-effort by design: the invite row is already written and valid when
 * this runs, so a mail failure must never fail the invite. The caller reports
 * `emailed` and carries on.
 */
export async function sendFamilyInviteEmail(input: FamilyInviteEmailInput): Promise<SendFamilyInviteResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) return { sent: false, error: 'email sender not configured' }

  const { subject, html, text } = renderFamilyInviteEmail(input)
  return postResendEmail(apiKey, {
    from: FAMILY_FROM,
    to: input.address,
    replyTo: FAMILY_REPLY_TO,
    subject,
    html,
    text,
  })
}

// ── THE FAMILY-ENDS MAIL (job #376·F, D6) ────────────────────────────────────
// Sent to each live ADULT member the moment the owner confirms a change from
// Family to Premium — at confirm rather than at the flip, because a person can
// only use a window they know about. Three things and no more: the date, that
// everything they have learned stays, and the app as the door to their own
// Premium at the ordinary price. Never to a child seat (no inbox) and never to
// a pending invitee (they never joined).
//
// THE DATE IS THE COVER END, NOT THE PLAN-CHANGE DATE (Tom, 2026-09-08,
// superseding D8): the paid period plus 30 days. The caller computes it with
// familyGrace.ts and passes it in, so this mail cannot say a different day
// from the one the app shows or the one the resolver enforces.

export interface FamilyEndsEmailInput {
  address: string
  inviterName: string | null
  /**
   * ISO instant the reader's own cover ends — already through
   * familyCoverEndsAt(), i.e. the paid period plus the 30-day grace. Never a
   * raw period end.
   */
  endsAt: string
}

/** "7 October 2026", British, from an ISO instant. */
export function familyEndsDateLabel(endsAt: string): string {
  const d = new Date(endsAt)
  if (Number.isNaN(d.getTime())) return 'the end of the current period'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
}

export function renderFamilyEndsEmail(input: FamilyEndsEmailInput): RenderedEmail {
  const { address, inviterName, endsAt } = input
  const date = familyEndsDateLabel(endsAt)
  const subject = inviterName
    ? `Your place on ${inviterName}'s SaySomethingin family plan ends on ${date}`
    : `Your place on a SaySomethingin family plan ends on ${date}`

  const lead = inviterName
    ? `${inviterName} is changing their family plan on SaySomethingin, so your place on it ends on ${date}.`
    : `The family plan that covers you on SaySomethingin is changing, so your place on it ends on ${date}.`

  const instruction = `Everything you have learned stays on your account, and you keep full access until then. To keep going after ${date}, take out your own SSi Premium plan at £15 a month — sign in with this email address, ${address}, and choose Premium.`

  const origin = inviteEmailOrigin()
  const buttonLabel = 'Keep going with SSi Premium'
  const closing = 'Nothing has been taken from your account, and nothing will be. If you have a question, reply to this email.'

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#e8e3dd;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8e3dd;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8A8078;padding-bottom:20px;">SaySomethingin</td></tr>
        <tr><td style="font-size:19px;line-height:1.55;color:#2C2622;padding-bottom:20px;">${esc(lead)}</td></tr>
        <tr><td style="font-size:16px;line-height:1.6;color:#4A4440;padding-bottom:28px;">${esc(instruction)}</td></tr>
        <tr><td style="padding-bottom:28px;">
          <a href="${esc(origin)}" style="display:inline-block;background-color:#c23a3a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px;">${esc(buttonLabel)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#8A8078;border-top:1px solid #e8e3dd;padding-top:20px;">
          ${esc(closing)}<br>
          <a href="${esc(origin)}" style="color:#8A8078;word-break:break-all;">${esc(origin)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [lead, '', instruction, '', origin, '', closing].join('\n')
  return { subject, html, text }
}

/** Best-effort, like the invite: the change is already made and true. */
export async function sendFamilyEndsEmail(input: FamilyEndsEmailInput): Promise<SendFamilyInviteResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) return { sent: false, error: 'email sender not configured' }

  const { subject, html, text } = renderFamilyEndsEmail(input)
  return postResendEmail(apiKey, {
    from: FAMILY_FROM,
    to: input.address,
    replyTo: FAMILY_REPLY_TO,
    subject,
    html,
    text,
  })
}
