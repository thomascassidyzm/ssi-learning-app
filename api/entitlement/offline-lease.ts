/**
 * Offline-lease validation — /api/entitlement/offline-lease
 *
 * The server side of the 30-day offline handshake. The client calls this in the
 * background (NOT on first load — only when a lease is near expiry / stale / on
 * reconnect; see useOfflineLease). The response is the AUTHORITY for each
 * downloaded course's lease.
 *
 * STATEFUL authority (v2): the `offline_leases` table persists each learner's
 * per-course lease, giving us two things the stateless v1 couldn't:
 *   - REVOCATION kill-switch: an admin sets revoked_at (chargeback/refund) → the
 *     next validate locks that download mid-window.
 *   - TRIAL-USED memory: a non-payer's free 30-day taste is recorded server-side,
 *     so wiping IndexedDB + re-downloading doesn't mint a fresh taste.
 *
 * The client POSTs the courses it currently has downloaded; per course we upsert
 * the row, apply current entitlement + revocation, and return the authoritative
 * expiry. Payers (sub / full|course entitlement / admin) RENEW (slide +30d);
 * non-payers get a single non-renewing taste; revoked → locked.
 *
 * FAIL-OPEN / graceful: if the table doesn't exist yet (pre-migration) we fall
 * back to the old stateless shape (entitled courses, no per-course lease expiry)
 * so the deploy is safe whatever order the migration lands in — the client then
 * keeps its local lease (today's behaviour).
 *
 * Auth + service-role read mirror api/subscription/index.ts + api/entitlement/
 * user.ts. Reuses the EXISTING subscription/entitlement state — no parallel
 * source of truth.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Days a granted lease is good for — kept in sync with client config/offlineLease.ts. */
const LEASE_DAYS = 30
const LEASE_MS = LEASE_DAYS * 24 * 60 * 60 * 1000

interface OfflineLeaseCourse {
  /** Course code. */
  courseCode: string
  /** Entitlement-code expiry (epoch ms) if access is time-boxed; null otherwise.
   *  Used by the client's FALLBACK path to clamp a locally-computed lease. */
  entitlementExpiresAt: number | null
  /** Server-authoritative lease expiry (epoch ms). Null only in the stateless
   *  fallback (table absent) — then the client computes locally. */
  leaseExpiresAt: number | null
  /** Whether this lease is a free 30-day taste (non-payer) vs a renewing one. */
  isTrial: boolean
  /** Server revocation flag (chargeback/refund kill-switch). */
  revoked: boolean
}

/** Parse the downloaded-course list from a POST body or a GET ?courses=a,b. */
function readCourses(req: VercelRequest): string[] {
  const out = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.add(v.trim())
  }
  const body: any = req.body
  if (body && Array.isArray(body.courses)) body.courses.forEach(add)
  const q = req.query?.courses
  if (typeof q === 'string') q.split(',').forEach(add)
  else if (Array.isArray(q)) q.forEach(add)
  return [...out]
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  // Never let a CDN/SW cache an entitlement answer — it must reflect live state.
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const serverNow = Date.now()

  // Auth failures are NOT "subscription lapsed" — the client FAILS OPEN on a 401
  // (keep the existing lease, retry later) so a token blip never locks a payer.
  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[offline-lease] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Resolve learner + platform role (admins/testers always pass).
    const { data: learner } = await supabase
      .from('learners')
      .select('id, platform_role, educational_role')
      .eq('user_id', userId)
      .single()

    if (!learner) {
      res.status(200).json({ valid: false, blanket: false, stateful: false, reason: 'no_learner', leaseDays: LEASE_DAYS, serverNow, subscriptionId: null, courses: [] })
      return
    }

    const role = learner.platform_role
    const eduRole = learner.educational_role
    const isPrivileged = role === 'ssi_admin' || role === 'tester' || eduRole === 'god'

    // Active subscription?
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('id, status, current_period_end')
      .eq('learner_id', learner.id)
      .single()

    const subActive =
      !!subscription &&
      subscription.status === 'active' &&
      (!subscription.current_period_end ||
        new Date(subscription.current_period_end).getTime() > serverNow)

    // Active (non-expired) entitlements — full + course-scoped, + group/school/
    // class cascade (same source as api/entitlement/user.ts).
    const entitledCourseExpiry = new Map<string, number | null>()
    let hasFullEntitlement = false

    const { data: entitlements } = await supabase
      .from('user_entitlements')
      .select('access_type, granted_courses, expires_at')
      .eq('learner_id', learner.id)

    for (const e of entitlements || []) {
      const expMs = e.expires_at ? new Date(e.expires_at).getTime() : null
      if (expMs != null && expMs <= serverNow) continue // expired
      if (e.access_type === 'full') {
        hasFullEntitlement = true
      } else if (e.access_type === 'courses' && Array.isArray(e.granted_courses)) {
        for (const code of e.granted_courses) {
          // Keep the LATEST (max) expiry if a course is granted more than once.
          const prev = entitledCourseExpiry.get(code)
          if (!entitledCourseExpiry.has(code)) entitledCourseExpiry.set(code, expMs)
          else if (prev != null && (expMs == null || expMs > prev)) entitledCourseExpiry.set(code, expMs)
        }
      }
    }

    try {
      const { data: cascadeCourses } = await supabase.rpc('get_cascade_courses', {
        p_user_id: userId,
      })
      for (const code of cascadeCourses || []) {
        if (!entitledCourseExpiry.has(code)) entitledCourseExpiry.set(code, null) // open-ended
      }
    } catch (cascadeErr) {
      console.error('[offline-lease] Cascade error (non-fatal):', cascadeErr)
    }

    const blanket = isPrivileged || subActive || hasFullEntitlement
    const isEntitled = (code: string) => blanket || entitledCourseExpiry.has(code)
    // The lease-renewal clamp: an open-ended grant (blanket) → no clamp (null);
    // a time-boxed course code → its expiry.
    const entExpiryFor = (code: string): number | null =>
      blanket ? null : (entitledCourseExpiry.get(code) ?? null)

    const reported = readCourses(req)
    const courses: OfflineLeaseCourse[] = []
    let stateful = false

    // ── Stateful path: the offline_leases table is the per-course authority ──
    try {
      const { data: existingRows, error: readErr } = await supabase
        .from('offline_leases')
        .select('course_code, expires_at, is_trial, revoked_at')
        .eq('learner_id', learner.id)
      if (readErr) throw readErr
      stateful = true

      const existing = new Map<string, { expiresAt: number; isTrial: boolean; revoked: boolean }>()
      for (const r of existingRows || []) {
        existing.set(r.course_code, {
          expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : 0,
          isTrial: !!r.is_trial,
          revoked: !!r.revoked_at,
        })
      }

      const upserts: any[] = []
      for (const code of reported) {
        const prior = existing.get(code)

        if (prior?.revoked) {
          // Kill-switch wins — locked, untouched.
          courses.push({ courseCode: code, entitlementExpiresAt: entExpiryFor(code), leaseExpiresAt: prior.expiresAt, isTrial: prior.isTrial, revoked: true })
          continue
        }

        if (isEntitled(code)) {
          // Payer → RENEW: slide +30d, clamped to a time-boxed code; mark non-trial.
          const clamp = entExpiryFor(code)
          const newExpiry = clamp != null ? Math.min(serverNow + LEASE_MS, clamp) : serverNow + LEASE_MS
          upserts.push({
            learner_id: learner.id,
            course_code: code,
            granted_at: new Date(prior ? Math.min(serverNow, prior.expiresAt || serverNow) : serverNow).toISOString(),
            expires_at: new Date(newExpiry).toISOString(),
            last_validated_at: new Date(serverNow).toISOString(),
            is_trial: false,
            subscription_id: subscription?.id ?? null,
            revoked_at: null,
            updated_at: new Date(serverNow).toISOString(),
          })
          courses.push({ courseCode: code, entitlementExpiresAt: clamp, leaseExpiresAt: newExpiry, isTrial: false, revoked: false })
          continue
        }

        // Non-payer.
        if (prior) {
          // A taste (or a lapsed paid lease) already exists — do NOT slide. Honour
          // the recorded expiry; this is the TRIAL-USED memory (re-download won't
          // mint a fresh taste). Touch last_validated_at only.
          upserts.push({
            learner_id: learner.id,
            course_code: code,
            expires_at: new Date(prior.expiresAt).toISOString(),
            last_validated_at: new Date(serverNow).toISOString(),
            is_trial: prior.isTrial,
            updated_at: new Date(serverNow).toISOString(),
          })
          courses.push({ courseCode: code, entitlementExpiresAt: null, leaseExpiresAt: prior.expiresAt, isTrial: prior.isTrial, revoked: false })
        } else {
          // First free taste: a single non-renewing 30-day window.
          const newExpiry = serverNow + LEASE_MS
          upserts.push({
            learner_id: learner.id,
            course_code: code,
            granted_at: new Date(serverNow).toISOString(),
            expires_at: new Date(newExpiry).toISOString(),
            last_validated_at: new Date(serverNow).toISOString(),
            is_trial: true,
            revoked_at: null,
            updated_at: new Date(serverNow).toISOString(),
          })
          courses.push({ courseCode: code, entitlementExpiresAt: null, leaseExpiresAt: newExpiry, isTrial: true, revoked: false })
        }
      }

      if (upserts.length) {
        const { error: upErr } = await supabase
          .from('offline_leases')
          .upsert(upserts, { onConflict: 'learner_id,course_code' })
        if (upErr) console.error('[offline-lease] upsert error (non-fatal):', upErr.message)
      }
    } catch (tableErr: any) {
      // Table absent (pre-migration) or read failed → stateless fallback: return
      // the entitled courses with no per-course lease expiry. The client keeps its
      // local lease and computes renewal locally (the v1 behaviour).
      stateful = false
      console.warn('[offline-lease] stateless fallback:', tableErr?.message || tableErr)
      courses.length = 0
      for (const code of reported) {
        if (isEntitled(code)) {
          courses.push({ courseCode: code, entitlementExpiresAt: entExpiryFor(code), leaseExpiresAt: null, isTrial: false, revoked: false })
        }
      }
      if (blanket && reported.length === 0) {
        // GET/no-courses summary call — nothing to enumerate, blanket says renew all.
      }
    }

    const valid = isPrivileged || subActive || hasFullEntitlement || entitledCourseExpiry.size > 0

    res.status(200).json({
      valid,
      blanket, // every downloaded course renews (sub/full/admin)
      stateful,
      reason: valid ? undefined : 'no_entitlement',
      leaseDays: LEASE_DAYS,
      serverNow,
      subscriptionId: subscription?.id ?? null,
      courses,
    })
  } catch (err) {
    console.error('[offline-lease] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
