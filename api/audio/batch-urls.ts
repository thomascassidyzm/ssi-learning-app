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
 * PLUS one gate the per-clip proxy cannot have (SECURITY, INPUT-01
 * 2026-08-11; tightened for SEC0901-D-01 2026-09-01): a premium past-preview
 * id that presents no valid entitlement token additionally requires the CALLER
 * TO ACTUALLY BE ENTITLED TO THAT COURSE — resolved server-side from the
 * database by `resolveServerCourseAccess`, the same resolver
 * `/api/courses/:code/bundle`, `/cycles` and `/infplay-cycles` already use.
 * The rule is deliberately identical to those endpoints': if a caller can load
 * the FULL (non-preview) bundle for a course, they get presigned URLs for that
 * course's audio here, and if they cannot, they do not. Rationale:
 *   - The proxy is reached by `<audio src>`, which cannot set an Authorization
 *     header, so it must stay header-free and fail-open. This endpoint is
 *     fetch()-based and exists solely to serve the offline downloader, so it
 *     CAN carry a bearer — anonymous access to it buys a legitimate user
 *     nothing.
 *   - It is the bulk shape: 500 direct-to-S3 presigned URLs per request means
 *     one leaked list of audio uuids would otherwise convert into unlimited
 *     free bulk downloads for every account that redeemed it.
 *   - Until 2026-09-01 this gate was `verifyAuthToken().valid` — pure
 *     AUTHENTICATION. "Has a valid login" and "has ever paid" are different
 *     properties, and a free OTP signup satisfied the first (SEC0901-D-01).
 *   - It does NOT depend on `ENTITLEMENT_ENFORCE`. That env var is absent in
 *     production and defaults fail-open, and arming it today would deny every
 *     paying subscriber (no subscriber token mint site exists yet). This gate
 *     is on unconditionally and cannot silently vanish with a config change —
 *     it reads real subscription/entitlement rows, not a minted token.
 *   - FAIL CLOSED: if the entitlement lookup itself errors, gated ids are
 *     denied. An entitlement gate that fails open is not a gate. Denied ids
 *     fall back to the per-clip proxy, so a DB blip degrades download speed
 *     rather than breaking playback.
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
import { resolveServerCourseAccess, type CourseAccessInput } from '../_utils/courseAccess'

const MAX_IDS_PER_REQUEST = 500
const TTL_SECONDS = 300

/**
 * DELIBERATELY WILDCARD — reviewed 2026-09-04 and left open on purpose, unlike
 * the five non-audio routes that were closed onto `api/_utils/cors.ts` that
 * day. The reason is the platform layer: `vercel.json` carries a headers rule
 * on `/api/audio/(.*)` emitting this same `Access-Control-Allow-Origin: *`, and
 * it matches this route as well as the per-clip proxy. So this is a SECOND LOCK
 * on one door rather than a separate door — removing the header here would not
 * close the route, it would only make the code claim a posture the deployment
 * does not have. Close both or neither.
 *
 * The wildcard is also cheap here: no `Allow-Credentials` is ever sent and no
 * cookie is trusted as an identity, so it grants no ambient-credential read.
 * `Authorization` is listed because the offline downloader carries a bearer,
 * and the gate that actually matters is server-side entitlement
 * (`resolveServerCourseAccess`, above) — CORS is a browser-read policy, not an
 * authorisation layer.
 */
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

    // Entitlement resolution, lazy and memoised. A batch of free/preview clips
    // never touches it at all; a gated batch costs ONE `courses` read for every
    // distinct course code in the request, plus one `resolveServerCourseAccess`
    // per distinct course — not per id. 500 ids for one course is 1 + 1.
    let coursesPromise: Promise<Map<string, CourseAccessInput>> | null = null
    const loadCourseRows = (): Promise<Map<string, CourseAccessInput>> => {
      if (!coursesPromise) {
        coursesPromise = (async () => {
          const codes = new Set<string>()
          for (const { row } of records.values()) {
            if (row.course_code) codes.add(row.course_code)
          }
          const map = new Map<string, CourseAccessInput>()
          if (codes.size === 0) return map
          const { data, error } = await supabase
            .from('courses')
            .select('course_code, target_lang, pricing_tier, is_community')
            .in('course_code', [...codes])
          if (error) throw error
          for (const row of (data || []) as CourseAccessInput[]) map.set(row.course_code, row)
          return map
        })()
      }
      return coursesPromise
    }

    const accessByCourse = new Map<string, Promise<boolean>>()
    /** Is this caller entitled to the FULL content of this course? */
    const callerIsEntitledTo = (courseCode: string): Promise<boolean> => {
      let pending = accessByCourse.get(courseCode)
      if (!pending) {
        pending = (async () => {
          const rows = await loadCourseRows()
          // A gated id whose `courses` row is missing is treated as PREMIUM,
          // not left to be inferred. We only ever ask this question about ids
          // `resolveAudioEntitlement` has already classified as premium and
          // past the preview window, so "we couldn't find the course row" must
          // not become "assume it's free" — that is a fail-open.
          const course = rows.get(courseCode) ?? {
            course_code: courseCode,
            pricing_tier: 'premium',
            is_community: false,
            target_lang: null,
          }
          const access = await resolveServerCourseAccess(req, supabase, course)
          return access.canAccess
        })().catch((err) => {
          console.error('[BatchAudioUrls] entitlement lookup failed — denying gated ids:', {
            courseCode,
            error: err instanceof Error ? err.message : String(err),
          })
          return false
        })
        accessByCourse.set(courseCode, pending)
      }
      return pending
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
        // endpoint we close it behind the caller's REAL, DB-resolved course
        // entitlement instead (SEC0901-D-01) — the same answer
        // /api/courses/:code/bundle gives. Denied ids fall back to the per-clip
        // proxy, which keeps its own posture.
        if (entitlement.gated && !(await callerIsEntitledTo(entry.row.course_code || ''))) {
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
