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
    let audioRecord: { id: string; s3_key: string; duration_ms: number } | null = null
    let queryError: { message?: string } | null = null
    {
      const r = await supabase
        .from('course_audio')
        .select('id, s3_key, duration_ms')
        .eq('id', audioId)
        .maybeSingle()
      audioRecord = r.data as typeof audioRecord
      queryError = r.error
    }
    if (!audioRecord) {
      const r = await supabase
        .from('shared_audio')
        .select('id, s3_key, duration_ms')
        .eq('id', audioId)
        .maybeSingle()
      audioRecord = r.data as typeof audioRecord
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

      // Set response headers for caching and CORS
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
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
