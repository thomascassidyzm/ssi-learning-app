/**
 * Leader's Minted School Links API - GET /api/govt/school-links
 *
 * Lists school_admin invite codes bound to the CALLER'S OWN group (never a
 * client-supplied group id) with redemption state — the "link-with-state
 * list" of region-tier-design.md §1e. A leader shares these links however
 * they like (WhatsApp/email); this just tells them what's pending vs
 * redeemed and by which school.
 *
 * Requires auth; caller must have a govt_admins row with a group_id.
 *
 * Admin passthrough (View-as): an ssi_admin viewing /schools AS a group
 * leader (useActAs) carries their OWN bearer token, not the persona's — so
 * the caller-scoped govt_admins lookup finds no row and 403s (the reported
 * bug). Same fix shape as group-summary.ts: accept an explicit `?groupId=`
 * (the group being READ, never the caller's own scope) once verifyAdmin
 * confirms the caller is ssi_admin/god. A real group leader still always
 * derives their OWN group and never trusts a client-supplied id.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken, verifyAdmin } from '../_utils/auth'

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
  const requestedGroupId = typeof req.query.groupId === 'string' ? req.query.groupId : null

  try {
    const { data: govtAdmin } = await supabase
      .from('govt_admins')
      .select('group_id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    let groupId: string
    if (govtAdmin && (govtAdmin as any).group_id) {
      // A real group leader always sees their OWN group — a client-supplied
      // groupId is never trusted for this branch.
      groupId = (govtAdmin as any).group_id as string
    } else if (requestedGroupId) {
      // Admin passthrough: only a verified ssi_admin (View-as) may read an
      // arbitrary group's links; a plain authed user with no govt_admins row
      // gets the same 403 as before.
      const adminResult = await verifyAdmin(req)
      if ('error' in adminResult) {
        res.status(403).json({ error: 'Only a government admin governing a group can view this' })
        return
      }
      groupId = requestedGroupId
    } else {
      res.status(403).json({ error: 'Only a government admin governing a group can view this' })
      return
    }

    const { data: codes, error: codesError } = await supabase
      .from('invite_codes')
      .select('id, code, metadata, use_count, max_uses, is_active, created_at')
      .eq('code_type', 'school_admin')
      .eq('grants_group_id', groupId)
      .order('created_at', { ascending: false })
    if (codesError) throw codesError

    const { data: schools, error: schoolsError } = await supabase
      .from('schools')
      .select('id, school_name, invite_code_id, admin_user_id, created_at')
      .eq('group_id', groupId)
    if (schoolsError) throw schoolsError

    const schoolByInviteId = new Map<string, any>()
    for (const s of schools || []) {
      if (s.invite_code_id) schoolByInviteId.set(s.invite_code_id as string, s)
    }

    const links = (codes || []).map((c: any) => {
      const school = schoolByInviteId.get(c.id) || null
      return {
        id: c.id,
        code: c.code,
        label: c.metadata?.school_name || null,
        is_active: c.is_active,
        created_at: c.created_at,
        redeemed: !!school,
        school: school
          ? {
              id: school.id,
              school_name: school.school_name,
              claimed: !!school.admin_user_id,
              created_at: school.created_at,
            }
          : null,
      }
    })

    res.status(200).json({ links })
  } catch (error) {
    console.error('[GovtSchoolLinks] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
