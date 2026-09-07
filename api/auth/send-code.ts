/**
 * POST /api/auth/send-code — mail somebody their six-digit sign-in code.
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * Every sign-in screen used to call `supabase.auth.signInWithOtp()` straight
 * from the browser, which mails Supabase Auth's magic-link template. That
 * template lives in the hosted dashboard, not in this repo, and it cannot
 * carry a text/plain alternative or a Reply-To — two of the things the
 * deliverability fix actually needs (see signInCodeEmail.ts for the evidence).
 *
 * So we do here exactly what sendInviteEmail.ts already does for invites: ask
 * Supabase's admin API to MINT without sending (`generateLink`), then write
 * and post our own mail through Resend. Same proven shape, one more caller.
 *
 * `generateLink({ type: 'magiclink' })` returns `properties.email_otp` — the
 * same six digits `signInWithOtp` would have mailed — and the client verifies
 * it with the unchanged `verifyOtp({ type: 'email' })`. Verified live against
 * the production project 2026-09-02: minting for an address with no account
 * CREATES the account, so this matches `signInWithOtp`'s default
 * `shouldCreateUser: true` and no sign-up path regresses.
 *
 * FAILS SOFT, ALWAYS. The client helper (sendSignInCode.ts) falls back to
 * `signInWithOtp` on any non-200, so a missing RESEND_API_KEY, a Resend
 * outage or an un-deployed route degrades to exactly today's behaviour — an
 * uglier email, never a locked-out teacher.
 *
 * RATE LIMITING IS NOT OPTIONAL HERE. Going around `signInWithOtp` also goes
 * around GoTrue's own per-address email throttle, so without this the route is
 * an open mail faucet pointed at any address on the internet. It reuses the
 * house limiter shape and the existing `possession_mint_attempts` table with a
 * `signincode:` hash namespace, so its rows can never be counted by the
 * redemption or mint limiters (same argument as mintRateLimit.ts).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_utils/cors'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { getClientIp } from '../_utils/codeAttemptThrottle'
import { renderSignInCodeEmail } from '../_utils/signInCodeEmail'
import { postResendEmail } from '../_utils/resendMail'
import { retryAfterMs, describeWait } from '../_utils/sendCodeWait'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * `contact.saysomethingin.app` is the domain verified in Resend and the one
 * SPF and DKIM already authenticate — the From address must stay on it or the
 * fix undoes itself. The local part moves off `noreply@`: an unattended
 * mailbox name is a small negative signal and leaves a reply nowhere to go.
 */
const SIGNIN_FROM = (process.env.SIGNIN_EMAIL_FROM || 'SaySomethingin <hello@contact.saysomethingin.app>').trim()

/** A mailbox a person actually reads. Env-overridable so it can be moved without a deploy. */
const SIGNIN_REPLY_TO = (process.env.SIGNIN_EMAIL_REPLY_TO || 'admin@saysomethingin.com').trim()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The rolling window every limit below is counted over. The refusal sentence
 *  QUOTES this rather than restating it in prose — retune it here and the words
 *  a person reads move with it (sendCodeWait.ts). */
const WINDOW_MS = 15 * 60 * 1000
/** Per address: a person who genuinely lost the mail asks two or three times, not six. */
export const SEND_CODE_PER_ADDRESS_LIMIT = 5
/** Per network: a whole school shares one NAT, so this is generous on purpose. */
export const SEND_CODE_PER_IP_LIMIT = 60

const SEND_OUTCOME = 'signin_code_sent'
const RATE_LIMITED_ADDRESS = 'rate_limited_signin_code_address'
const RATE_LIMITED_IP = 'rate_limited_signin_code_ip'

/**
 * Namespaced, truncated sha256 of the PLATFORM-ATTESTED client IP
 * (`getClientIp` — x-vercel-forwarded-for, then the raw socket; never a
 * client-settable `x-forwarded-for`, per SEC0901-A-04). The `signincode:`
 * namespace keeps these rows out of the redemption and mint limiters' counts
 * and theirs out of ours, exactly as mintRateLimit.ts argues.
 */
export function signInCodeHash(value: string): string {
  return createHash('sha256').update(`signincode:${value}`).digest('hex').slice(0, 16)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cross-origin (native shell) policy + preflight. No-op same-origin.
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const raw = (req.body || {}).email
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please check the email address.' })

  const resendKey = (process.env.RESEND_API_KEY || '').trim()
  // Not configured — say so plainly so the client falls back to Supabase's
  // mailer rather than leaving somebody staring at a code entry box.
  if (!resendKey || !supabaseUrl || !supabaseServiceKey) {
    return res.status(503).json({ error: 'Code sender not configured', fallback: true })
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const ipHash = signInCodeHash(getClientIp(req))
  const since = new Date(Date.now() - WINDOW_MS).toISOString()

  /**
   * How many sends are in the window, and WHEN the oldest of them happened —
   * the oldest is the one that ages out, so it is the moment the door reopens.
   * One round trip, same query, one extra column: the refusal can quote a real
   * number instead of a hand-written guess (see sendCodeWait.ts).
   */
  const attemptsSince = async (
    column: 'ip_hash' | 'email',
    value: string,
  ): Promise<{ count: number; oldestAt: number | null } | null> => {
    const { data, count, error } = await svc
      .from('possession_mint_attempts')
      .select('created_at', { count: 'exact' })
      .eq(column, value)
      .in('outcome', [SEND_OUTCOME])
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) return null
    const oldest = (data as { created_at?: string }[] | null)?.[0]?.created_at
    const oldestAt = oldest ? Date.parse(oldest) : null
    return { count: count ?? 0, oldestAt: oldestAt !== null && Number.isFinite(oldestAt) ? oldestAt : null }
  }

  /** 429 with the wait quoted from the window itself, plus the machine-readable header. */
  const refuse = (oldestAt: number | null, sentence: (wait: string) => string) => {
    const waitMs = retryAfterMs(oldestAt, WINDOW_MS)
    const seconds = Math.max(1, Math.ceil(waitMs / 1000))
    res.setHeader('Retry-After', String(seconds))
    return res.status(429).json({ error: sentence(describeWait(waitMs)), retryAfterSeconds: seconds })
  }

  const log = async (outcome: string, resendMessageId?: string): Promise<void> => {
    try {
      await svc.from('possession_mint_attempts').insert({
        invite_code_id: null,
        ip_hash: ipHash,
        email,
        auth_user_id: null,
        outcome,
        resend_message_id: resendMessageId ?? null,
      })
    } catch { /* observability must never break a sign-in */ }
  }

  // Counting failures fail OPEN — an infra blip on the audit table must not
  // stop a teacher signing in — but a real over-limit is refused.
  const address = await attemptsSince('email', email)
  if (address !== null && address.count >= SEND_CODE_PER_ADDRESS_LIMIT) {
    await log(RATE_LIMITED_ADDRESS)
    return refuse(address.oldestAt, (wait) =>
      `We've sent a few codes to that address already, and the last one may still be on its way. Look for that one first — we can send another ${wait}.`)
  }
  const network = await attemptsSince('ip_hash', ipHash)
  if (network !== null && network.count >= SEND_CODE_PER_IP_LIMIT) {
    await log(RATE_LIMITED_IP)
    return refuse(network.oldestAt, (wait) =>
      `A lot of codes have gone out from this network already. We can send another ${wait}.`)
  }

  // Mint the code without sending. No Supabase template is involved.
  let code = ''
  try {
    const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
    if (error) return res.status(502).json({ error: error.message, fallback: true })
    code = (data as { properties?: { email_otp?: string } } | null)?.properties?.email_otp || ''
    if (!code) return res.status(502).json({ error: 'Could not create a sign-in code', fallback: true })
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Could not create a sign-in code', fallback: true })
  }

  const { subject, html, text } = renderSignInCodeEmail(code, email)
  // The POST lives in resendMail.ts, shared with the invite senders. It also
  // returns Resend's message id, the ONLY join key between our audit row and
  // Resend's later delivered/delayed/bounced webhooks — recorded below, but
  // never allowed to fail a send over a surprising accept body.
  const posted = await postResendEmail(resendKey, {
    from: SIGNIN_FROM, to: email, replyTo: SIGNIN_REPLY_TO, subject, html, text,
  })
  if (!posted.sent) {
    // The code is already minted and valid, but the mail did not go. The
    // fallback re-mints and sends via Supabase — the old ugly mail beats none.
    return res.status(502).json({ error: posted.error || 'send failed', fallback: true })
  }
  const resendMessageId = posted.id || ''

  await log(SEND_OUTCOME, resendMessageId || undefined)
  return res.status(200).json({ sent: true })
}
