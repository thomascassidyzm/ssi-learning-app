/**
 * The sign-in code email — the mail a learner or teacher actually receives
 * when they ask for a six-digit code.
 *
 * WHY THIS FILE EXISTS (2026-09-02)
 * ---------------------------------
 * Welsh school (Hwb) domains were completing sign-in 40-45% of the time
 * against 94% for gmail/hotmail. Resend accepted every send, SPF and DKIM
 * pass, and the same Hwb domain took delivery from us hours earlier — so it
 * is not a block and not a sending bug. What was left is CONTENT SCORING:
 * the old mail was Supabase Auth's magic-link template, customised down to a
 * subject line, six bare digits and nothing else. That is the canonical shape
 * of an OTP blast, which is exactly what Microsoft's filters are tuned to bin.
 *
 * So the words here are deliberate, not decoration. Every one of these is a
 * scoring signal as much as a courtesy:
 *  - real sentences, in a real voice, saying who we are and what the code is for
 *  - a genuine text/plain part alongside the HTML (a missing plain-text
 *    alternative is itself a signal — Resend sends multipart/alternative when
 *    given both)
 *  - one real link, to the real site. No link at all scores as badly as ten
 *  - the address the code was requested for, named in the body
 *  - a reply path a human actually answers
 *
 * AND WHAT IS DELIBERATELY ABSENT: no tracking pixel, no click-wrapped or
 * shortened links, no redirect domain. Every one of those costs deliverability,
 * which is the thing being fixed. If someone later asks for open tracking on
 * this mail, the answer is no — see the census that produced this file.
 *
 * NO MAGIC LINK IN HERE, ON PURPOSE. We hold the action_link server-side and
 * never mail it: Microsoft Defender's Safe Links PREFETCHES URLs in scanned
 * mail, and a prefetched single-use sign-in link is a consumed sign-in link.
 * The code survives a scanner; a link does not.
 *
 * House style is the invite mail's (inviteEmailTemplate.ts): Mist palette,
 * tables and inline styles, no web fonts, no external CSS, no dark-mode
 * variants, British English.
 *
 * LANGUAGE: English only, deliberately. The audience skews Welsh schools, but
 * an Hwb address tells you the school is in Wales — it does NOT tell you the
 * school is Welsh-medium, since English-medium Welsh schools sit on the same
 * domains. There is no clean signal to branch on, and this is outward-facing
 * copy in a language the founders speak, so a guessed Welsh version would be
 * worse than an English one they have approved.
 */

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The subject deliberately carries NO digits. A subject that is a bare
 * six-digit string is one of the loudest OTP-blast tells there is; the code
 * belongs in the body, where iOS and Android security-code autofill read it
 * from anyway.
 */
export const SIGN_IN_SUBJECT = 'Your sign-in code for SaySomethingin'

/** The site — one link, no wrapper, no redirect. */
export const SITE_URL = 'https://www.saysomethingin.com'

/**
 * How long a code lasts, in words.
 *
 * This is Supabase Auth's `MAILER_OTP_EXP` for this project, which lives in
 * the hosted dashboard rather than in this repo, so it was measured rather
 * than read. Live against production, 2026-09-02: a minted code still
 * verified at 11 minutes and was refused at 62 — consistent with GoTrue's
 * one-hour default, and with the "expires in about an hour" already used for
 * admin-issued sign-in links. SchoolsContainer.vue said "10 minutes"; that
 * was wrong and is corrected in the same commit. One string, one place to
 * change it if the dashboard value is ever adjusted.
 */
export const CODE_LIFETIME = 'about an hour'

/**
 * @param code The six digits the person types in.
 * @param recipient The address that asked for it — named in the body, both
 *   because it is the honest personalisation available at send time (no name
 *   lookup, nothing to leak, works for someone signing up for the first time)
 *   and because "this was sent to YOU, at THIS address" is what a phishing
 *   mail cannot say.
 */
export function renderSignInCodeEmail(code: string, recipient: string): RenderedEmail {
  const lines = {
    lead: `Someone asked to sign in to SaySomethingin using ${recipient}, so here is the code to type in.`,
    afterCode: `Type it into the sign-in screen and you're in. The code works once, and it expires ${CODE_LIFETIME} after this email was sent. If it has expired, just ask for another and we'll send a fresh one straight away.`,
    notYou: "If you didn't ask to sign in, you don't need to do anything — nobody can get into an account without this code, and we won't email you again unless you ask us to.",
    help: 'If you get stuck, reply to this email. A person reads them.',
    signoff: 'SaySomethingin',
    tagline: 'Learn to speak a new language out loud, from the first lesson.',
    footer: `This message was sent to ${recipient} because that address was typed into the sign-in screen at saysomethingin.app.`,
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(SIGN_IN_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background-color:#e8e3dd;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8e3dd;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8A8078;padding-bottom:20px;">SaySomethingin</td></tr>
        <tr><td style="font-size:17px;line-height:1.6;color:#2C2622;padding-bottom:24px;">${esc(lines.lead)}</td></tr>
        <tr><td align="center" style="padding-bottom:8px;">
          <div style="display:inline-block;background-color:#f4f1ed;border-radius:10px;padding:18px 28px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.14em;color:#2C2622;">${esc(code)}</div>
        </td></tr>
        <tr><td align="center" style="font-size:13px;line-height:1.6;color:#8A8078;padding-bottom:24px;">Your sign-in code</td></tr>
        <tr><td style="font-size:15px;line-height:1.65;color:#4A4440;padding-bottom:18px;">${esc(lines.afterCode)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.65;color:#4A4440;padding-bottom:18px;">${esc(lines.notYou)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.65;color:#4A4440;padding-bottom:24px;">${esc(lines.help)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.65;color:#2C2622;border-top:1px solid #e8e3dd;padding-top:22px;">
          ${esc(lines.signoff)}<br>
          <span style="color:#8A8078;">${esc(lines.tagline)}</span><br>
          <a href="${SITE_URL}" style="color:#c23a3a;text-decoration:underline;">www.saysomethingin.com</a>
        </td></tr>
        <tr><td style="font-size:12px;line-height:1.6;color:#8A8078;padding-top:20px;">${esc(lines.footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    lines.lead,
    '',
    'Your sign-in code is:',
    '',
    code,
    '',
    lines.afterCode,
    '',
    lines.notYou,
    '',
    lines.help,
    '',
    lines.signoff,
    lines.tagline,
    SITE_URL,
    '',
    lines.footer,
  ].join('\n')

  return { subject: SIGN_IN_SUBJECT, html, text }
}
