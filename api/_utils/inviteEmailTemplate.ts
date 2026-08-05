/**
 * The branded org-invite email — the mail an invitee actually receives.
 *
 * Why this exists: the mail used to be Supabase's stock invite template, which
 * reads "You have been invited to create a user on https://saysomethingin.app"
 * — machine copy that names neither the person inviting nor the thing they are
 * being invited to. Founder ruling 2026-08-05: it should read like a real
 * invitation — "Deborah invited you to join Seaside Model School" — so we own
 * the whole mail and send it ourselves (via Resend; see sendInviteEmail.ts).
 *
 * House style, from the Mist palette (styles/design-tokens.css): warm-grey
 * canvas, white card, ink text, ONE accent (--ssi-red #c23a3a). Email-client
 * safe: tables, inline styles, no external CSS, no web fonts, no dark mode.
 * British English, one warm sentence, one button, and a plain-text fallback of
 * the raw URL for clients that strip buttons.
 */

export interface InviteEmailContext {
  /** Display name of the person doing the inviting, when we know it. */
  inviterName?: string | null
  /** The org / school / class node they are being invited into. */
  orgName?: string | null
  /** The link. This IS the invite — clicking it signs them in and enrols them. */
  url: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** Email bodies are HTML — never interpolate a name without escaping it. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Blank, whitespace and the literal string "undefined" are all "we don't know". */
function clean(v: string | null | undefined): string | null {
  const s = (v || '').trim()
  if (!s || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null
  return s
}

/**
 * The invitation, in words.
 *
 * Both names → "Deborah invited you to join Seaside Model School".
 * Org only  → "You've been invited to join Seaside Model School" (never an
 *             empty name, a raw email address, or "undefined").
 * Neither   → "You've been invited to SaySomethingin" — the floor, still a
 *             real sentence.
 */
export function renderInviteEmail(ctx: InviteEmailContext): RenderedEmail {
  const inviter = clean(ctx.inviterName)
  const org = clean(ctx.orgName)
  const { url } = ctx

  const subject = inviter && org
    ? `${inviter} invited you to join ${org}`
    : org
      ? `You've been invited to join ${org}`
      : `You've been invited to SaySomethingin`

  const lead = inviter && org
    ? `${esc(inviter)} has invited you to join <strong>${esc(org)}</strong> on SaySomethingin.`
    : org
      ? `You've been invited to join <strong>${esc(org)}</strong> on SaySomethingin.`
      : `You've been invited to start learning with SaySomethingin.`

  const leadText = inviter && org
    ? `${inviter} has invited you to join ${org} on SaySomethingin.`
    : org
      ? `You've been invited to join ${org} on SaySomethingin.`
      : `You've been invited to start learning with SaySomethingin.`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#e8e3dd;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8e3dd;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8A8078;padding-bottom:20px;">SaySomethingin</td></tr>
        <tr><td style="font-size:19px;line-height:1.55;color:#2C2622;padding-bottom:28px;">${lead}</td></tr>
        <tr><td style="padding-bottom:28px;">
          <a href="${esc(url)}" style="display:inline-block;background-color:#c23a3a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px;">Accept the invitation</a>
        </td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#4A4440;padding-bottom:20px;">One tap and you're in — there's no code to type and no password to set.</td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#8A8078;border-top:1px solid #e8e3dd;padding-top:20px;">
          If the button doesn't work, copy this link into your browser:<br>
          <a href="${esc(url)}" style="color:#8A8078;word-break:break-all;">${esc(url)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    leadText,
    '',
    'Accept the invitation:',
    url,
    '',
    "One tap and you're in — there's no code to type and no password to set.",
  ].join('\n')

  return { subject, html, text }
}
