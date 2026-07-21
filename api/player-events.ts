/**
 * Player Events Endpoint — batch-insert diagnostic events from the
 * learning player into the player_events table.
 *
 * Frontend buffers events and POSTs in batches (every few seconds).
 * Auth is by the same `ssi-user-id` cookie that audio_plays uses; the
 * server doesn't strictly verify (anyone can spoof) but for diagnostic
 * use that's fine — nobody benefits from injecting fake logs into
 * their own row.
 *
 * Endpoint: POST /api/player-events
 * Body: { events: [{ event_type, payload?, course_code?, session_id?, occurred_at?, client_version? }] }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from './_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

interface IncomingEvent {
  event_type: string
  payload?: unknown
  course_code?: string | null
  session_id?: string | null
  occurred_at?: string | null
  client_version?: string | null
}

function getDeviceType(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  const ua = userAgent.toLowerCase()
  if (/ipad|android(?!.*mobile)|tablet/i.test(ua)) return 'tablet'
  if (/iphone|ipod|android.*mobile|webos|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

/**
 * Deployment environment, derived SERVER-SIDE from the request host so it
 * can't be spoofed by the client and there's one source of truth.
 *   saysomethingin.app          -> 'production'
 *   staging.saysomethingin.app  -> 'staging'
 *   anything else               -> 'dev'  (vercel preview alias, localhost)
 * Prefer the Host header; fall back to the Origin host.
 */
function getEnv(host: string | undefined, origin: string | undefined): 'production' | 'staging' | 'dev' {
  let h = (host || '').toLowerCase().trim()
  if (!h && origin) {
    try {
      h = new URL(origin).host.toLowerCase()
    } catch {
      /* ignore malformed origin */
    }
  }
  // strip any :port
  h = h.replace(/:\d+$/, '')
  if (h === 'staging.saysomethingin.app') return 'staging'
  if (h === 'saysomethingin.app' || h === 'www.saysomethingin.app') return 'production'
  return 'dev'
}

const MAX_BATCH = 50

// Cap the serialized payload so a client can't stuff arbitrarily large blobs
// into a service-role insert. 8 KB is generous for a diagnostic event.
const MAX_PAYLOAD_BYTES = 8 * 1024

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve the learner identity to attribute events to.
 *
 * If the request carries a valid `Authorization: Bearer` token we VERIFY it and
 * map the auth uid → `learners.id` (the canonical learner pk), and use that,
 * ignoring the client-set `ssi-user-id` cookie entirely — a verified session is
 * the trusted source of identity, so an authenticated client can no longer spoof
 * attribution by setting a different cookie.
 *
 * Only when there is no usable verified identity (no bearer, invalid token, or
 * no learner row maps to the auth uid) do we fall back to the cookie path:
 * a shape-valid uuid cookie, else `null`. Guests legitimately log with a
 * `null` identity (a `guest-<uuid>` cookie is not a uuid and coerces to null).
 */
async function resolveIdentity(
  req: VercelRequest,
  supabase: SupabaseClient,
): Promise<string | null> {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const result = await verifyAuthToken(req)
    if (result.valid && result.userId) {
      // Map the auth uid to the canonical learner pk. Service role read; a
      // learner reads only their own row here (own-row RLS would allow it too).
      const { data, error } = await supabase
        .from('learners')
        .select('id')
        .eq('user_id', result.userId)
        .maybeSingle()
      if (!error && data?.id) return data.id as string
      // Verified session but no learner row — fall through to the cookie/null
      // path rather than attributing to an id we couldn't confirm.
    }
    // Invalid/expired bearer: fall through to the cookie/null path (tolerant —
    // a stale token must not drop the event, only forfeit the trusted upgrade).
  }

  const rawUserId = (req.cookies?.['ssi-user-id'] as string | undefined) || null
  return rawUserId && UUID_RE.test(rawUserId) ? rawUserId : null
}

/** Serialized-size-bounded payload. Oversized payloads collapse to a marker. */
function sanitizePayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null
  try {
    const serialized = JSON.stringify(payload)
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      return { _truncated: true, _bytes: serialized.length }
    }
    return payload
  } catch {
    // Non-serializable (circular, BigInt, …) — drop rather than 500 the insert.
    return null
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse | void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Service role key not configured' })
  }

  const body = req.body as { events?: unknown } | undefined
  const events = Array.isArray(body?.events) ? (body!.events as IncomingEvent[]) : null
  if (!events || events.length === 0) {
    return res.status(400).json({ error: 'events array required' })
  }
  if (events.length > MAX_BATCH) {
    return res.status(400).json({ error: `batch too large (max ${MAX_BATCH})` })
  }

  const supabase = createClient(supabaseUrl!, supabaseServiceKey)

  // Trusted identity from a verified session when present; else cookie/null.
  const userId = await resolveIdentity(req, supabase)
  const deviceType = getDeviceType(req.headers['user-agent'] || '')
  const ipCountry = (req.headers['x-vercel-ip-country'] as string) || null
  const env = getEnv(req.headers['host'] as string | undefined, req.headers['origin'] as string | undefined)

  const rows = events
    .filter((e) => e && typeof e.event_type === 'string' && e.event_type.length > 0)
    .map((e) => {
      // Per-event sanitization: drop invalid FIELDS, never the whole batch.
      // A single bad occurred_at/session_id must not poison the other 49 rows
      // (a client retrying the same buffer would lose that telemetry forever).
      const occurredAt =
        typeof e.occurred_at === 'string' && !Number.isNaN(Date.parse(e.occurred_at))
          ? e.occurred_at
          : new Date().toISOString()
      const sessionId =
        typeof e.session_id === 'string' && UUID_RE.test(e.session_id) ? e.session_id : null
      return {
        occurred_at: occurredAt,
        // Identity Phase 1 (expand): dual-write both. user_id is the legacy name
        // (it holds the learner pk, not the auth uid); learner_id is the canonical
        // one. Readers migrate to learner_id only after this dual-write reaches
        // prod; user_id is dropped later (contract). See migration
        // 20260619_player_events_learner_id_expand.sql.
        user_id: userId,
        learner_id: userId,
        course_code: e.course_code || null,
        session_id: sessionId,
        event_type: e.event_type.slice(0, 64),
        payload: sanitizePayload(e.payload),
        client_version: e.client_version || null,
        device_type: deviceType,
        ip_country: ipCountry,
        env,
      }
    })

  if (rows.length === 0) {
    return res.status(400).json({ error: 'no valid events' })
  }

  try {
    const { error } = await supabase.from('player_events').insert(rows)
    if (error) {
      // Log the real detail server-side; return a generic message so raw
      // PostgREST/Postgres text never leaks to an unauthenticated caller.
      console.warn('[player-events] insert failed:', error.message, error.code)
      return res.status(500).json({ error: 'insert failed' })
    }
    return res.status(200).json({ inserted: rows.length })
  } catch (err: any) {
    console.error('[player-events] threw:', err)
    return res.status(500).json({ error: 'insert failed' })
  }
}
