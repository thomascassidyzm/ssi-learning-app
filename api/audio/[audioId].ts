/**
 * Audio Proxy API - Backend proxy for audio delivery
 *
 * Purpose:
 * - Entitlement verification (paid vs free)
 * - Future CDN flexibility (swap S3 without app update)
 * - CORS bypass (proper headers from our domain)
 *
 * NOTE on analytics (2026-05-19): play-level analytics live in
 * `player_events.audio_play`, fired client-side on every play. The
 * proxy used to also insert into `audio_plays`, but that table only
 * captured cache MISSES (SW CacheFirst serves repeat plays without
 * touching the proxy) — useless for learner activity. `audio_plays`
 * was dropped.
 *
 * Endpoint: GET /api/audio/:audioId
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { createHmac, timingSafeEqual } from 'crypto'

// Initialize Supabase client
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Initialize S3 client - use VITE_ versions as fallback (they're cleaner)
const s3Region = (process.env.AWS_REGION || process.env.VITE_S3_REGION || 'eu-west-1').trim()
const s3Client = new S3Client({
  region: s3Region,
  credentials: {
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || '').trim(),
  },
})
const s3Bucket = (process.env.S3_AUDIO_BUCKET || process.env.VITE_S3_AUDIO_BUCKET || 'ssi-audio-stage').trim()

// Validate required env vars
if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

interface AudioRecord {
  id: string
  s3_key: string
  duration_ms: number
}

/**
 * Runtime validator for the course_audio row shape. Returns the typed row
 * on success, or a diagnostic message describing what's wrong. This is our
 * tripwire for silent schema drift: if the dashboard ever renames s3_key
 * or drops id / duration_ms, the API fails loudly with a specific error
 * instead of returning undefined fields and a misleading 404.
 */
function validateAudioRecord(row: unknown): { ok: true; value: AudioRecord } | { ok: false; reason: string } {
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
    // duration_ms being absent isn't fatal for playback but indicates drift.
    // Accept it but don't treat undefined as a number.
    return { ok: true, value: { id: r.id, s3_key: r.s3_key, duration_ms: 0 } }
  }
  return { ok: true, value: { id: r.id, s3_key: r.s3_key, duration_ms: r.duration_ms } }
}

// ── Server-side entitlement enforcement for PREMIUM content ─────────────────
//
// CANONICAL pricing model: a course is PREMIUM when its target language is in
// the Big-10 OR Welsh (cym); premium content is free to the end of Yellow
// (seed 19) and paywalled from Orange (seed 20) onward. Everything else is free
// on all belts. A paid account (learner / tutor-student / school-student) or a
// valid time-boxed try-link unlocks all premium content past Yellow.
//
// We CLASSIFY for free (no DB round-trip): course_code → target lang → tier, and
// lego_id (`S0001L01`) → seed number. The fast path (free course, preview seed,
// or shared/meta audio) does ZERO extra work, preserving the <2s first play.
// Only premium-past-preview consults the caller's entitlement, and that is a
// stateless HMAC token check (no DB hit) — see ENTITLEMENT note below.

const PREMIUM_PREVIEW_MAX_SEED = 19 // Yellow belt — keep in sync with @ssi/core PREMIUM_PREVIEW_MAX_SEED
const BIG_10 = ['eng', 'spa', 'fra', 'deu', 'ita', 'por', 'zho', 'jpn', 'ara', 'kor']

// Strict mode (opt-in via env) FAILS CLOSED on premium-past-preview when no
// valid entitlement is presented. DEFAULT is fail-OPEN so deploying this code
// can NOT lock out a single live payer before the client begins attaching
// entitlement tokens to audio URLs (that plumbing lives in another lane).
const ENTITLEMENT_STRICT = (process.env.ENTITLEMENT_ENFORCE || '').trim().toLowerCase() === 'strict'
const entitlementSecret = (
  process.env.ENTITLEMENT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim()

/** Is this course premium (Big-10 target or Welsh)? Community/other → free. */
function isPremiumCourse(courseCode: string): boolean {
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
 * lesson/lego index. If that assumption is ever wrong, strict mode would wall
 * off the wrong content — so DO NOT flip strict on without confirming this
 * mapping against live course content + a test. Until then the gate is
 * fail-OPEN and inert, so a mismatch here cannot lock out a live learner.
 */
function seedFromLegoId(legoId: string | null | undefined): number | null {
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
 * signature is valid AND it hasn't expired, else null. Used to honour try-links
 * (server-minted, time-boxed) and any future signed paid-session token without a
 * per-request database read.
 */
function verifyEntitlementToken(token: string): { exp?: number; scope?: string; courses?: string[] } | null {
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
function tokenGrantsCourse(payload: { scope?: string; courses?: string[] }, courseCode: string): boolean {
  if (payload.scope === 'all') return true
  if (Array.isArray(payload.courses)) return payload.courses.includes(courseCode)
  return false
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Get audioId from URL
  const { audioId } = req.query
  if (!audioId || typeof audioId !== 'string') {
    res.status(400).json({ error: 'Missing audioId parameter' })
    return
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(audioId)) {
    res.status(400).json({ error: 'Invalid audioId format' })
    return
  }

  try {
    // Create Supabase client with service role key (matches all other API endpoints)
    const supabase = createClient(
      supabaseUrl!,
      supabaseServiceKey || (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
    )

    // Query course_audio first (vast majority of plays — seed/lego/practice
    // audio). Fall back to shared_audio (meta-cognitive instructions +
    // encouragements that live in the cross-course template table, no
    // longer duplicated per course as of 2026-05-20).
    type AudioRow = { id: string; s3_key: string; duration_ms: number; course_code?: string | null; lego_id?: string | null }
    let audioRecord: AudioRow | null = null
    let queryError: { message?: string } | null = null
    let fromCourseAudio = false
    {
      // Select course_code + lego_id too so we can classify entitlement for free
      // (no second query). Both already exist on course_audio.
      const r = await supabase
        .from('course_audio')
        .select('id, s3_key, duration_ms, course_code, lego_id')
        .eq('id', audioId)
        .maybeSingle()
      audioRecord = r.data as AudioRow | null
      queryError = r.error
      if (audioRecord) fromCourseAudio = true
    }
    if (!audioRecord) {
      // shared_audio = cross-course meta content (instructions / encouragements);
      // never premium → stays open.
      const r = await supabase
        .from('shared_audio')
        .select('id, s3_key, duration_ms')
        .eq('id', audioId)
        .maybeSingle()
      audioRecord = r.data as AudioRow | null
      if (!audioRecord) queryError = r.error || queryError
    }

    if (!audioRecord) {
      console.error('[AudioProxy] Audio not found in course_audio or shared_audio:', audioId, queryError?.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(404).json({ error: 'Audio not found' })
      return
    }

    const validation = validateAudioRecord(audioRecord)
    if (!validation.ok) {
      // Schema drift — not a client problem. Log loudly so it surfaces in
      // Vercel logs immediately, and return 500 (not 404) so clients'
      // circuit breakers degrade cleanly instead of treating it as a
      // missing-UUID situation that they'd otherwise cache-skip.
      console.error(
        '[AudioProxy] course_audio row failed shape validation — possible schema change:',
        { audioId, reason: validation.reason, row: audioRecord }
      )
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({
        error: 'Audio record shape invalid (schema mismatch)',
        detail: validation.reason,
      })
      return
    }
    const sample: AudioRecord = validation.value

    // ── Entitlement gate (premium-past-preview only) ───────────────────────
    // Fast path: shared/meta audio, free courses, and preview seeds (≤ Yellow)
    // are always open and reach here with zero extra work. Only premium content
    // past Yellow consults the caller's entitlement token (stateless HMAC).
    if (fromCourseAudio) {
      const courseCode = (audioRecord?.course_code || '').trim()
      const seed = seedFromLegoId(audioRecord?.lego_id)
      const premium = isPremiumCourse(courseCode)
      // We can only gate when we positively know it's premium AND know the seed
      // is past preview. If we can't classify (no course_code / unparseable
      // lego_id), we FAIL OPEN — never lock out on ambiguity.
      const pastPreview = premium && seed != null && seed > PREMIUM_PREVIEW_MAX_SEED
      if (pastPreview) {
        // Token may arrive as ?et= (the only channel an <audio> element can use)
        // or an Authorization bearer for fetch-based callers.
        const etParam = typeof req.query.et === 'string' ? req.query.et : ''
        const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        const rawToken = etParam || bearer
        const payload = rawToken ? verifyEntitlementToken(rawToken) : null
        const granted = !!payload && tokenGrantsCourse(payload, courseCode)

        if (!granted) {
          if (ENTITLEMENT_STRICT) {
            // Strict: a clearly-premium, past-preview clip with no valid
            // entitlement is denied.
            res.setHeader('Cache-Control', 'no-store')
            res.status(403).json({ error: 'Premium content requires an active subscription' })
            return
          }
          // DEFAULT (fail-open): do not regress live playback before the client
          // attaches tokens. Tag the response so we can observe coverage.
          res.setHeader('X-SSi-Entitlement', rawToken ? 'token-invalid-open' : 'no-token-open')
        }
      }
    }

    // Forward the client's Range header to S3. iOS Safari ALWAYS requests
    // <audio> via Range (starts with `bytes=0-1` to probe, then real
    // ranges). The response to a Range request MUST be `206 Partial
    // Content` with `Content-Range` + `Accept-Ranges`. Previously this
    // proxy ignored Range and always sent a full body with status 200;
    // Vercel's CDN then sliced that 200 to satisfy the Range but KEPT the
    // 200 status — a 2-byte body with a `200 OK` + `Content-Range` that
    // claims a much larger total. iOS treats that contradiction as a
    // broken resource, plays nothing usable, and retries in a tight loop
    // until the player gives up. Chrome tolerates it, which is why it only
    // failed on Safari. S3 honours Range natively and returns the right
    // partial + ContentRange, so we just pass the header through and
    // mirror S3's 206.
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined

    // Fetch audio from S3 using AWS SDK
    const command = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: sample.s3_key,
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    })

    try {
      const s3Response = await s3Client.send(command)

      // Get content type and length
      const contentType = s3Response.ContentType || 'audio/mpeg'
      const contentLength = s3Response.ContentLength

      // Set response headers for caching and CORS.
      //
      // Browser/SW may cache aggressively (immutable) — those layers serve
      // byte-ranges from a cached full body CORRECTLY (proper 206). But
      // Vercel's CDN does NOT: on a cache HIT it slices its stored full
      // body to satisfy a Range header yet returns status 200 (not 206)
      // with a Content-Range — the exact malformed shape iOS Safari
      // rejects. So we forbid the Vercel edge from caching these and let
      // every Range request reach this origin, which answers a clean 206
      // below. Cross-user edge caching is sacrificed; per-device browser
      // caching (the dominant repeat-play path) is retained.
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
      res.setHeader('CDN-Cache-Control', 'no-store')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      // Advertise range support so iOS issues proper byte-range requests.
      res.setHeader('Accept-Ranges', 'bytes')

      // If the client asked for a range and S3 returned a partial, mirror
      // it as a real 206. Otherwise fall through to a normal 200.
      const isPartial = !!rangeHeader && !!s3Response.ContentRange
      if (isPartial) {
        res.setHeader('Content-Range', s3Response.ContentRange!)
        if (contentLength) res.setHeader('Content-Length', contentLength.toString())
        res.status(206)
      } else if (contentLength) {
        res.setHeader('Content-Length', contentLength.toString())
      }

      // Stream the audio data
      const bodyStream = s3Response.Body
      if (!bodyStream) {
        res.status(502).json({ error: 'Empty body from S3' })
        return
      }

      // AWS SDK v3 returns a special stream type - use transformToByteArray
      let buffer: Buffer

      // AWS SDK v3 SdkStreamMixin has transformToByteArray
      if (typeof (bodyStream as any).transformToByteArray === 'function') {
        const byteArray = await (bodyStream as any).transformToByteArray()
        buffer = Buffer.from(byteArray)
      }
      // Fallback: try arrayBuffer
      else if (typeof (bodyStream as any).arrayBuffer === 'function') {
        const arrayBuf = await (bodyStream as any).arrayBuffer()
        buffer = Buffer.from(arrayBuf)
      }
      // Last resort: iterate as async iterable
      else {
        const chunks: Buffer[] = []
        for await (const chunk of bodyStream as any) {
          chunks.push(Buffer.from(chunk))
        }
        buffer = Buffer.concat(chunks)
      }

      res.send(buffer)

    } catch (s3Error: any) {
      console.error('[AudioProxy] S3 fetch failed:', {
        key: sample.s3_key,
        bucket: s3Bucket,
        error: s3Error?.message,
        code: s3Error?.Code,
        name: s3Error?.name,
        stack: s3Error?.stack,
        full: JSON.stringify(s3Error, Object.getOwnPropertyNames(s3Error || {})),
      })
      res.status(502).json({
        error: 'Failed to fetch audio from storage',
        details: s3Error?.message || s3Error?.Code || s3Error?.name || 'Unknown error',
        key: sample.s3_key,
      })
      return
    }

  } catch (error) {
    console.error('[AudioProxy] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
