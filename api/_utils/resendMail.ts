/**
 * postResendEmail — the estate's ONE place that knows how to hand a message
 * to Resend.
 *
 * Two routes already posted to `https://api.resend.com/emails` with their own
 * hand-rolled fetch: `sendInviteEmail.ts` (the org invite) and
 * `api/auth/send-code.ts` (the six-digit sign-in code). Adding the family
 * invite as a third copy would have made the provider's URL, auth header,
 * body shape and error wording live in three files at once — so this is the
 * shared utility all three now call. It carries no policy of its own: the
 * From address, the Reply-To and the words stay with the caller that owns
 * them, because those differ per mail and the transport does not.
 *
 * Deliverability facts it must not undo (docs/email/signin-code-
 * deliverability-2026-09-02.md): every send carries a text/plain alternative
 * alongside the HTML, and the From address stays on
 * `contact.saysomethingin.app`, the only saysomethingin domain verified in
 * Resend (re-checked live 2026-09-07 — SPF/DKIM pass there and nowhere else).
 */

export interface ResendMessage {
  from: string
  to: string
  replyTo?: string
  subject: string
  html: string
  text: string
}

export interface ResendSendResult {
  sent: boolean
  /** Resend's message id — the only join key to its later delivery webhooks. */
  id?: string
  error?: string
}

export async function postResendEmail(
  apiKey: string,
  message: ResendMessage,
): Promise<ResendSendResult> {
  const body: Record<string, unknown> = {
    from: message.from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  }
  if (message.replyTo) body.reply_to = message.replyTo

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { sent: false, error: `email provider refused the send (${res.status}) ${detail}`.trim() }
    }
    // Never fail a DELIVERED send over a surprising accept body — the mail is
    // already gone by this point, so an unreadable id costs us observability,
    // never the send. `Promise.resolve().then` so a body that is not JSON at
    // all (or a stub with no `json`) lands in the catch rather than throwing.
    const accepted = (await Promise.resolve()
      .then(() => res.json())
      .catch(() => null)) as { id?: unknown } | null
    const id = accepted && typeof accepted.id === 'string' ? accepted.id : undefined
    return { sent: true, id }
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'send failed' }
  }
}
