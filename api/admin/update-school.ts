/**
 * Update School API - PATCH /api/admin/update-school
 *
 * Repoints SchoolsSetup.vue::updateSchoolGroup off a direct client
 * `schools.update()` — the 2026-07-04 grant-hygiene window left the org
 * tables' authenticated UPDATE grant revoked live (see CLAUDE.md RLS
 * section), so the client PATCH was 403ing. Org-table writes go through
 * server-mediated endpoints under verifyAdmin — see create-school.ts.
 *
 * Only sets/clears schools.group_id today (the one field SchoolsSetup.vue
 * needs). Validates the target group exists when non-null.
 *
 * Requires ssi_admin / god caller — enforced by verifyAdmin().
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface UpdateSchoolBody {
  school_id?: string
  group_id?: string | null
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'PATCH') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  const body = (req.body || {}) as UpdateSchoolBody
  const schoolId = (body.school_id || '').trim()
  const groupId = body.group_id ? body.group_id.trim() : null

  if (!schoolId) {
    res.status(400).json({ error: 'school_id is required' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    if (groupId) {
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .select('id')
        .eq('id', groupId)
        .maybeSingle()

      if (groupError) {
        console.error('[UpdateSchool] group lookup failed:', groupError)
        res.status(500).json({ error: 'Failed to verify group', detail: groupError.message })
        return
      }
      if (!group) {
        res.status(400).json({ error: 'Group not found' })
        return
      }
    }

    const { data: school, error: updateError } = await supabase
      .from('schools')
      .update({ group_id: groupId })
      .eq('id', schoolId)
      .select('id, school_name, group_id')
      .single()

    if (updateError || !school) {
      console.error('[UpdateSchool] schools update failed:', updateError)
      res.status(500).json({ error: 'Failed to update school', detail: updateError?.message })
      return
    }

    console.log('[UpdateSchool] updated', schoolId, 'group_id ->', groupId, 'by', adminResult.userId)
    res.status(200).json({ school })
  } catch (err) {
    console.error('[UpdateSchool] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
