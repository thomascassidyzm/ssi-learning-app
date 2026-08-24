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
 * PLUS one gate the per-clip proxy cannot have (SECURITY, INPUT-01,
 * 2026-08-11): a premium past-preview id that presents no valid entitlement
 * token additionally requires a VERIFIED SUPABASE SESSION here. Rationale:
 *   - The proxy is reached by `<audio src>`, which cannot set an Authorization
 *     header, so it must stay header-free and fail-open. This endpoint is
 *     fetch()-based and exists solely to serve the offline downloader, so it
 *     CAN carry a bearer — anonymous access to it buys a legitimate user
 *     nothing.
 *   - It is the bulk shape: 500 direct-to-S3 presigned URLs per request means
 *     an anonymous caller who enumerates audio uuids (freely handed out by
 *     /api/courses/:code/cycles) can pull the entire paid catalogue.
 *   - It does NOT depend on `ENTITLEMENT_ENFORCE`. That env var is absent in
 *     production and defaults fail-open, and arming it today would deny every
 *     paying subscriber (no subscriber token mint site exists yet). This gate
 *     is on unconditionally and cannot silently vanish with a config change.
 * Free/community courses and preview seeds (≤ Yellow) are never `gated`, so
 * anonymous guests keep full offline download of everything they may have.
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
import { verifyAuthToken } from '../_utils/auth'

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

    // Verified-session check, resolved AT MOST ONCE per request and only if a
    // gated id is actually hit — a batch of free/preview clips costs nothing.
    let sessionCheck: Promise<boolean> | null = null
    const hasVerifiedSession = (): Promise<boolean> => {
      if (!sessionCheck) sessionCheck = verifyAuthToken(req).then((r) => r.valid)
      return sessionCheck
    }

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
        // `gated` = premium past preview with no valid entitlement token. The
        // shared resolver fails OPEN there (see its comments); on the bulk
        // endpoint we close it behind a verified session instead. Denied ids
        // fall back to the per-clip proxy, which keeps its own posture.
        if (entitlement.gated && !(await hasVerifiedSession())) {
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
