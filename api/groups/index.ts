/**
 * Groups API - GET/POST /api/groups
 *
 * GET: List all groups (tree structure)
 * POST: Create a new group
 *
 * Requires auth. Only ssi_admin/god users.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { orgTrialStamp } from '../_utils/orgPlatform'
import { isMissingPlatformSchema } from '../_utils/schoolPlatformTrial'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  if (!supabaseServiceKey) {
    console.error('[Groups] SUPABASE_SERVICE_ROLE_KEY is empty!')
    res.status(500).json({ error: 'Server misconfigured', detail: 'Missing service role key' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    try {
      const { data: groups, error } = await supabase
        .from('groups')
        .select('id, name, type, parent_id, path, is_demo, is_test, created_at')
        .order('name')

      if (error) throw error

      // Also fetch school counts per group
      const { data: schools } = await supabase
        .from('schools')
        .select('id, group_id')

      const schoolCounts: Record<string, number> = {}
      for (const s of schools || []) {
        if (s.group_id) {
          schoolCounts[s.group_id] = (schoolCounts[s.group_id] || 0) + 1
        }
      }

      // Also fetch grant info per group
      const { data: grants } = await supabase
        .from('entitlement_grants')
        .select('group_id, granted_courses')
        .not('group_id', 'is', null)

      const grantMap: Record<string, string[]> = {}
      for (const g of grants || []) {
        if (g.group_id) {
          grantMap[g.group_id] = g.granted_courses
        }
      }

      const enriched = (groups || []).map((g) => ({
        ...g,
        school_count: schoolCounts[g.id] || 0,
        granted_courses: grantMap[g.id] || [],
      }))

      res.status(200).json({ groups: enriched })
    } catch (error) {
      console.error('[Groups] List error:', error)
      res.status(500).json({ error: 'Internal server error', detail: String(error) })
    }
  } else if (req.method === 'POST') {
    try {
      const { name, type, parent_id, is_demo } = req.body || {}

      if (!name?.trim()) {
        res.status(400).json({ error: 'Group name is required' })
        return
      }

      const row: Record<string, unknown> = {
        name: name.trim(),
        // Root-level orgs default to 'organisation'; a parent_id implies a
        // sub-group of an existing tree, kept as the free-text 'group'
        // default it always had — never overridden unless the caller says so.
        type: type?.trim() || (parent_id ? 'group' : 'organisation'),
      }
      if (parent_id) row.parent_id = parent_id
      // is_demo is the ONLY flag on an organisation that marks it as a sales
      // showcase (founder ruling) — demo and real orgs share every other
      // code path. groups_inherit_parent_test_flags cascades this to every
      // descendant group, and schools_inherit_group_test_flags cascades it
      // on to any school attached anywhere in the subtree.
      if (is_demo) row.is_demo = true

      // Trial clock (founder ruling 2026-08-01): a NEW ORG gets 30 days of
      // all-language access from the moment it exists. Only ROOT nodes get a
      // clock — a sub-group is part of its org and bills through the org's own
      // row, so stamping it would start a second, competing clock on the same
      // customer. Upgrading converts this same row in place (trial → active).
      const isRootOrg = !parent_id
      if (isRootOrg) Object.assign(row, orgTrialStamp())

      let { data, error } = await supabase
        .from('groups')
        .insert(row)
        .select()
        .single()

      // Fail open on an un-migrated DB (20260801_org_platform_billing not yet
      // applied): retry the plain insert so org creation never depends on the
      // billing columns existing. Mirrors schoolPlatformTrial's no-op posture.
      if (error && isRootOrg && isMissingPlatformSchema(error)) {
        delete (row as Record<string, unknown>).platform_status
        delete (row as Record<string, unknown>).platform_expires_at
        ;({ data, error } = await supabase.from('groups').insert(row).select().single())
      }

      if (error) throw error
      res.status(201).json({ group: data })
    } catch (error) {
      console.error('[Groups] Create error:', error)
      res.status(500).json({ error: 'Internal server error', detail: String(error) })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
