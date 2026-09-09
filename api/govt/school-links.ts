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

  try {
    const { data: govtAdmin } = await supabase
      .from('govt_admins')
      .select('group_id')
      .eq('user_id', authResult.userId)
      .maybeSingle()
    if (!govtAdmin || !(govtAdmin as any).group_id) {
      res.status(403).json({ error: 'Only a government admin governing a group can view this' })
      return
    }
    const groupId = (govtAdmin as any).group_id as string

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
