/**
 * Player Events Endpoint — batch-insert diagnostic events from the
 * learning player into the player_events table.
 *
 * Frontend buffers events and POSTs in batches (every few seconds).
 * Attribution is by VERIFIED bearer token only (SEC25 INPUT-04) — the
 * `ssi-user-id` cookie is unsigned and is no longer an identity here.
 * Requests without a usable token still insert, unattributed, so guest
 * telemetry keeps flowing. See resolveIdentity() for the one authorised
 * exception (play-as-class).
 *
 * Endpoint: POST /api/player-events
 * Body: { events: [{ event_type, payload?, course_code?, session_id?, occurred_at?, client_version? }] }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from './_utils/auth'
import { resolveVisibleScope } from './_utils/schoolScope'

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
 * Resolve the learner identity to attribute events to (SEC25 INPUT-04).
 *
 * Attribution comes from a VERIFIED `Authorization: Bearer` token only: the
 * auth uid is mapped to `learners.id` (the canonical learner pk) and that is
 * what the row carries. The client-set `ssi-user-id` cookie is NOT an
 * identity — it is unsigned, so trusting it let anyone write telemetry
 * against any learner's uuid through this service-role insert.
 *
 * ONE exception, which is the cookie's real job: play-as-class (owner ruling
 * 2026-07-16) deliberately flips the cookie to the CLASS's own learner id so
 * class practice belongs to the class, not to the staff member driving it.
 * That is honoured only when the caller ALSO presents a verified bearer whose
 * visible scope contains that class — i.e. it is authorised, not asserted.
 *
 * Everything else (no bearer, stale bearer, guest, unknown cookie) attributes
 * to `null` — an unattributed row. Guest telemetry is a legitimate product
 * path and keeps flowing; usePlayerLog still stamps its own `learnerId` into
 * the event payload, so guest runs stay traceable without being trusted.
 */
async function resolveIdentity(
  req: VercelRequest,
  supabase: SupabaseClient,
): Promise<string | null> {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const result = await verifyAuthToken(req)
  if (!result.valid || !result.userId) return null

  // Map the auth uid to the canonical learner pk. Service role read; a
  // learner reads only their own row here (own-row RLS would allow it too).
  const { data, error } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', result.userId)
    .maybeSingle()
  const verifiedLearnerId = !error && data?.id ? (data.id as string) : null

  const cookieId = (req.cookies?.['ssi-user-id'] as string | undefined) || null
  if (!cookieId || !UUID_RE.test(cookieId) || cookieId === verifiedLearnerId) {
    return verifiedLearnerId
  }

  // The cookie names someone else — only a class this caller may drive.
  const authorisedClass = await isAuthorisedClassLearner(supabase, result.userId, cookieId)
  return authorisedClass ? cookieId : verifiedLearnerId
}

/** True iff `classLearnerId` is a class entity inside this staff member's scope. */
async function isAuthorisedClassLearner(
  supabase: SupabaseClient,
  authUserId: string,
  classLearnerId: string,
): Promise<boolean> {
  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .select('id')
      .eq('class_learner_id', classLearnerId)
      .maybeSingle()
    if (error || !cls?.id) return false
    const scope = await resolveVisibleScope(supabase, authUserId)
    return scope.classIds.includes(cls.id as string)
  } catch {
    // Never fail a telemetry batch on an authz lookup — just don't attribute.
    return false
  }
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
        // SEC25 INPUT-09: type-checked and capped, like event_type below —
        // free text from an anonymous caller must not reach the DB unbounded.
        course_code: typeof e.course_code === 'string' ? e.course_code.slice(0, 64) || null : null,
        session_id: sessionId,
        event_type: e.event_type.slice(0, 64),
        payload: sanitizePayload(e.payload),
        client_version: typeof e.client_version === 'string' ? e.client_version.slice(0, 64) || null : null,
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
