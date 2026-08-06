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
  /** Current revision of this clip; absent on shared_audio, which is not revisioned. */
  audio_revision?: number | null
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

// ── Per-clip versioned audio refs ───────────────────────────────────────
//
// An audio ref is either a bare uuid (meaning "whatever revision is current")
// or a uuid with a revision suffix, `<uuid>.v<N>`, naming one exact revision.
//
// Why the revision rides in the ID rather than in a `?v=` query string:
// there are TWO caches downstream and they key differently. The browser's HTTP
// cache keys by URL — a query string would bust it. But `AudioCache`
// (IndexedDB `ssi-audio-cache-v2`) keys by audio *id*, and never looks at the
// URL at all, so a query string leaves every offline learner on stale bytes
// for good. Versioning the id moves both, because the id IS the cache key and
// it is also the thing every `/api/audio/${id}` call site interpolates. That
// is also why no player code changed for this: the ~12 sites that build audio
// URLs interpolate a string, and the string now carries its own version.
//
// A bare uuid stays valid forever. Only clips that have actually been revised
// ever grow a suffix, so the 2.5M unrevised clips keep their existing URLs and
// nobody re-downloads audio that did not change.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AUDIO_REF_REGEX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.v([1-9][0-9]{0,4}))?$/i

export interface AudioRef {
  /** The bare row id, always a uuid. */
  id: string
  /** The revision the caller asked for, or null for "current". */
  revision: number | null
}

/**
 * Split an audio ref into its id and requested revision. Returns null if the
 * ref is not a well-formed uuid or `uuid.vN`.
 */
export function parseAudioRef(ref: string): AudioRef | null {
  const m = AUDIO_REF_REGEX.exec(ref)
  if (!m) return null
  return { id: m[1], revision: m[2] ? Number(m[2]) : null }
}

/**
 * Build the learner-facing ref for a clip. Revision 1 (and unknown) stays a
 * bare uuid so existing URLs — and existing cache entries — are untouched.
 */
export function buildAudioRef(id: string, revision: number | null | undefined): string {
  return revision && revision > 1 ? `${id}.v${revision}` : id
}

/** Accepts a bare uuid or a versioned `uuid.vN` ref, shared by both endpoints. */
export function isValidAudioId(audioId: string): boolean {
  return AUDIO_REF_REGEX.test(audioId)
}

/** Strict bare-uuid check, for callers that must not accept a version suffix. */
export function isBareUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}

/**
 * Resolve the S3 key for one exact revision of a clip.
 *
 * `course_audio_revisions` is the ledger `services/audio-repair-core.cjs`
 * writes on every accepted swap: one row per swap, carrying both sides of it.
 * So revision N's key is either the `new_s3_key` of the swap that PRODUCED N,
 * or the `previous_s3_key` of the swap that SUPERSEDED it — whichever we find.
 * That is what makes an old URL keep serving its old bytes, which is the free
 * rollback: nothing is deleted, so pointing back at an old ref is enough.
 *
 * If the ledger cannot answer, we fall back to the row's current key rather
 * than failing. A learner hearing the newest good clip is always better than a
 * learner hearing silence — the always-play invariant outranks exactness here.
 */
export async function resolveRevisionS3Key(
  supabase: SupabaseClient,
  audioId: string,
  requestedRevision: number,
  currentRevision: number | null | undefined,
  currentS3Key: string
): Promise<{ s3Key: string; exact: boolean }> {
  if (requestedRevision === (currentRevision ?? 1)) return { s3Key: currentS3Key, exact: true }

  const { data } = await supabase
    .from('course_audio_revisions')
    .select('revision, previous_revision, previous_s3_key, new_s3_key')
    .eq('audio_id', audioId)

  const rows = (data || []) as Array<{
    revision: number | null
    previous_revision: number | null
    previous_s3_key: string | null
    new_s3_key: string | null
  }>

  const produced = rows.find((r) => r.revision === requestedRevision && r.new_s3_key)
  if (produced?.new_s3_key) return { s3Key: produced.new_s3_key, exact: true }

  const superseded = rows.find((r) => r.previous_revision === requestedRevision && r.previous_s3_key)
  if (superseded?.previous_s3_key) return { s3Key: superseded.previous_s3_key, exact: true }

  return { s3Key: currentS3Key, exact: false }
}

/**
 * Look up a single audioId: `course_audio` first (vast majority of plays),
 * falling back to `shared_audio` (cross-course meta content, never premium).
 */
export async function lookupAudioRecord(
  supabase: SupabaseClient,
  audioRef: string
): Promise<{ row: AudioRow | null; fromCourseAudio: boolean; error: { message?: string } | null }> {
  let row: AudioRow | null = null
  let error: { message?: string } | null = null
  let fromCourseAudio = false

  // The ref may carry a revision suffix; the DB is keyed by the bare uuid.
  const parsed = parseAudioRef(audioRef)
  const audioId = parsed ? parsed.id : audioRef

  const r = await supabase
    .from('course_audio')
    .select('id, s3_key, duration_ms, course_code, lego_id, audio_revision')
    .eq('id', audioId)
    .maybeSingle()
  row = r.data as AudioRow | null
  error = r.error
  if (row) fromCourseAudio = true

  if (!row) {
    // shared_audio is cross-course meta content and is not revisioned.
    const shared = await supabase
      .from('shared_audio')
      .select('id, s3_key, duration_ms')
      .eq('id', audioId)
      .maybeSingle()
    row = shared.data as AudioRow | null
    if (!row) error = shared.error || error
  }

  // An explicit revision means "serve exactly these bytes" — the old URL that
  // makes a rollback free. Only consult the ledger when it differs from current.
  if (row && fromCourseAudio && parsed?.revision) {
    const { s3Key } = await resolveRevisionS3Key(
      supabase,
      audioId,
      parsed.revision,
      row.audio_revision,
      row.s3_key
    )
    row = { ...row, s3_key: s3Key }
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
  audioRefs: string[]
): Promise<Map<string, { row: AudioRow; fromCourseAudio: boolean }>> {
  const results = new Map<string, { row: AudioRow; fromCourseAudio: boolean }>()
  if (audioRefs.length === 0) return results

  // Refs may carry revision suffixes. Query on the bare uuids, but key the
  // results by the ref the caller gave us, so the caller can match them up
  // without knowing anything about versioning.
  const byId = new Map<string, string[]>()
  for (const ref of audioRefs) {
    const parsed = parseAudioRef(ref)
    const id = parsed ? parsed.id : ref
    const refs = byId.get(id)
    if (refs) refs.push(ref)
    else byId.set(id, [ref])
  }
  const audioIds = [...byId.keys()]

  const { data: courseRows } = await supabase
    .from('course_audio')
    .select('id, s3_key, duration_ms, course_code, lego_id, audio_revision')
    .in('id', audioIds)

  for (const row of (courseRows || []) as AudioRow[]) {
    for (const ref of byId.get(row.id) || []) {
      results.set(ref, { row, fromCourseAudio: true })
    }
  }

  const missingIds = audioIds.filter((id) => !(byId.get(id) || []).some((ref) => results.has(ref)))
  if (missingIds.length > 0) {
    const { data: sharedRows } = await supabase
      .from('shared_audio')
      .select('id, s3_key, duration_ms')
      .in('id', missingIds)
    for (const row of (sharedRows || []) as AudioRow[]) {
      for (const ref of byId.get(row.id) || []) {
        results.set(ref, { row, fromCourseAudio: false })
      }
    }
  }

  // Pinned revisions resolve against the ledger. Only refs that actually name a
  // non-current revision cost a query, so the common all-current batch stays at
  // the same two round trips it has always been.
  for (const [ref, entry] of results) {
    const parsed = parseAudioRef(ref)
    if (!parsed?.revision || !entry.fromCourseAudio) continue
    if (parsed.revision === (entry.row.audio_revision ?? 1)) continue
    const { s3Key } = await resolveRevisionS3Key(
      supabase,
      parsed.id,
      parsed.revision,
      entry.row.audio_revision,
      entry.row.s3_key
    )
    results.set(ref, { row: { ...entry.row, s3_key: s3Key }, fromCourseAudio: true })
  }

  return results
}

/**
 * Build the id → versioned-ref map for one course.
 *
 * Content routes hand the player audio ids taken from denormalised FK columns
 * (`course_legos.target1_audio_id` and friends), which know nothing about
 * revisions. Rather than join every one of those against `course_audio`, we
 * fetch only the clips in this course that have actually been revised — 95 of
 * 2.5M estate-wide at the time of writing — and stamp just those. Everything
 * else keeps its bare uuid, so unrevised audio keeps its URL and its cache.
 *
 * Returns an empty map on any error: a missed suffix costs one learner one
 * stale clip, whereas failing the route costs them the whole course.
 */
export async function fetchRevisedAudioRefs(
  supabase: SupabaseClient,
  courseCode: string
): Promise<Map<string, string>> {
  const refs = new Map<string, string>()
  try {
    const { data, error } = await supabase
      .from('course_audio')
      .select('id, audio_revision')
      .eq('course_code', courseCode)
      .gt('audio_revision', 1)
    if (error || !data) return refs
    for (const row of data as Array<{ id: string; audio_revision: number | null }>) {
      refs.set(row.id, buildAudioRef(row.id, row.audio_revision))
    }
  } catch {
    return refs
  }
  return refs
}

/** Apply a revised-ref map to one audio id, leaving unrevised ids untouched. */
export function applyAudioRef(
  refs: Map<string, string>,
  audioId: string | null | undefined
): string | null {
  if (!audioId) return audioId ?? null
  return refs.get(audioId) ?? audioId
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
