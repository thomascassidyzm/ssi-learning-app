/**
 * Groups API - GET/POST /api/groups
 *
 * GET: List all groups (tree structure) — ssi_admin/god only.
 * POST: Create a new group.
 *   · ssi_admin/god: any parent, or a root org (no leader row minted — admins
 *     assign leadership via invite links).
 *   · a group-LEADER (govt_admin) adding a SUB-group within their own governed
 *     subtree (founder ruling 2026-08-01: a leader has "full authority over
 *     everything below them"). parent_id is validated SERVER-SIDE against
 *     their own govt_admins.group_id (self or strict descendant) — never taken
 *     on trust from the client.
 *   · ANY authenticated user creating a ROOT org (founder ruling 2026-08-02,
 *     groups all the way down: "anyone who creates one becomes its GROUP
 *     LEADER by default") — the caller's govt_admins row is minted in the
 *     same request. One org per leader (govt_admins is one-row-per-user
 *     across the whole org stack), so a caller who already leads a group
 *     gets a clear 409, not a silently re-pointed leadership.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../_utils/auth'
import { orgTrialStamp } from '../_utils/orgPlatform'
import { isMissingPlatformSchema } from '../_utils/schoolPlatformTrial'
import { isWithinLeaderSubtree } from '../_utils/orgLeader'

/**
 * ssi_admin/god first; fall back to a group-leader whose OWN governed group
 * is `parentId` itself or a strict ancestor of it (adding a sub-group
 * somewhere in THEIR subtree). Writes the 401/403 response itself and
 * returns null on rejection so the caller can `if (!caller) return`.
 */
async function resolveAdminOrLeaderForParent(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  parentId: string | undefined,
): Promise<{ userId: string; isAdmin: boolean; becomesLeader?: boolean } | null> {
  const adminResult = await verifyAdmin(req)
  if (!('error' in adminResult)) return { userId: adminResult.userId, isAdmin: true }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return null
  }
  const { data: govtAdmin } = await supabase
    .from('govt_admins')
    .select('group_id')
    .eq('user_id', authResult.userId)
    .maybeSingle()
  const ownGroupId = (govtAdmin as any)?.group_id as string | undefined
  if (!parentId) {
    // Root org creation (founder ruling 2026-08-02): open to any signed-in
    // user — the creator becomes the org's group leader. One org per leader:
    // govt_admins is one-row-per-user across the org stack, so an existing
    // leadership can't be silently re-pointed by creating a second root.
    if (ownGroupId) {
      res.status(409).json({ error: 'You already lead a group — one organisation per leader for now' })
      return null
    }
    return { userId: authResult.userId, isAdmin: false, becomesLeader: true }
  }
  if (!(await isWithinLeaderSubtree(supabase, ownGroupId, parentId))) {
    res.status(403).json({ error: 'You may only add a sub-group within your own governed group' })
    return null
  }
  return { userId: authResult.userId, isAdmin: false }
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!supabaseServiceKey) {
    console.error('[Groups] SUPABASE_SERVICE_ROLE_KEY is empty!')
    res.status(500).json({ error: 'Server misconfigured', detail: 'Missing service role key' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    const adminResult = await verifyAdmin(req)
    if ('error' in adminResult) {
      res.status(adminResult.status).json({ error: adminResult.error })
      return
    }
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
    const { name, type, parent_id, is_demo } = req.body || {}

    const caller = await resolveAdminOrLeaderForParent(req, res, supabase, parent_id)
    if (!caller) return
    const { isAdmin } = caller

    try {
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
      // on to any school attached anywhere in the subtree. ssi_admin-only:
      // a leader marking their own sub-group as a demo showcase is not a
      // decision that belongs to them.
      if (is_demo && isAdmin) row.is_demo = true

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

      // Creator = default leader (founder ruling 2026-08-02). Minted only for
      // the self-serve lane — an ssi_admin minting orgs for others assigns
      // leadership via invite links, not by absorbing it themselves.
      if (caller.becomesLeader && data?.id) {
        const { error: leaderError } = await supabase.from('govt_admins').insert({
          user_id: caller.userId,
          group_id: data.id,
          organization_name: data.name,
          created_by: caller.userId,
        })
        if (leaderError) {
          // Don't strand an orphaned root the caller can't see or manage.
          await supabase.from('groups').delete().eq('id', data.id)
          throw leaderError
        }
      }

      res.status(201).json({ group: data })
    } catch (error) {
      console.error('[Groups] Create error:', error)
      res.status(500).json({ error: 'Internal server error', detail: String(error) })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
