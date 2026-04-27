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
const MAX_LIMIT = 200

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

  const { data: rows, error } = await supabase
    .from('learner_emails')
    .select('learner_id, email, is_primary')
    .in('learner_id', learnerIds)
    .order('is_primary', { ascending: false })

  if (error) {
    console.warn('[AdminUsers] loadEmails error:', error)
    return out
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

    let query = supabase
      .from('learners')
      .select('id, user_id, display_name, created_at, educational_role, platform_role', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (search) {
      const orParts = [`display_name.ilike.%${search}%`]
      if (learnerIdsMatchingEmail.length > 0) {
        orParts.push(`id.in.(${learnerIdsMatchingEmail.join(',')})`)
      }
      query = query.or(orParts.join(','))
    }

    query = query.range(offset, offset + limit - 1)

    const { data: learners, count, error: lErr } = await query
    if (lErr) throw lErr

    const learnerIds = (learners || []).map(l => l.id)
    const emailMap = await loadEmails(supabase, learnerIds)

    const { count: totalUsers } = await supabase
      .from('learners')
      .select('id', { count: 'exact', head: true })

    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const { count: newThisWeek } = await supabase
      .from('learners')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekAgo.toISOString())

    res.status(200).json({
      users: enrich(learners || [], emailMap),
      totalCount: count || 0,
      totalUsers: totalUsers || 0,
      newThisWeek: newThisWeek || 0,
    })
  } catch (error) {
    console.error('[AdminUsers] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
