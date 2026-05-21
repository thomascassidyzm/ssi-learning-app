/**
 * Create Staff API - POST /api/admin/create-staff
 *
 * Replaces the two direct client INSERTs in
 * packages/player-vue/src/views/admin/SchoolsSetup.vue::createStaff
 * that were blocked by 20260521180000_block_anon_role_escalation.sql
 * (REVOKE INSERT on learners).
 *
 * Performs two inserts in order under the service-role client:
 *   1. learners    (synthetic-user pattern, user_id like 'staff_<…>')
 *   2. user_tags   (link learner to school with tag_type='school',
 *                   tag_value='SCHOOL:<schoolId>', role_in_context)
 *
 * On failure after the first insert, runs a compensating delete on
 * the learner row so the database doesn't drift.
 *
 * Requires ssi_admin / god caller — enforced by verifyAdmin().
 * SchoolsSetup is the platform-admin school provisioning view, not
 * the per-school teacher onboarding flow, so the ssi_admin gate is
 * correct here. School-admin-driven teacher creation lives on
 * /schools/teachers and is a separate retrofit if/when needed.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface CreateStaffBody {
  display_name?: string
  email?: string
  school_id?: string
  role?: 'teacher' | 'admin'
}

async function compensate(supabase: SupabaseClient, learnerRowId: string | null) {
  if (learnerRowId) {
    const { error } = await supabase.from('learners').delete().eq('id', learnerRowId)
    if (error) console.error('[CreateStaff] compensating delete learners failed:', error)
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

  const body = (req.body || {}) as CreateStaffBody
  const displayName = (body.display_name || '').trim()
  const email = (body.email || '').trim().toLowerCase()
  const schoolId = (body.school_id || '').trim()
  const role = body.role

  if (!displayName) {
    res.status(400).json({ error: 'display_name is required' })
    return
  }
  if (!email) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  if (!schoolId) {
    res.status(400).json({ error: 'school_id is required' })
    return
  }
  if (role !== 'teacher' && role !== 'admin') {
    res.status(400).json({ error: "role must be 'teacher' or 'admin'" })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const userId = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  const educationalRole = role === 'admin' ? 'school_admin' : 'teacher'
  const roleInContext = role === 'admin' ? 'admin' : 'teacher'
  let learnerRowId: string | null = null

  try {
    // Step 1: insert learner
    const { data: learner, error: learnerError } = await supabase
      .from('learners')
      .insert({
        user_id: userId,
        display_name: displayName,
        educational_role: educationalRole,
        verified_emails: email ? [email] : [],
      })
      .select('id, user_id')
      .single()

    if (learnerError || !learner) {
      console.error('[CreateStaff] learners insert failed:', learnerError)
      res.status(500).json({ error: 'Failed to create learner', detail: learnerError?.message })
      return
    }
    learnerRowId = learner.id

    // Step 2: insert user_tags linking learner to school
    const { error: tagError } = await supabase.from('user_tags').insert({
      user_id: userId,
      tag_type: 'school',
      tag_value: `SCHOOL:${schoolId}`,
      role_in_context: roleInContext,
      added_by: adminResult.userId,
    })

    if (tagError) {
      console.error('[CreateStaff] user_tags insert failed:', tagError)
      await compensate(supabase, learnerRowId)
      res.status(500).json({ error: 'Failed to link staff to school', detail: tagError.message })
      return
    }

    console.log('[CreateStaff] created', educationalRole, userId, 'school', schoolId, 'by', adminResult.userId)
    res.status(200).json({
      learner_id: learnerRowId,
      user_id: userId,
      educational_role: educationalRole,
    })
  } catch (err) {
    console.error('[CreateStaff] Error:', err)
    await compensate(supabase, learnerRowId)
    res.status(500).json({ error: 'Internal server error' })
  }
}
