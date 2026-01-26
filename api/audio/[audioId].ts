/**
 * Audio Proxy API - Backend proxy for audio delivery
 *
 * Purpose:
 * - Entitlement verification (paid vs free)
 * - Analytics (track audio requests)
 * - Future CDN flexibility (swap S3 without app update)
 * - CORS bypass (proper headers from our domain)
 *
 * Endpoint: GET /api/audio/:audioId
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-west-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})
const s3Bucket = process.env.S3_AUDIO_BUCKET || 'ssi-audio-stage'

// Validate required env vars
if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

interface AudioRecord {
  id: string
  s3_key: string
  duration_ms: number
}

interface AudioPlayEvent {
  user_id: string | null
  audio_id: string
  course_id: string | null
  seed_id: string | null
  audio_role: string | null
  device_type: string | null
  is_offline: boolean
  ip_country: string | null
}

/**
 * Log audio play event (fire and forget - never blocks audio delivery)
 */
async function logAudioPlay(
  supabase: ReturnType<typeof createClient>,
  event: AudioPlayEvent
): Promise<void> {
  try {
    await supabase.from('audio_plays').insert(event)
  } catch (error) {
    // Silent failure - analytics should never block playback
    console.warn('[AudioProxy] Failed to log audio play:', error)
  }
}

/**
 * Detect device type from user agent
 */
function getDeviceType(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  const ua = userAgent.toLowerCase()
  if (/ipad|android(?!.*mobile)|tablet/i.test(ua)) return 'tablet'
  if (/iphone|ipod|android.*mobile|webos|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile'
  return 'desktop'
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
    // Create Supabase client (use service key if available for server-side ops)
    const supabase = createClient(
      supabaseUrl!,
      supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY || ''
    )

    // Get courseId from query params for filtering
    const courseId = req.query.courseId as string | undefined

    // Query course_audio table for the audio's S3 key
    // Use courseId filter if provided for better specificity
    let query = supabase
      .from('course_audio')
      .select('id, s3_key, duration_ms')
      .eq('id', audioId)

    if (courseId) {
      query = query.eq('course_code', courseId)
    }

    const { data: audioRecord, error: queryError } = await query.single()

    let sample: AudioRecord | null = audioRecord as AudioRecord | null

    if (queryError || !audioRecord) {
      // Fallback: try audio_samples table (legacy support)
      const { data: legacyRecord, error: legacyError } = await supabase
        .from('audio_samples')
        .select('uuid, s3_key, duration_ms')
        .eq('uuid', audioId)
        .single()

      if (legacyError || !legacyRecord) {
        console.error('[AudioProxy] Audio not found in course_audio or audio_samples:', audioId, queryError)
        res.status(404).json({ error: 'Audio not found' })
        return
      }

      // Use legacy record - map uuid to id
      sample = {
        id: (legacyRecord as any).uuid,
        s3_key: (legacyRecord as any).s3_key,
        duration_ms: (legacyRecord as any).duration_ms,
      }
    }

    if (!sample || !sample.s3_key) {
      console.error('[AudioProxy] No s3_key found for audio:', audioId)
      res.status(404).json({ error: 'Audio storage key not found' })
      return
    }

    // Log analytics (fire and forget)
    const analyticsEvent: AudioPlayEvent = {
      user_id: req.headers['x-user-id'] as string | null,
      audio_id: audioId,
      course_id: req.query.courseId as string | null,
      seed_id: req.query.seedId as string | null,
      audio_role: req.query.role as string | null,
      device_type: getDeviceType(req.headers['user-agent'] || ''),
      is_offline: req.query.offline === 'true',
      ip_country: (req.headers['x-vercel-ip-country'] as string) || null,
    }

    // Non-blocking analytics insert
    logAudioPlay(supabase, analyticsEvent).catch(() => {})

    // Fetch audio from S3 using AWS SDK
    const command = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: sample.s3_key,
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

      if (contentLength) {
        res.setHeader('Content-Length', contentLength.toString())
      }

      // Stream the audio data
      const bodyStream = s3Response.Body
      if (!bodyStream) {
        res.status(502).json({ error: 'Empty body from S3' })
        return
      }

      // Convert to buffer using transformToByteArray (AWS SDK v3)
      const buffer = await bodyStream.transformToByteArray()
      res.send(Buffer.from(buffer))

    } catch (s3Error: any) {
      console.error('[AudioProxy] S3 fetch failed:', {
        key: sample.s3_key,
        bucket: s3Bucket,
        error: s3Error.message,
        code: s3Error.Code || s3Error.name,
      })
      res.status(502).json({
        error: 'Failed to fetch audio from storage',
        details: s3Error.Code || s3Error.name || s3Error.message,
        key: sample.s3_key,
      })
      return
    }

  } catch (error) {
    console.error('[AudioProxy] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
