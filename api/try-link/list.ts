/**
 * Try Link List API - GET /api/try-link/list
 *
 * Admin-only. Returns all try links with visit counts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify caller is admin
  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', authResult.userId)
    .single()

  if (!learner || (learner.platform_role !== 'ssi_admin' && learner.educational_role !== 'god')) {
    res.status(403).json({ error: 'Only SSi admins can view try links' })
    return
  }

  try {
    // Fetch all try links
    const { data: links, error: linksError } = await supabase
      .from('try_links')
      .select('*')
      .order('created_at', { ascending: false })

    if (linksError) {
      throw linksError
    }

    if (!links || links.length === 0) {
      res.status(200).json({ links: [] })
      return
    }

    // Fetch visit counts (total + unique) for each link
    const linkIds = links.map(l => l.id)

    const { data: visits, error: visitsError } = await supabase
      .from('try_link_visits')
      .select('try_link_id, ip_hash')
      .in('try_link_id', linkIds)

    if (visitsError) {
      console.warn('[TryLinkList] Failed to fetch visits:', visitsError)
    }

    // Aggregate counts
    const visitCounts: Record<string, { total: number; unique: number }> = {}
    for (const v of (visits || [])) {
      if (!visitCounts[v.try_link_id]) {
        visitCounts[v.try_link_id] = { total: 0, unique: 0 }
      }
      visitCounts[v.try_link_id].total++
    }

    // Count unique IPs per link
    const uniqueIps: Record<string, Set<string>> = {}
    for (const v of (visits || [])) {
      if (!uniqueIps[v.try_link_id]) {
        uniqueIps[v.try_link_id] = new Set()
      }
      if (v.ip_hash) {
        uniqueIps[v.try_link_id].add(v.ip_hash)
      }
    }

    // Merge counts into links
    const enriched = links.map(link => ({
      ...link,
      visit_count: visitCounts[link.id]?.total ?? 0,
      unique_visitors: uniqueIps[link.id]?.size ?? 0,
      is_expired: link.expires_at ? new Date(link.expires_at) < new Date() : false,
    }))

    res.status(200).json({ links: enriched })
  } catch (error: any) {
    console.error('[TryLinkList] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
