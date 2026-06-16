/**
 * Offline-lease validation — GET /api/entitlement/offline-lease
 *
 * The server side of the 30-day offline handshake. The client calls this on
 * boot, on reconnect, and on a slow timer; a `{ valid:true }` response slides
 * each downloaded course's lease forward +30 days (the renewal). The lease is
 * the offline-entitlement proof: as long as the user re-validates online once a
 * month, downloads keep playing; if they don't (offline whole time, or the
 * subscription has genuinely lapsed), the lease runs out and offline play locks.
 *
 * STATELESS authority (v1): there's no `offline_leases` table — the client holds
 * the lease, the server only answers "is this user entitled to offline right
 * now, and what's the real time?". `serverNow` is the clock-tamper anchor (the
 * client anchors its new expiry on this, not the device clock). A revocation
 * table (chargeback/refund kill-switch) is a deferred follow-on — see build-plan
 * §2B "New tables/migrations: None for v1".
 *
 * Mirrors api/subscription/index.ts + api/entitlement/user.ts (auth + service
 * role read). Reuses the EXISTING subscription/entitlement state — no parallel
 * source of truth.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Days a granted lease is good for — the single source kept in sync with the
 *  client config/offlineLease.ts LEASE_DAYS. */
const LEASE_DAYS = 30

interface OfflineLeaseCourse {
  /** Course code the user is entitled to download offline. */
  courseCode: string
  /** Entitlement-code expiry (epoch ms) if the access is time-boxed; null for an
   *  open-ended subscription/admin grant. The client clamps the lease to this. */
  entitlementExpiresAt: number | null
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  // Never let a CDN/SW cache an entitlement answer — it must reflect live state.
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const serverNow = Date.now()

  // Auth failures are NOT "subscription lapsed" — the client must FAIL-OPEN on a
  // 401 (treat as "couldn't check", keep the existing lease, retry later) so a
  // token blip never locks a paying user. We still return 401 so the client can
  // distinguish "infra/auth problem" from an explicit { valid:false }.
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
      // Authed but no learner row — no entitlement to renew, but this is a clean
      // "not entitled" answer, not an infra error.
      res.status(200).json({ valid: false, reason: 'no_learner', leaseDays: LEASE_DAYS, serverNow, courses: [] })
      return
    }

    const role = learner.platform_role
    const eduRole = learner.educational_role
    const isPrivileged =
      role === 'ssi_admin' || role === 'tester' || eduRole === 'god'

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

    // Active (non-expired) entitlements — full + course-scoped, plus the
    // group/school/class cascade (same source as api/entitlement/user.ts).
    const courses: OfflineLeaseCourse[] = []
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
          courses.push({ courseCode: code, entitlementExpiresAt: expMs })
        }
      }
    }

    // Cascade courses (group → school → class). Open-ended (no expiry).
    try {
      const { data: cascadeCourses } = await supabase.rpc('get_cascade_courses', {
        p_user_id: userId,
      })
      for (const code of cascadeCourses || []) {
        courses.push({ courseCode: code, entitlementExpiresAt: null })
      }
    } catch (cascadeErr) {
      console.error('[offline-lease] Cascade error (non-fatal):', cascadeErr)
    }

    // The lease is valid (renewable) if the user has ANY active offline-grade
    // entitlement: privileged role, active sub, full entitlement, or at least one
    // course/cascade grant. The client matches each downloaded course against
    // `courses` (or accepts a blanket renew when valid && privileged/sub/full).
    const valid =
      isPrivileged || subActive || hasFullEntitlement || courses.length > 0

    res.status(200).json({
      valid,
      // Blanket = "every downloaded course renews" (sub/full/admin). When false
      // but valid, only the courses listed in `courses` renew.
      blanket: isPrivileged || subActive || hasFullEntitlement,
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
