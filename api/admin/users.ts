/**
 * Admin Users API - GET /api/admin/users
 *
 * Two modes:
 *   ?page=1&limit=50&search=foo  → paginated learner list with hero stats
 *   ?ids=uuid1,uuid2             → bulk fetch by user_id (no pagination, no stats)
 *
 * Each user can have multiple emails (multi-provider OAuth, etc.). The
 * response returns primary_email and an emails[] array per user. Search
 * matches display_name OR ANY email belonging to the user.
 *
 * Auth: ssi_admin only.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 10000

// PostgREST URL cap is ~16KB. A UUID + comma is ~37 chars, ~39 once
// URL-encoded, so a single .in() with all 1348 learner IDs blows past it
// (~50KB) and the request fails. 200 IDs per chunk ≈ 7.8KB. Same cap the
// frontend hits chunking course_enrollments.
const EMAIL_FETCH_CHUNK_SIZE = 200

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

interface LearnerRow {
  id: string
  user_id: string
  display_name: string | null
  created_at: string
  educational_role: string | null
  platform_role: string | null
}

interface EnrichedLearner extends LearnerRow {
  primary_email: string | null
  emails: string[]
}

/**
 * Loads emails for a set of learner_ids. Returns map of learner_id → {primary, all}.
 */
async function loadEmails(
  supabase: SupabaseClient,
  learnerIds: string[],
): Promise<Map<string, { primary: string | null; all: string[] }>> {
  const out = new Map<string, { primary: string | null; all: string[] }>()
  if (learnerIds.length === 0) return out

  const chunks = chunk(learnerIds, EMAIL_FETCH_CHUNK_SIZE)
  const results = await Promise.all(
    chunks.map(ids =>
      supabase
        .from('learner_emails')
        .select('learner_id, email, is_primary')
        .in('learner_id', ids)
        .order('is_primary', { ascending: false }),
    ),
  )

  for (const { data: rows, error } of results) {
    if (error) {
      console.warn('[AdminUsers] loadEmails chunk error:', error)
      continue
    }
    for (const r of rows || []) {
      let entry = out.get(r.learner_id)
      if (!entry) {
        entry = { primary: null, all: [] }
        out.set(r.learner_id, entry)
      }
      entry.all.push(r.email)
      if (r.is_primary && !entry.primary) entry.primary = r.email
    }
  }
  return out
}

function enrich(
  learners: LearnerRow[],
  emailMap: Map<string, { primary: string | null; all: string[] }>,
): EnrichedLearner[] {
  return learners.map(l => {
    const emails = emailMap.get(l.id)
    return {
      ...l,
      primary_email: emails?.primary || emails?.all[0] || null,
      emails: emails?.all || [],
    }
  })
}

type Tier = 'admin' | 'school' | 'premium' | 'free'

interface EnrollmentAgg {
  last_active: string | null
  practice_minutes: number
  course_ids: string[]
}

/** learner_ids that have an ACTIVE paid subscription (status active + not expired). */
async function loadActiveSubscriptions(
  supabase: SupabaseClient,
  learnerIds: string[],
): Promise<Set<string>> {
  const active = new Set<string>()
  if (learnerIds.length === 0) return active
  const now = Date.now()
  const results = await Promise.all(
    chunk(learnerIds, EMAIL_FETCH_CHUNK_SIZE).map(ids =>
      supabase
        .from('subscriptions')
        .select('learner_id, status, current_period_end')
        .in('learner_id', ids)
        .eq('status', 'active'),
    ),
  )
  for (const { data: rows, error } of results) {
    if (error) { console.warn('[AdminUsers] subscriptions chunk error:', error); continue }
    for (const r of rows || []) {
      // null current_period_end = lifetime; else must be in the future
      if (!r.current_period_end || new Date(r.current_period_end).getTime() > now) {
        active.add(r.learner_id)
      }
    }
  }
  return active
}

/** learner_ids with an ACTIVE entitlement granting paid access (full | courses, not expired). */
async function loadActiveEntitlements(
  supabase: SupabaseClient,
  learnerIds: string[],
): Promise<Set<string>> {
  const has = new Set<string>()
  if (learnerIds.length === 0) return has
  const now = Date.now()
  const results = await Promise.all(
    chunk(learnerIds, EMAIL_FETCH_CHUNK_SIZE).map(ids =>
      supabase
        .from('user_entitlements')
        .select('learner_id, access_type, expires_at')
        .in('learner_id', ids),
    ),
  )
  for (const { data: rows, error } of results) {
    if (error) { console.warn('[AdminUsers] entitlements chunk error:', error); continue }
    for (const r of rows || []) {
      if (r.expires_at && new Date(r.expires_at).getTime() <= now) continue
      if (r.access_type === 'full' || r.access_type === 'courses') has.add(r.learner_id)
    }
  }
  return has
}

/** Per-learner enrollment rollup: most-recent activity, total practice, course list. */
async function loadEnrollmentAgg(
  supabase: SupabaseClient,
  learnerIds: string[],
): Promise<Map<string, EnrollmentAgg>> {
  const out = new Map<string, EnrollmentAgg>()
  if (learnerIds.length === 0) return out
  const results = await Promise.all(
    chunk(learnerIds, EMAIL_FETCH_CHUNK_SIZE).map(ids =>
      supabase
        .from('course_enrollments')
        .select('learner_id, course_id, last_practiced_at, total_practice_minutes')
        .in('learner_id', ids),
    ),
  )
  for (const { data: rows, error } of results) {
    if (error) { console.warn('[AdminUsers] enrollments chunk error:', error); continue }
    for (const e of rows || []) {
      let entry = out.get(e.learner_id)
      if (!entry) { entry = { last_active: null, practice_minutes: 0, course_ids: [] }; out.set(e.learner_id, entry) }
      entry.course_ids.push(e.course_id)
      entry.practice_minutes += e.total_practice_minutes || 0
      if (e.last_practiced_at && (!entry.last_active || e.last_practiced_at > entry.last_active)) {
        entry.last_active = e.last_practiced_at
      }
    }
  }
  return out
}

/**
 * Practice minutes derived from telemetry (player_events) — the single source
 * of truth for stats. Replaces course_enrollments.total_practice_minutes, a
 * per-write counter that stopped being maintained ~mid-April 2026 and so
 * under-reported practice everywhere. Returns null if the RPC errors, so the
 * caller can fall back to the (stale) counter rather than show 0 for everyone.
 */
async function loadDerivedPracticeMinutes(
  supabase: SupabaseClient,
  learnerIds: string[],
): Promise<Map<string, number> | null> {
  if (learnerIds.length === 0) return new Map()
  const { data, error } = await supabase.rpc('admin_practice_minutes', { p_learner_ids: learnerIds })
  if (error) { console.warn('[AdminUsers] practice RPC error, falling back to counter:', error); return null }
  const out = new Map<string, number>()
  for (const row of data || []) out.set(row.learner_id, row.practice_minutes || 0)
  return out
}

/**
 * Authoritative access tier, mirroring core/src/pricing/access.ts precedence:
 *   ssi_admin/tester role > school role > active subscription > active entitlement > free.
 */
function tierFor(
  l: LearnerRow,
  activeSubs: Set<string>,
  activeEnts: Set<string>,
): Tier {
  if (l.platform_role === 'ssi_admin' || l.platform_role === 'tester') return 'admin'
  if (l.educational_role === 'teacher' || l.educational_role === 'school_admin' || l.educational_role === 'govt_admin') {
    return 'school'
  }
  if (activeSubs.has(l.id) || activeEnts.has(l.id)) return 'premium'
  return 'free'
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  if (!supabaseServiceKey) {
    console.error('[AdminUsers] SUPABASE_SERVICE_ROLE_KEY is empty')
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Mode A: bulk by user_ids (used by AdminUserDetail) ────────────────
    const idsParam = req.query.ids
    if (typeof idsParam === 'string' && idsParam.length > 0) {
      const userIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
      if (userIds.length === 0) {
        res.status(200).json({ users: [] })
        return
      }

      const { data: learners, error: lErr } = await supabase
        .from('learners')
        .select('id, user_id, display_name, created_at, educational_role, platform_role')
        .in('user_id', userIds)

      if (lErr) throw lErr

      const learnerIds = (learners || []).map(l => l.id)
      const emailMap = await loadEmails(supabase, learnerIds)
      res.status(200).json({ users: enrich(learners || [], emailMap) })
      return
    }

    // Mode B: paginated list with hero stats ────────────────────────────
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const offset = (page - 1) * limit

    let learnerIdsMatchingEmail: string[] = []
    if (search) {
      const { data: emailMatches } = await supabase
        .from('learner_emails')
        .select('learner_id')
        .ilike('email', `%${search}%`)
      learnerIdsMatchingEmail = Array.from(new Set((emailMatches || []).map(r => r.learner_id)))
    }

    // Class entities (owner ruling 2026-07-16: a class is a first-class
    // learner, own uuid, own course_enrollments row) are neither a human user
    // nor test data — they'd just confuse this list, so exclude them here the
    // same way board metrics do via test_learner_ids().
    let query = supabase
      .from('learners')
      .select('id, user_id, display_name, created_at, educational_role, platform_role', { count: 'exact' })
      .eq('is_class_entity', false)
      .order('created_at', { ascending: false })

    if (search) {
      const orParts = [`display_name.ilike.%${search}%`]
      if (learnerIdsMatchingEmail.length > 0) {
        orParts.push(`id.in.(${learnerIdsMatchingEmail.join(',')})`)
      }
      query = query.or(orParts.join(','))
    }

    query = query.range(offset, offset + limit - 1)

    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)

    // The two hero-stat counts don't depend on learnerIds, so kick them off
    // alongside the page query itself rather than after it — one network
    // round-trip wave instead of two.
    const [{ data: learners, count, error: lErr }, { count: totalUsers }, { count: newThisWeek }] = await Promise.all([
      query,
      supabase.from('learners').select('id', { count: 'exact', head: true }).eq('is_class_entity', false),
      supabase.from('learners').select('id', { count: 'exact', head: true }).eq('is_class_entity', false).gte('created_at', weekAgo.toISOString()),
    ])
    if (lErr) throw lErr

    const learnerIds = (learners || []).map(l => l.id)

    // Fetch everything the list needs in ONE server round-trip (service role,
    // indexed on learner_id) so the client renders immediately instead of
    // firing its own per-learner enrollment fetches. Each user comes back
    // self-contained: emails, access tier, and an activity rollup.
    const [emailMap, activeSubs, activeEnts, enrollAgg, practiceMap] = await Promise.all([
      loadEmails(supabase, learnerIds),
      loadActiveSubscriptions(supabase, learnerIds),
      loadActiveEntitlements(supabase, learnerIds),
      loadEnrollmentAgg(supabase, learnerIds),
      loadDerivedPracticeMinutes(supabase, learnerIds),
    ])

    const users = (learners || []).map(l => {
      const emails = emailMap.get(l.id)
      const agg = enrollAgg.get(l.id)
      return {
        ...l,
        primary_email: emails?.primary || emails?.all[0] || null,
        emails: emails?.all || [],
        tier: tierFor(l, activeSubs, activeEnts),
        last_active: agg?.last_active ?? null,
        // Derived from telemetry (SSoT); fall back to the legacy counter only if
        // the RPC errored (practiceMap === null), never just because a learner
        // has no telemetry — that legitimately means 0.
        practice_minutes: practiceMap ? (practiceMap.get(l.id) ?? 0) : (agg?.practice_minutes ?? 0),
        course_ids: agg?.course_ids ?? [],
      }
    })

    res.status(200).json({
      users,
      totalCount: count || 0,
      totalUsers: totalUsers || 0,
      newThisWeek: newThisWeek || 0,
    })
  } catch (error) {
    console.error('[AdminUsers] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
