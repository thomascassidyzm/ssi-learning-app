/**
 * Create School API - POST /api/admin/create-school
 *
 * Replaces the three-write client flow in
 * packages/player-vue/src/views/admin/AdminStructure.vue::createSchool
 * (schools insert + two invite_codes inserts for teacher / admin join
 * codes). The schools insert still worked client-side, but the two
 * invite_codes inserts were silently failing as warnings after
 * 20260521180000_block_anon_role_escalation REVOKEd INSERT on
 * invite_codes — leaving schools that existed but whose join codes
 * couldn't be redeemed.
 *
 * Moves all three inserts server-side. Compensating delete on the
 * schools row if either invite_codes insert fails (supabase-js has
 * no multi-table txn).
 *
 * Requires ssi_admin / god caller — enforced by verifyAdmin().
 * This is the platform-admin AdminStructure view, not in-school
 * creation by a school_admin (which doesn't exist as a flow today).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { ensureSchoolNode } from '../_utils/schoolNode'
import { ensureSchoolAdminTag } from '../_utils/schoolStaff'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface CreateSchoolBody {
  school_name?: string
  group_id?: string | null
}

async function compensate(supabase: SupabaseClient, schoolId: string | null) {
  if (schoolId) {
    const { error } = await supabase.from('schools').delete().eq('id', schoolId)
    if (error) console.error('[CreateSchool] compensating delete schools failed:', error)
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  const body = (req.body || {}) as CreateSchoolBody
  const schoolName = (body.school_name || '').trim()
  const groupId = body.group_id ? body.group_id.trim() : null

  if (!schoolName) {
    res.status(400).json({ error: 'school_name is required' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  let schoolId: string | null = null

  try {
    // Step 1: insert school. teacher_join_code / admin_join_code are
    // populated by a DB default (random short code).
    const schoolRow: Record<string, unknown> = {
      school_name: schoolName,
      admin_user_id: adminResult.userId,
    }
    if (groupId) schoolRow.group_id = groupId

    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .insert(schoolRow)
      .select('id, school_name, teacher_join_code, admin_join_code, group_id, created_at')
      .single()

    if (schoolError || !school) {
      console.error('[CreateSchool] schools insert failed:', schoolError)
      res.status(500).json({ error: 'Failed to create school', detail: schoolError?.message })
      return
    }
    schoolId = school.id
    await ensureSchoolNode(supabase, { id: school.id as string, school_name: schoolName, group_id: groupId })

    // Step 2: invite_codes for teacher join code
    const { error: teacherCodeError } = await supabase.from('invite_codes').insert({
      code: school.teacher_join_code,
      code_type: 'teacher',
      grants_school_id: school.id,
      created_by: adminResult.userId,
      is_active: true,
    })

    if (teacherCodeError) {
      console.error('[CreateSchool] teacher invite_codes insert failed:', teacherCodeError)
      await compensate(supabase, schoolId)
      res.status(500).json({ error: 'Failed to create teacher join code', detail: teacherCodeError.message })
      return
    }

    // Step 3: invite_codes for admin join code
    const { error: adminCodeError } = await supabase.from('invite_codes').insert({
      code: school.admin_join_code,
      code_type: 'school_admin_join',
      grants_school_id: school.id,
      created_by: adminResult.userId,
      is_active: true,
    })

    if (adminCodeError) {
      console.error('[CreateSchool] admin invite_codes insert failed:', adminCodeError)
      // Best-effort cleanup of the teacher code we just wrote, then drop the school.
      await supabase.from('invite_codes').delete().eq('code', school.teacher_join_code)
      await compensate(supabase, schoolId)
      res.status(500).json({ error: 'Failed to create admin join code', detail: adminCodeError.message })
      return
    }

    // Step 4: the recorded admin's own membership row, so schools.admin_user_id
    // and user_tags never disagree about who is staff here. Without it the
    // school's admin is invisible to every staff-keyed read (see schoolStaff.ts).
    // NB this path records the CREATING ssi_admin as admin_user_id — a
    // placeholder until a real admin claims the seat via school_admin_join. The
    // tag makes that placeholder visible (they appear as the school's Admin)
    // rather than leaving admin_user_id and user_tags quietly out of step; if
    // the placeholder itself is wrong, the fix is admin_user_id, not the tag.
    // Non-fatal: no compensating delete — an untagged school is recoverable,
    // a deleted one is not.
    const tagErr = await ensureSchoolAdminTag(supabase, {
      userId: adminResult.userId,
      schoolId: school.id as string,
    })
    if (tagErr) console.warn('[CreateSchool] admin membership tag failed (non-fatal):', tagErr)

    console.log('[CreateSchool] created', school.id, schoolName, 'by', adminResult.userId)
    res.status(200).json({ school })
  } catch (err) {
    console.error('[CreateSchool] Error:', err)
    await compensate(supabase, schoolId)
    res.status(500).json({ error: 'Internal server error' })
  }
}
