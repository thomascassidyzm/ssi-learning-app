/**
 * Create Govt Admin API - POST /api/admin/create-govt-admin
 *
 * Replaces the three direct client INSERTs in
 * packages/player-vue/src/views/admin/SchoolsSetup.vue::createGovtAdmin
 * that were blocked by 20260521180000_block_anon_role_escalation.sql
 * (REVOKE INSERT on learners, govt_admins, invite_codes).
 *
 * Performs three inserts in order under the service-role client:
 *   1. learners       (synthetic-user pattern, user_id like 'govt_<…>')
 *   2. govt_admins    (linked by user_id, with group_id + region_code)
 *   3. invite_codes   (per-admin one-shot code)
 *
 * No multi-table transaction is available via supabase-js; on failure
 * after the first insert we run compensating deletes on rows already
 * written so the database doesn't drift.
 *
 * Requires ssi_admin / god caller — enforced by verifyAdmin().
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface CreateGovtAdminBody {
  display_name?: string
  email?: string
  group_id?: string
  organization_name?: string
}

function generateInviteCode(): string {
  const part = () => Math.random().toString(36).slice(2, 5).toUpperCase()
  return `${part()}-${part()}`
}

async function compensate(
  supabase: SupabaseClient,
  learnerRowId: string | null,
  govtAdminUserId: string | null,
) {
  if (govtAdminUserId) {
    const { error } = await supabase.from('govt_admins').delete().eq('user_id', govtAdminUserId)
    if (error) console.error('[CreateGovtAdmin] compensating delete govt_admins failed:', error)
  }
  if (learnerRowId) {
    const { error } = await supabase.from('learners').delete().eq('id', learnerRowId)
    if (error) console.error('[CreateGovtAdmin] compensating delete learners failed:', error)
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

  const body = (req.body || {}) as CreateGovtAdminBody
  const displayName = (body.display_name || '').trim()
  const email = (body.email || '').trim().toLowerCase()
  const groupId = (body.group_id || '').trim()
  const organizationName = (body.organization_name || '').trim()

  if (!displayName) {
    res.status(400).json({ error: 'display_name is required' })
    return
  }
  if (!email) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  if (!groupId) {
    res.status(400).json({ error: 'group_id is required' })
    return
  }
  if (!organizationName) {
    res.status(400).json({ error: 'organization_name is required' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const userId = `govt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  let learnerRowId: string | null = null
  let govtAdminUserId: string | null = null

  try {
    // Step 1: derive region_code (best-effort, for backward compat)
    let regionCode: string | null = null
    const { data: group } = await supabase
      .from('groups')
      .select('id, name')
      .eq('id', groupId)
      .single()

    if (group) {
      const { data: region } = await supabase
        .from('regions')
        .select('code')
        .ilike('name', group.name)
        .maybeSingle()
      if (region) regionCode = region.code
    }

    // Step 2: insert learner
    const { data: learner, error: learnerError } = await supabase
      .from('learners')
      .insert({
        user_id: userId,
        display_name: displayName,
        educational_role: 'govt_admin',
        verified_emails: email ? [email] : [],
      })
      .select('id, user_id')
      .single()

    if (learnerError || !learner) {
      console.error('[CreateGovtAdmin] learners insert failed:', learnerError)
      res.status(500).json({ error: 'Failed to create learner', detail: learnerError?.message })
      return
    }
    learnerRowId = learner.id

    // Step 3: insert govt_admins
    const govtInsert: Record<string, unknown> = {
      user_id: userId,
      group_id: groupId,
      organization_name: organizationName,
      created_by: adminResult.userId,
    }
    if (regionCode) govtInsert.region_code = regionCode

    const { error: govtError } = await supabase.from('govt_admins').insert(govtInsert)
    if (govtError) {
      console.error('[CreateGovtAdmin] govt_admins insert failed:', govtError)
      await compensate(supabase, learnerRowId, null)
      res.status(500).json({ error: 'Failed to create govt_admin', detail: govtError.message })
      return
    }
    govtAdminUserId = userId

    // Step 4: insert invite_codes
    const code = generateInviteCode()
    const { error: codeError } = await supabase.from('invite_codes').insert({
      code,
      code_type: 'govt_admin',
      created_by: adminResult.userId,
      grants_group_id: groupId,
      grants_region: regionCode,
      max_uses: 1,
      metadata: {
        organization_name: organizationName,
        recipient_email: email,
        recipient_name: displayName,
      },
    })

    if (codeError) {
      console.error('[CreateGovtAdmin] invite_codes insert failed:', codeError)
      await compensate(supabase, learnerRowId, govtAdminUserId)
      res.status(500).json({ error: 'Failed to create invite code', detail: codeError.message })
      return
    }

    console.log('[CreateGovtAdmin] created govt_admin', userId, 'group', groupId, 'by', adminResult.userId)
    res.status(200).json({
      learner_id: learnerRowId,
      user_id: userId,
      invite_code: code,
      region_code: regionCode,
    })
  } catch (err) {
    console.error('[CreateGovtAdmin] Error:', err)
    await compensate(supabase, learnerRowId, govtAdminUserId)
    res.status(500).json({ error: 'Internal server error' })
  }
}
