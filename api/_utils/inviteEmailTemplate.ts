/**
 * The invite email — the mail an invitee actually receives.
 *
 * FROM NO-ONE, DELIBERATELY. Tom's ruling 2026-08-05: "it shouldn't come from
 * Deborah, it should come from whoever is the person inviting them … OR just
 * no-one … as simple as possible." The first cut took the first branch and
 * signed each mail with the logged-in leader's name and their org. It was
 * never hardcoded to Deborah — she was only the test case — but naming the
 * inviter turned out to be exactly the "hassle" his ruling anticipated: it
 * needed the caller's learners row, a second admin lookup for their email, and
 * a guard against the auth trigger that seeds display_name from the email's
 * local part (which had already put an email fragment in a test inbox once).
 * So the second branch wins on his own terms — one fixed sentence, no lookups,
 * nothing to leak, nothing to get wrong.
 *
 * The sentence is his, verbatim. Do not embellish it.
 *
 * House style, from the Mist palette (styles/design-tokens.css): warm-grey
 * canvas, white card, ink text, ONE accent (--ssi-red #c23a3a). Email-client
 * safe: tables, inline styles, no external CSS, no web fonts, no dark mode.
 * British English, one line, one button, and a plain-text fallback of the raw
 * URL for clients that strip buttons.
 */

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** Email bodies are HTML — never interpolate a URL without escaping it. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SUBJECT = "You've been invited to try SaySomethingin"
const LEAD = "You've been invited to try SaySomethingin — please click to activate your account."

/**
 * @param url The link. This IS the invite — clicking it signs them in and
 *   enrols them, with no code to type.
 */
export function renderInviteEmail(url: string): RenderedEmail {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background-color:#e8e3dd;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8e3dd;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8A8078;padding-bottom:20px;">SaySomethingin</td></tr>
        <tr><td style="font-size:19px;line-height:1.55;color:#2C2622;padding-bottom:28px;">${esc(LEAD)}</td></tr>
        <tr><td style="padding-bottom:28px;">
          <a href="${esc(url)}" style="display:inline-block;background-color:#c23a3a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px;">Activate your account</a>
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
    LEAD,
    '',
    'Activate your account:',
    url,
    '',
    "One tap and you're in — there's no code to type and no password to set.",
  ].join('\n')

  return { subject: SUBJECT, html, text }
}
