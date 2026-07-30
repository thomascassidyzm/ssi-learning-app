/**
 * Shared audio access utilities — the ONE place that decides which
 * `course_audio` / `shared_audio` row an audioId resolves to, and whether a
 * given caller is entitled to it.
 *
 * Extracted from `api/audio/[audioId].ts` (the streaming proxy) so
 * `api/audio/batch-urls.ts` (bulk presigned-URL issuance for offline
 * download) applies EXACTLY the same entitlement rule without a second,
 * divergent implementation. No behaviour change versus the original inline
 * logic — see git history on `api/audio/[audioId].ts` for the pre-extraction
 * version if you need to diff.
 */

import type { VercelRequest } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { S3Client } from '@aws-sdk/client-s3'
import { createHmac, timingSafeEqual } from 'crypto'

// ── Supabase ─────────────────────────────────────────────────────────────

export const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAnonKeyFallback = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

/** Service-role Supabase client (falls back to anon key, matching the pre-extraction behaviour). */
export function createServiceSupabaseClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKeyFallback)
}

// ── S3 ───────────────────────────────────────────────────────────────────

const s3Region = (process.env.AWS_REGION || process.env.VITE_S3_REGION || 'eu-west-1').trim()
export const s3Client = new S3Client({
  region: s3Region,
  credentials: {
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || '').trim(),
  },
})
export const s3Bucket = (process.env.S3_AUDIO_BUCKET || process.env.VITE_S3_AUDIO_BUCKET || 'ssi-audio-stage').trim()

// ── course_audio / shared_audio row shape ───────────────────────────────

export interface AudioRecord {
  id: string
  s3_key: string
  duration_ms: number
}

export type AudioRow = {
  id: string
  s3_key: string
  duration_ms: number
  course_code?: string | null
  lego_id?: string | null
}

/**
 * Runtime validator for the course_audio/shared_audio row shape. Returns the
 * typed row on success, or a diagnostic message describing what's wrong —
 * the tripwire for silent schema drift (renamed s3_key, dropped id/duration_ms).
 */
export function validateAudioRecord(row: unknown): { ok: true; value: AudioRecord } | { ok: false; reason: string } {
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: `expected object, got ${row === null ? 'null' : typeof row}` }
  }
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) {
    return { ok: false, reason: `id missing or not a string (got ${typeof r.id})` }
  }
  if (typeof r.s3_key !== 'string' || !r.s3_key) {
    return { ok: false, reason: `s3_key missing or not a string (got ${typeof r.s3_key}) — schema change?` }
  }
  if (typeof r.duration_ms !== 'number') {
    return { ok: true, value: { id: r.id, s3_key: r.s3_key, duration_ms: 0 } }
  }
  return { ok: true, value: { id: r.id, s3_key: r.s3_key, duration_ms: r.duration_ms } }
}

/** Strict UUID format check, shared by both endpoints. */
export function isValidAudioId(audioId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(audioId)
}

/**
 * Look up a single audioId: `course_audio` first (vast majority of plays),
 * falling back to `shared_audio` (cross-course meta content, never premium).
 */
export async function lookupAudioRecord(
  supabase: SupabaseClient,
  audioId: string
): Promise<{ row: AudioRow | null; fromCourseAudio: boolean; error: { message?: string } | null }> {
  let row: AudioRow | null = null
  let error: { message?: string } | null = null
  let fromCourseAudio = false

  const r = await supabase
    .from('course_audio')
    .select('id, s3_key, duration_ms, course_code, lego_id')
    .eq('id', audioId)
    .maybeSingle()
  row = r.data as AudioRow | null
  error = r.error
  if (row) fromCourseAudio = true

  if (!row) {
    const shared = await supabase
      .from('shared_audio')
      .select('id, s3_key, duration_ms')
      .eq('id', audioId)
      .maybeSingle()
    row = shared.data as AudioRow | null
    if (!row) error = shared.error || error
  }

  return { row, fromCourseAudio, error }
}

/**
 * Batch lookup for many audioIds: ONE in-list query against `course_audio`,
 * then a second in-list query against `shared_audio` for whatever's left —
 * two round trips total regardless of how many ids are requested, instead of
 * up to 2×N (the per-id lookup above, called N times).
 */
export async function lookupAudioRecordsBatch(
  supabase: SupabaseClient,
  audioIds: string[]
): Promise<Map<string, { row: AudioRow; fromCourseAudio: boolean }>> {
  const results = new Map<string, { row: AudioRow; fromCourseAudio: boolean }>()
  if (audioIds.length === 0) return results

  const { data: courseRows } = await supabase
    .from('course_audio')
    .select('id, s3_key, duration_ms, course_code, lego_id')
    .in('id', audioIds)

  for (const row of (courseRows || []) as AudioRow[]) {
    results.set(row.id, { row, fromCourseAudio: true })
  }

  const missingIds = audioIds.filter((id) => !results.has(id))
  if (missingIds.length > 0) {
    const { data: sharedRows } = await supabase
      .from('shared_audio')
      .select('id, s3_key, duration_ms')
      .in('id', missingIds)
    for (const row of (sharedRows || []) as AudioRow[]) {
      results.set(row.id, { row, fromCourseAudio: false })
    }
  }

  return results
}

// ── Entitlement gate (premium-past-preview only) ────────────────────────
//
// CANONICAL pricing model: a course is PREMIUM when its target language is in
// the Big-10 OR Welsh (cym); premium content is free to the end of Yellow
// (seed 19) and paywalled from Orange (seed 20) onward. Everything else is free
// on all belts. A paid account (learner / tutor-student / school-student) or a
// valid time-boxed try-link unlocks all premium content past Yellow.

export const PREMIUM_PREVIEW_MAX_SEED = 19 // Yellow belt — keep in sync with @ssi/core PREMIUM_PREVIEW_MAX_SEED
export const BIG_10 = ['eng', 'spa', 'fra', 'deu', 'ita', 'por', 'zho', 'jpn', 'ara', 'kor']

// Strict mode (opt-in via env) FAILS CLOSED on premium-past-preview when no
// valid entitlement is presented. DEFAULT is fail-OPEN so this code can NOT
// lock out a single live payer before the client begins attaching
// entitlement tokens to audio requests.
export const ENTITLEMENT_STRICT = (process.env.ENTITLEMENT_ENFORCE || '').trim().toLowerCase() === 'strict'

// Entitlement tokens get their OWN dedicated HMAC secret. We deliberately do
// NOT fall back to SUPABASE_SERVICE_ROLE_KEY: that would repurpose an
// all-powerful DB credential to sign low-value, widely-distributed tokens and
// couple two very different trust tiers (rotating one would force rotating the
// other). Mint side: api/try-link/validate.ts reads the same env var the same
// way — the two MUST stay identical or tokens fail to verify.
const entitlementSecret = (process.env.ENTITLEMENT_TOKEN_SECRET || '').trim()
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
if (IS_PROD && !entitlementSecret) {
  // Fail LOUD, not silent (matches the cron CRON_SECRET posture): in production
  // the dedicated secret MUST be set. verifyEntitlementToken() below refuses
  // (returns null) without it, so no token can verify — surface the
  // misconfiguration rather than swallow it.
  console.error(
    '[audioAccess] ENTITLEMENT_TOKEN_SECRET not configured in production — entitlement tokens will NOT verify'
  )
}

// FAMILY-PLAN-SPEC.md §3 future-proofing note: the only mint site today is
// api/try-link/validate.ts (link-based, no subscription read — unaffected).
// Whenever a SUBSCRIBER mint site appears and ENTITLEMENT_ENFORCE=strict
// arms, it must resolve entitlement via api/_utils/familyAccess.ts's
// resolveEffectiveSubscription — same as every other entitlement-deciding
// subscriptions reader — so a family member's audio doesn't fail-closed the
// moment strict mode is live.

/** Is this course premium (Big-10 target or Welsh)? Community/other → free. */
export function isPremiumCourse(courseCode: string): boolean {
  if (!courseCode || courseCode.startsWith('community_')) return false
  const target = courseCode.split('_for_')[0]?.toLowerCase() ?? ''
  return BIG_10.includes(target) || target === 'cym'
}

/**
 * Seed number from a lego_id like `S0001L01` → 1, or null if not parseable.
 *
 * CONTRACT (must hold before arming ENTITLEMENT_ENFORCE=strict): the `S####`
 * prefix of lego_id is the SEED ordinal on the SAME scale as
 * PREMIUM_PREVIEW_MAX_SEED / @ssi/core's BELT_MAX_SEEDS (Yellow = 19), NOT a
 * lesson/lego index. Until confirmed, the gate is fail-OPEN and inert, so a
 * mismatch here cannot lock out a live learner.
 */
export function seedFromLegoId(legoId: string | null | undefined): number | null {
  if (!legoId) return null
  const m = /^S(\d+)/i.exec(legoId)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Verify a server-minted entitlement token (HMAC-SHA256, stateless — no DB).
 * Format: `${b64url(payloadJson)}.${b64url(sig)}`. Returns the payload if the
 * signature is valid AND it hasn't expired, else null.
 */
export function verifyEntitlementToken(token: string): { exp?: number; scope?: string; courses?: string[] } | null {
  if (!token || !entitlementSecret) return null
  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payloadPart = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)
  try {
    const expected = createHmac('sha256', entitlementSecret).update(payloadPart).digest()
    const got = b64urlDecode(sigPart)
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
    const payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8'))
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** Does a verified token grant access to this course code? */
export function tokenGrantsCourse(payload: { scope?: string; courses?: string[] }, courseCode: string): boolean {
  if (payload.scope === 'all') return true
  if (Array.isArray(payload.courses)) return payload.courses.includes(courseCode)
  return false
}

export interface AudioEntitlementDecision {
  /** Whether this request should be served the audio (mirrors the single-clip endpoint's fail-open/strict behaviour). */
  allowed: boolean
  /** True when this was a past-preview premium row with no valid grant presented. */
  gated: boolean
  /** Diagnostic tag mirroring the single-clip endpoint's X-SSi-Entitlement header, set only when gated+allowed (fail-open). */
  tag?: 'token-invalid-open' | 'no-token-open'
}

/**
 * The one entitlement decision, shared by the streaming proxy and the batch
 * presigned-URL endpoint. Fast path (shared/meta audio, free courses, preview
 * seeds ≤ Yellow) always returns `allowed: true, gated: false` with zero
 * extra work. Only premium content past Yellow consults the caller's
 * entitlement token (stateless HMAC, no DB hit).
 */
export function resolveAudioEntitlement(
  req: VercelRequest,
  fromCourseAudio: boolean,
  courseCode: string | null | undefined,
  legoId: string | null | undefined
): AudioEntitlementDecision {
  if (!fromCourseAudio) return { allowed: true, gated: false }

  const code = (courseCode || '').trim()
  const seed = seedFromLegoId(legoId)
  const premium = isPremiumCourse(code)
  // We can only gate when we positively know it's premium AND know the seed
  // is past preview. If we can't classify, we FAIL OPEN — never lock out on
  // ambiguity.
  const pastPreview = premium && seed != null && seed > PREMIUM_PREVIEW_MAX_SEED
  if (!pastPreview) return { allowed: true, gated: false }

  // Token may arrive as ?et= (the only channel an <audio> element can use)
  // or an Authorization bearer for fetch-based callers.
  const etParam = typeof req.query.et === 'string' ? req.query.et : ''
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const rawToken = etParam || bearer
  const payload = rawToken ? verifyEntitlementToken(rawToken) : null
  const granted = !!payload && tokenGrantsCourse(payload, code)

  if (granted) return { allowed: true, gated: false }

  if (ENTITLEMENT_STRICT) {
    return { allowed: false, gated: true }
  }
  // DEFAULT (fail-open): do not regress live playback before the client
  // attaches tokens. Caller tags the response so we can observe coverage.
  return { allowed: true, gated: true, tag: rawToken ? 'token-invalid-open' : 'no-token-open' }
}
