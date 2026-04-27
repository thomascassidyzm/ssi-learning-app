/**
 * Admin Users API - GET /api/admin/users
 *
 * Two modes:
 *   ?page=1&limit=50&search=foo  → paginated learner list with hero stats
 *   ?ids=uuid1,uuid2             → bulk fetch by user_id (no pagination, no stats)
 *
 * Joins learners with auth.users.email so admins can identify who they're
 * granting access to.
 *
 * Auth: ssi_admin only.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
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
    // Build user_id → email map from auth.users (one shot, paginated up to 10k).
    // Fine for staging-scale; revisit if user count grows past ~5k.
    const emailByUserId = new Map<string, string>()
    const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 10000,
    })
    if (authErr) throw authErr
    for (const u of authData.users || []) {
      if (u.email) emailByUserId.set(u.id, u.email)
    }

    // Mode A: bulk by ids (used by AdminUserDetail) ──────────────────────
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

      const enriched = (learners || []).map((l: LearnerRow) => ({
        ...l,
        email: emailByUserId.get(l.user_id) || null,
      }))

      res.status(200).json({ users: enriched })
      return
    }

    // Mode B: paginated list with hero stats ─────────────────────────────
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const offset = (page - 1) * limit

    let query = supabase
      .from('learners')
      .select('id, user_id, display_name, created_at, educational_role, platform_role', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (search) {
      // Match display_name (case-insensitive) OR user_ids whose email contains the search term.
      const matchedUserIds: string[] = []
      const needle = search.toLowerCase()
      for (const [uid, email] of emailByUserId) {
        if (email.toLowerCase().includes(needle)) matchedUserIds.push(uid)
      }
      // .or() with embedded list of ids — escape commas in display_name search isn't an issue here.
      const orParts = [`display_name.ilike.%${search}%`]
      if (matchedUserIds.length > 0) {
        orParts.push(`user_id.in.(${matchedUserIds.join(',')})`)
      }
      query = query.or(orParts.join(','))
    }

    query = query.range(offset, offset + limit - 1)

    const { data: learners, count, error: lErr } = await query
    if (lErr) throw lErr

    const enriched = (learners || []).map((l: LearnerRow) => ({
      ...l,
      email: emailByUserId.get(l.user_id) || null,
    }))

    // Hero stats — totalUsers and newThisWeek
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
      users: enriched,
      totalCount: count || 0,
      totalUsers: totalUsers || 0,
      newThisWeek: newThisWeek || 0,
    })
  } catch (error) {
    console.error('[AdminUsers] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
