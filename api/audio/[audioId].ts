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
import { GetObjectCommand } from '@aws-sdk/client-s3'
import {
  createServiceSupabaseClient,
  validateAudioRecord,
  isValidAudioId,
  lookupAudioRecord,
  resolveAudioEntitlement,
  s3Client,
  s3Bucket,
  type AudioRecord,
} from '../_utils/audioAccess'

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
  if (!isValidAudioId(audioId)) {
    res.status(400).json({ error: 'Invalid audioId format' })
    return
  }

  try {
    // Create Supabase client with service role key (matches all other API endpoints)
    const supabase = createServiceSupabaseClient()

    // Query course_audio first (vast majority of plays — seed/lego/practice
    // audio). Fall back to shared_audio (meta-cognitive instructions +
    // encouragements that live in the cross-course template table, no
    // longer duplicated per course as of 2026-05-20).
    const { row: audioRecord, fromCourseAudio, error: queryError } = await lookupAudioRecord(supabase, audioId)

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
    const entitlement = resolveAudioEntitlement(req, fromCourseAudio, audioRecord?.course_code, audioRecord?.lego_id)
    if (!entitlement.allowed) {
      // Strict: a clearly-premium, past-preview clip with no valid
      // entitlement is denied.
      res.setHeader('Cache-Control', 'no-store')
      res.status(403).json({ error: 'Premium content requires an active subscription' })
      return
    }
    if (entitlement.tag) {
      // DEFAULT (fail-open): do not regress live playback before the client
      // attaches tokens. Tag the response so we can observe coverage.
      res.setHeader('X-SSi-Entitlement', entitlement.tag)
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
      // SEC25 INPUT-08: caller-safe body only. The S3 key and the raw AWS
      // error text (which routinely carries the bucket ARN and key layout)
      // stay in the console.error above — this endpoint is anonymous.
      res.status(502).json({ error: 'Failed to fetch audio from storage' })
      return
    }

  } catch (error) {
    console.error('[AudioProxy] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
