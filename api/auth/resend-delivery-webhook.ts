/**
 * POST /api/auth/resend-delivery-webhook — Resend tells us what happened to a
 * sign-in code after it accepted it.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-07 a teacher at a college on a call with Tom did not get her code.
 * Establishing what had happened took a whole forensic session and still ended
 * in a gap: our audit row proves only that Resend ACCEPTED the message in
 * ~270 ms. Everything after that — deferred by the recipient's filter,
 * queued, delivered promptly and simply not noticed — was indistinguishable
 * from outside. Resend's own retrieve API is no help retrospectively: it
 * returns a `last_event` string with no timestamp on it.
 *
 * The webhook does carry timestamps. So we record the Resend message id on the
 * `possession_mint_attempts` row at send time (see send-code.ts) and stamp
 * this row when Resend reports delivered / delayed / bounced. After that,
 * "was the code slow, and where" is one query:
 *
 *   select email, created_at, delivered_at - created_at as lag,
 *          delivery_delayed_at is not null as was_deferred, bounced_at
 *   from possession_mint_attempts
 *   where outcome = 'signin_code_sent' and created_at > now() - interval '1 day'
 *   order by lag desc nulls first;
 *
 * SIGNATURE IS MANDATORY. This route is public and it writes to a live table,
 * so an unsigned or badly-signed post is refused before anything is read out
 * of the body. Verification is Svix's scheme over the RAW body, which is why
 * the body parser is off.
 *
 * ONE COLUMN PER EVENT, STAMPED WITH RESEND'S OWN TIMESTAMP — never now().
 * Webhooks retry and arrive out of order; writing the event's own time makes
 * a redelivery idempotent, and keeping `delivery_delayed_at` in its own column
 * means a message that was deferred and then delivered still says so.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifySvixSignature } from '../_utils/svixSignature'

// Svix signs the raw bytes. A re-serialised object will not match.
export const config = { api: { bodyParser: false } }

/** Resend event type → the column it stamps. Anything else is acknowledged and dropped. */
export const EVENT_COLUMN: Record<string, string> = {
  'email.delivered': 'delivered_at',
  'email.delivery_delayed': 'delivery_delayed_at',
  'email.bounced': 'bounced_at',
}

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Resend emits two timestamp shapes: strict ISO (`2026-09-07T12:44:02.000Z`)
 * on webhooks and a Postgres-ish one (`2026-09-07 12:44:02.000000+00`) on its
 * list API. `Date` parses the first and not the second, so square them off.
 */
function normaliseTimestamp(raw: string): string {
  if (!raw) return ''
  let s = raw.includes('T') ? raw : raw.replace(' ', 'T')
  s = s.replace(/([+-]\d{2})$/, '$1:00')   // "+00" is not a valid ISO offset; "+00:00" is
  return s
}

/** Pull `(column, isoTimestamp, emailId)` out of a Resend delivery event, or null if it is not one we stamp. */
export function parseDeliveryEvent(payload: unknown): { column: string; at: string; emailId: string } | null {
  const p = payload as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown; created_at?: unknown } } | null
  if (!p || typeof p.type !== 'string') return null
  const column = EVENT_COLUMN[p.type]
  if (!column) return null

  const emailId = p.data && typeof p.data.email_id === 'string' ? p.data.email_id : ''
  if (!emailId) return null

  // Resend's top-level created_at is when the EVENT happened; data.created_at
  // is when the message was created. We want the event.
  const rawAt = typeof p.created_at === 'string' ? p.created_at : ''
  const parsed = new Date(normaliseTimestamp(rawAt))
  const at = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()

  return { column, at, emailId }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const raw = await readRawBody(req).catch(() => '')

  const verdict = verifySvixSignature({
    secret: (process.env.RESEND_WEBHOOK_SECRET || '').trim(),
    body: raw,
    svixId: req.headers['svix-id'] as string | undefined,
    svixTimestamp: req.headers['svix-timestamp'] as string | undefined,
    svixSignature: req.headers['svix-signature'] as string | undefined,
  })
  if (!verdict.ok) return res.status(401).json({ error: 'Invalid signature' })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return res.status(400).json({ error: 'Malformed body' })
  }

  const event = parseDeliveryEvent(payload)
  // 200 on an event we do not stamp (email.sent, email.opened…): Resend should
  // not retry something we deliberately ignore.
  if (!event) return res.status(200).json({ ok: true, stamped: false })

  // Read at call time, not module load: a serverless cold start has env, but a
  // test importing this module statically does not yet.
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!supabaseUrl || !supabaseServiceKey) return res.status(503).json({ error: 'Not configured' })
  const svc = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await svc
    .from('possession_mint_attempts')
    .update({ [event.column]: event.at })
    .eq('resend_message_id', event.emailId)
    .select('id')

  // 500 on a write failure so Resend retries; the event is not lost to a blip.
  if (error) return res.status(500).json({ error: 'Could not record event' })

  return res.status(200).json({ ok: true, stamped: (data || []).length })
}
