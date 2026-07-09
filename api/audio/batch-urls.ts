/**
 * Batch presigned-URL API — bulk offline download support.
 *
 * The per-clip proxy (`api/audio/[audioId].ts`) is a serverless hop per
 * clip: fine for normal playback, but the offline bulk downloader can want
 * ~2000 clips in one go, and 2000 serverless round trips is the bottleneck.
 * This endpoint does ONE (well, two — see below) Supabase lookups for the
 * whole batch and hands back short-lived presigned S3 GET URLs so the
 * client fetches audio directly from S3, bypassing the proxy entirely.
 *
 * Same entitlement rule as the per-clip proxy — see `../_utils/audioAccess`
 * (`resolveAudioEntitlement`), shared by both endpoints so they can never
 * disagree about what's gated.
 *
 * Endpoint: POST /api/audio/batch-urls
 * Body:     { "audioIds": string[] }               (max 500 per request)
 * Response: { "urls": Record<string, string>,
 *             "denied": string[],
 *             "ttlSeconds": 300 }
 *
 * `denied` covers every id that didn't make it into `urls`, whatever the
 * reason (entitlement-gated, not found, or a malformed/invalid row) — the
 * client's fallback path (per-clip GET /api/audio/:id) handles all three
 * uniformly, so a single list is all it needs.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  createServiceSupabaseClient,
  validateAudioRecord,
  isValidAudioId,
  lookupAudioRecordsBatch,
  resolveAudioEntitlement,
  s3Client,
  s3Bucket,
} from '../_utils/audioAccess'

const MAX_IDS_PER_REQUEST = 500
const TTL_SECONDS = 300

function setCorsHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  setCorsHeaders(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body as { audioIds?: unknown } | undefined
  const audioIds = body?.audioIds

  if (!Array.isArray(audioIds) || audioIds.length === 0) {
    res.status(400).json({ error: 'audioIds must be a non-empty array' })
    return
  }
  if (audioIds.length > MAX_IDS_PER_REQUEST) {
    res.status(400).json({ error: `audioIds exceeds max of ${MAX_IDS_PER_REQUEST} per request` })
    return
  }
  if (!audioIds.every((id) => typeof id === 'string')) {
    res.status(400).json({ error: 'audioIds must all be strings' })
    return
  }

  const ids = audioIds as string[]
  const validIds = ids.filter(isValidAudioId)
  const denied: string[] = ids.filter((id) => !isValidAudioId(id))

  try {
    const supabase = createServiceSupabaseClient()
    const records = await lookupAudioRecordsBatch(supabase, validIds)

    const urls: Record<string, string> = {}

    await Promise.all(
      validIds.map(async (id) => {
        const entry = records.get(id)
        if (!entry) {
          denied.push(id)
          return
        }

        const validation = validateAudioRecord(entry.row)
        if (!validation.ok) {
          console.error('[BatchAudioUrls] row failed shape validation — possible schema change:', {
            audioId: id,
            reason: validation.reason,
          })
          denied.push(id)
          return
        }

        const entitlement = resolveAudioEntitlement(req, entry.fromCourseAudio, entry.row.course_code, entry.row.lego_id)
        if (!entitlement.allowed) {
          denied.push(id)
          return
        }

        const command = new GetObjectCommand({ Bucket: s3Bucket, Key: validation.value.s3_key })
        urls[id] = await getSignedUrl(s3Client, command, { expiresIn: TTL_SECONDS })
      })
    )

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ urls, denied, ttlSeconds: TTL_SECONDS })
  } catch (error) {
    console.error('[BatchAudioUrls] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
