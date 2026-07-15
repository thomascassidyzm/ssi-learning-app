/**
 * Create Govt Admin API - POST /api/admin/create-govt-admin
 *
 * Mints a one-shot govt_admin invite code. Does NOT pre-create a learner or
 * govt_admins row: the old synthetic-user pattern (a fake `govt_<timestamp>`
 * user_id) was dead weight — on redemption a SECOND, real govt_admins row is
 * created under the real auth uid (api/code/redeem.ts), and the synthetic
 * one was never linked to anyone who could log in. The invite code IS the
 * provisioning; redemption does the writes (design: region-tier-design.md §1a).
 *
 * `group_id` is optional:
 *   - set → the code grants that existing group (Tom pre-built the node).
 *   - omitted → the leader names their own region at redemption; redeem.ts
 *     creates the group then, atomically with the govt_admins row.
 *
 * Requires ssi_admin / god caller — enforced by verifyAdmin().
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
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
  const groupId = (body.group_id || '').trim() || null
  const organizationName = (body.organization_name || '').trim()

  if (!displayName) {
    res.status(400).json({ error: 'display_name is required' })
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

  try {
    // Derive region_code (best-effort, for backward compat during the
    // consolidation window — §2) only when an existing group was given.
    let regionCode: string | null = null
    if (groupId) {
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
    }

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
        // Informational only — redemption never checks it; the invite is
        // possession-based (whoever redeems the link, under their own OTP email).
        recipient_email: email || null,
        recipient_name: displayName,
      },
    })

    if (codeError) {
      console.error('[CreateGovtAdmin] invite_codes insert failed:', codeError)
      res.status(500).json({ error: 'Failed to create invite code', detail: codeError.message })
      return
    }

    console.log('[CreateGovtAdmin] created invite code for', organizationName, 'group', groupId, 'by', adminResult.userId)
    res.status(200).json({
      invite_code: code,
      group_id: groupId,
      region_code: regionCode,
    })
  } catch (err) {
    console.error('[CreateGovtAdmin] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
