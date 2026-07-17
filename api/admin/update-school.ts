/**
 * Update / Delete School API - GET | PATCH | DELETE /api/admin/update-school
 *
 * Repoints SchoolsSetup.vue::updateSchoolGroup and ::deleteSchool off direct
 * client `schools.update()`/`schools.delete()` — the 2026-07-04 grant-hygiene
 * window left the org tables' authenticated UPDATE/DELETE grants revoked live
 * (see CLAUDE.md RLS section), so both client calls were 403ing. Org-table
 * writes go through server-mediated endpoints under verifyAdmin — see
 * create-school.ts.
 *
 * PATCH only sets/clears schools.group_id today (the one field
 * SchoolsSetup.vue needs). Validates the target group exists when non-null.
 *
 * GET returns a deletion-impact preview (classes/sessions/learners, whether
 * there's real recorded activity) — the confirm dialog in SchoolsSetup.vue
 * calls this before DELETE so the admin sees what dies with the school.
 *
 * DELETE cascades invite_codes/user_tags cleanup before removing the school
 * row (classes/class_sessions/entitlement_grants cascade automatically via
 * ON DELETE CASCADE — see schoolGroupDeletion.ts for why the manual cleanup
 * is needed at all: every school gets 2 invite_codes rows at creation, and
 * that FK has no ON DELETE behaviour, so a bare `schools.delete()` 500s on
 * essentially every real school). If the school has real recorded activity
 * (any class_sessions.cycles_completed > 0), the caller must pass
 * `confirm_name` matching the school's name exactly — a plain confirm is not
 * enough for a school someone has actually used.
 *
 * Every delete is logged to player_events (event_type admin_school_deleted)
 * with the impact counts, best-effort, non-blocking.
 *
 * Requires ssi_admin / god caller — enforced by verifyAdmin().
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { computeSchoolImpact, deleteSchoolCascade } from '../_utils/schoolGroupDeletion'
import { auditAdminDelete } from '../_utils/auditAdminDelete'

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
  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    const schoolId = ((req.query.school_id as string) || '').trim()
    if (!schoolId) {
      res.status(400).json({ error: 'school_id is required' })
      return
    }
    try {
      const impact = await computeSchoolImpact(supabase, schoolId)
      res.status(200).json({ impact })
    } catch (err: any) {
      const notFound = /not found/i.test(err?.message || '')
      res.status(notFound ? 404 : 500).json({ error: err?.message || 'Failed to compute impact' })
    }
    return
  }

  if (req.method === 'DELETE') {
    const schoolId = ((req.query.school_id as string) || (req.body as UpdateSchoolBody)?.school_id || '').trim()
    const confirmName = ((req.query.confirm_name as string) || (req.body as any)?.confirm_name || '').trim()
    if (!schoolId) {
      res.status(400).json({ error: 'school_id is required' })
      return
    }
    try {
      const impact = await computeSchoolImpact(supabase, schoolId)

      if (impact.hasRealActivity && confirmName !== impact.schoolName) {
        res.status(409).json({
          error: 'This school has real recorded activity — type the school name exactly to confirm deletion',
          requires_confirm_name: true,
          impact,
        })
        return
      }

      await deleteSchoolCascade(supabase, schoolId)

      console.log('[UpdateSchool] deleted', schoolId, 'by', adminResult.userId)
      await auditAdminDelete(supabase, {
        actorUserId: adminResult.userId,
        eventType: 'admin_school_deleted',
        payload: { school_id: schoolId, school_name: impact.schoolName, impact },
      })
      res.status(200).json({ success: true, impact })
    } catch (err: any) {
      console.error('[UpdateSchool] Error:', err)
      const notFound = /not found/i.test(err?.message || '')
      res.status(notFound ? 404 : 500).json({ error: err?.message || 'Failed to delete school' })
    }
    return
  }

  const body = (req.body || {}) as UpdateSchoolBody
  const schoolId = (body.school_id || '').trim()
  const groupId = body.group_id ? body.group_id.trim() : null

  if (!schoolId) {
    res.status(400).json({ error: 'school_id is required' })
    return
  }

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
