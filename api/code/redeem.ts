/**
 * Unified Code Redemption API - POST /api/code/redeem
 *
 * Requires auth. Accepts { code, codeKind } and routes to appropriate logic.
 * - invite: existing invite redemption logic
 * - entitlement: creates user_entitlements row
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { applyDashboardRole, computeEntitlementExpiry } from '../_utils/entitlementGrant'
import { recordRoleChange } from '../_utils/auditRole'
import { ensureJoinCodesRegistered } from '../_utils/schoolJoinCodes'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

/**
 * Atomically count one use of a code, conditional on it still being
 * active/unexpired/under its max_uses cap — closing the cross-user
 * over-redemption race that a read-then-write increment leaves open.
 * Returns true if a use was claimed, false if the code is exhausted/expired.
 * Falls back to the legacy read-then-write when the RPC is absent (pre-migration).
 * Throws on unexpected DB errors (caller surfaces a 500).
 */
async function claimCodeUse(
  supabase: any,
  table: 'invite_codes' | 'entitlement_codes',
  rpcName: 'claim_invite_code_use' | 'claim_entitlement_code_use',
  id: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc(rpcName, { p_id: id })
  if (!error) {
    // RPC RETURNS the id when claimed, NULL (no row) when not.
    return data !== null && data !== undefined
  }
  const missing =
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|schema cache/i.test(error.message || '')
  if (!missing) {
    throw new Error(`${rpcName} failed: ${error.message}`)
  }
  // Pre-migration fallback: legacy conditional read-then-write (race-accepting).
  const { data: row, error: readErr } = await supabase
    .from(table)
    .select('use_count, max_uses, is_active, expires_at')
    .eq('id', id)
    .maybeSingle()
  if (readErr) throw new Error(`${table} re-read failed: ${readErr.message}`)
  if (!row || !row.is_active) return false
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return false
  if (row.max_uses !== null && row.use_count >= row.max_uses) return false
  const { error: updErr } = await supabase
    .from(table)
    .update({ use_count: row.use_count + 1 })
    .eq('id', id)
  if (updErr) throw new Error(`${table} increment failed: ${updErr.message}`)
  return true
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const { code, codeKind } = req.body || {}
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing code' })
    return
  }
  if (!codeKind || !['invite', 'entitlement'].includes(codeKind)) {
    res.status(400).json({ error: 'Missing or invalid codeKind' })
    return
  }

  // Forgiving lookup: match the STORED `code_normalized` column so the typed
  // code resolves regardless of case, hyphens, or spaces.
  const stripped = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!stripped) {
    res.status(200).json({ success: false, error: 'Invalid code' })
    return
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    if (codeKind === 'invite') {
      await redeemInviteCode(supabase, stripped, userId, res)
    } else {
      await redeemEntitlementCode(supabase, stripped, userId, res)
    }
  } catch (error) {
    console.error('[CodeRedeem] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ============================================================================
// INVITE CODE REDEMPTION (extracted from api/invite/redeem.ts)
// ============================================================================

async function redeemInviteCode(
  supabase: ReturnType<typeof createClient>,
  strippedCode: string,
  userId: string,
  res: VercelResponse
): Promise<void> {
  // Re-validate code (forgiving: match the normalized column)
  const { data: inviteRow, error: inviteError } = await supabase
    .from('invite_codes')
    .select('id, code, code_type, grants_region, grants_school_id, grants_class_id, grants_group_id, metadata, max_uses, use_count, expires_at, is_active')
    .eq('code_normalized', strippedCode)
    .eq('is_active', true)
    .single()

  if (inviteError || !inviteRow) {
    res.status(200).json({ success: false, error: 'Invalid code' })
    return
  }

  if (inviteRow.expires_at && new Date(inviteRow.expires_at) <= new Date()) {
    res.status(200).json({ success: false, error: 'Code expired' })
    return
  }

  if (inviteRow.max_uses !== null && inviteRow.use_count >= inviteRow.max_uses) {
    res.status(200).json({ success: false, error: 'Code fully used' })
    return
  }

  const codeType: string = inviteRow.code_type

  // Check user hasn't already redeemed same context
  if ((codeType === 'teacher' || codeType === 'school_admin_join') && inviteRow.grants_school_id) {
    const { data: existingTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', userId)
      .eq('tag_type', 'school')
      .eq('tag_value', `SCHOOL:${inviteRow.grants_school_id}`)
      .is('removed_at', null)
      .maybeSingle()
    if (existingTag) {
      res.status(200).json({ success: false, error: 'Already redeemed for this school' })
      return
    }
  } else if (codeType === 'student' && inviteRow.grants_class_id) {
    const { data: existingTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', userId)
      .eq('tag_type', 'class')
      .eq('tag_value', `CLASS:${inviteRow.grants_class_id}`)
      .is('removed_at', null)
      .maybeSingle()
    if (existingTag) {
      res.status(200).json({ success: false, error: 'Already redeemed for this class' })
      return
    }
  }

  // Atomically claim a use (conditional on still-active/unexpired/under-cap),
  // closing the cross-user over-redemption race. Runs after the dedup checks and
  // before any role records are created. NOTE: claim-first means a downstream 500
  // burns one use of a *capped* code (rare; invite codes default max_uses=NULL) —
  // an accepted tradeoff to keep the cap race closed.
  const claimed = await claimCodeUse(supabase, 'invite_codes', 'claim_invite_code_use', inviteRow.id as string)
  if (!claimed) {
    res.status(200).json({ success: false, error: 'Code fully used' })
    return
  }

  // Ensure learner record exists (may not if user just signed up via OTP)
  const { data: existingLearner } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!existingLearner) {
    // Get email from auth.users for display_name
    const { data: authUser } = await supabase.auth.admin.getUserById(userId)
    const displayName = authUser?.user?.email?.split('@')[0] || 'User'
    const { error: insertError } = await supabase
      .from('learners')
      .insert({
        user_id: userId,
        display_name: displayName,
      })
    if (insertError) {
      console.error('[CodeRedeem] Failed to create learner:', insertError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  }

  // Update learner role and invite_code_id
  const learnerUpdate: Record<string, unknown> = { invite_code_id: inviteRow.id }
  if (codeType === 'ssi_admin' || codeType === 'god') {
    // 'god' collapsed into 'ssi_admin' (2026-06-16); legacy god codes grant admin.
    learnerUpdate.platform_role = 'ssi_admin'
  } else if (codeType === 'tester') {
    learnerUpdate.platform_role = 'tester'
  } else if (codeType === 'school_admin_join') {
    learnerUpdate.educational_role = 'school_admin'
  } else {
    learnerUpdate.educational_role = codeType
  }
  const { error: learnerError } = await supabase
    .from('learners')
    .update(learnerUpdate)
    .eq('user_id', userId)

  if (learnerError) {
    console.error('[CodeRedeem] Failed to update learner:', learnerError)
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  // Audit the role grant from this invite code (best-effort). Each code sets
  // exactly one of platform_role / educational_role; the actor is the redeemer.
  if (learnerUpdate.platform_role || learnerUpdate.educational_role) {
    await recordRoleChange(supabase, {
      actorUserId: userId,
      targetUserId: userId,
      field: learnerUpdate.platform_role ? 'platform_role' : 'educational_role',
      newValue: (learnerUpdate.platform_role || learnerUpdate.educational_role) as string,
      source: 'invite-code',
      codeUsed: inviteRow.code,
    })
  }

  // Create role-specific records
  if (codeType === 'govt_admin') {
    // Honour grants_group_id when set (leader joins Tom's pre-built group node).
    // When absent, this is a leader naming their own region — create the group
    // HERE, atomically with the admin row, rather than via a leader-callable
    // create-group endpoint: no new write endpoint, no orphan groups from
    // abandoned first-runs, and the leader can never end up group-less.
    let groupId = inviteRow.grants_group_id as string | null
    if (!groupId) {
      const { data: newGroup, error: groupError } = await supabase
        .from('groups')
        .insert({
          name: inviteRow.metadata?.organization_name || 'New region',
          type: 'region',
        })
        .select('id')
        .single()
      if (groupError || !newGroup) {
        console.error('[CodeRedeem] Failed to create group for govt_admin:', groupError)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
      groupId = newGroup.id as string
    }

    const { error: govtError } = await supabase
      .from('govt_admins')
      .insert({
        user_id: userId,
        group_id: groupId,
        // Written during the region_code/group_id consolidation window (design
        // §2) so schoolScope.ts's fallback stays honest until it's retired.
        region_code: inviteRow.grants_region,
        organization_name: inviteRow.metadata?.organization_name || '',
        created_by: userId,
        invite_code_id: inviteRow.id,
      })
    if (govtError) {
      console.error('[CodeRedeem] Failed to create govt_admin record:', govtError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  } else if (codeType === 'school_admin') {
    const { data: newSchool, error: schoolError } = await supabase
      .from('schools')
      .insert({
        admin_user_id: userId,
        school_name: inviteRow.metadata?.school_name || '',
        region_code: inviteRow.metadata?.region_code || null,
        // Automatic group attachment at birth, no adoption step. NEVER trust a
        // client-supplied group_id — this comes only from the invite row,
        // which itself was stamped from the minting leader's own group.
        group_id: inviteRow.grants_group_id || null,
        invite_code_id: inviteRow.id,
      })
      .select('id, teacher_join_code, admin_join_code')
      .single()

    if (schoolError || !newSchool) {
      console.error('[CodeRedeem] Failed to create school:', schoolError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    // Register BOTH the teacher and school-admin join codes (the pre-existing
    // bug: this branch only ever registered the teacher one, silently leaving
    // the admin join code unredeemable — same class of fix as provision.ts's
    // ensureJoinCodesRegistered, now shared from there).
    await ensureJoinCodesRegistered(supabase, newSchool.id as string, userId)
  } else if (codeType === 'school_admin_join') {
    const { error: tagError } = await supabase
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'school',
        tag_value: `SCHOOL:${inviteRow.grants_school_id}`,
        role_in_context: 'admin',
        added_by: userId,
      })
    if (tagError) {
      console.error('[CodeRedeem] Failed to create school admin tag:', tagError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  } else if (codeType === 'teacher') {
    const { error: tagError } = await supabase
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'school',
        tag_value: `SCHOOL:${inviteRow.grants_school_id}`,
        role_in_context: 'teacher',
        added_by: userId,
      })
    if (tagError) {
      console.error('[CodeRedeem] Failed to create teacher tag:', tagError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  } else if (codeType === 'student') {
    const { error: tagError } = await supabase
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'class',
        tag_value: `CLASS:${inviteRow.grants_class_id}`,
        role_in_context: 'student',
        added_by: userId,
      })
    if (tagError) {
      console.error('[CodeRedeem] Failed to create student tag:', tagError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  }

  // school_admin routes through the existing course-picking onboarding
  // continuation (not straight to /schools) so POST /api/onboarding/provision
  // runs: it finds the school just created above (by admin_user_id, idempotent)
  // and sets the platform trial clocks + re-runs ensureJoinCodesRegistered —
  // today an invite-created school skips provision entirely and never gets a
  // trial clock at all. Group schools get the same terms as self-serve schools
  // for free, with zero new billing code.
  const redirectTo = codeType === 'ssi_admin' ? '/admin'
    : codeType === 'school_admin' ? '/schools1'
    : ['god', 'govt_admin', 'school_admin_join', 'teacher'].includes(codeType) ? '/schools'
    : '/'

  console.log('[CodeRedeem] Redeemed invite code:', inviteRow.code, 'for user:', userId, 'role:', codeType)
  res.status(200).json({
    success: true,
    codeKind: 'invite',
    role: codeType,
    redirectTo,
  })
}

// ============================================================================
// ENTITLEMENT CODE REDEMPTION
// ============================================================================

async function redeemEntitlementCode(
  supabase: ReturnType<typeof createClient>,
  strippedCode: string,
  userId: string,
  res: VercelResponse
): Promise<void> {
  // Re-validate code (forgiving: match the normalized column)
  const { data: entitlementRow, error: entitlementError } = await supabase
    .from('entitlement_codes')
    .select('id, code, access_type, granted_courses, duration_type, duration_days, label, max_uses, use_count, expires_at, is_active, grants_platform_role, grants_dashboard_courses')
    .eq('code_normalized', strippedCode)
    .eq('is_active', true)
    .single()

  if (entitlementError || !entitlementRow) {
    res.status(200).json({ success: false, error: 'Invalid code' })
    return
  }

  if (entitlementRow.expires_at && new Date(entitlementRow.expires_at) <= new Date()) {
    res.status(200).json({ success: false, error: 'Code expired' })
    return
  }

  if (entitlementRow.max_uses !== null && entitlementRow.use_count >= entitlementRow.max_uses) {
    res.status(200).json({ success: false, error: 'Code fully used' })
    return
  }

  // Get learner_id from user_id
  const { data: learner, error: learnerError } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (learnerError || !learner) {
    console.error('[CodeRedeem] Learner not found for user:', userId)
    res.status(200).json({ success: false, error: 'User not found' })
    return
  }

  // Check if already redeemed this code
  const { data: existing } = await supabase
    .from('user_entitlements')
    .select('id')
    .eq('learner_id', learner.id)
    .eq('entitlement_code_id', entitlementRow.id)
    .maybeSingle()

  if (existing) {
    res.status(200).json({ success: false, error: 'Code already redeemed' })
    return
  }

  // Compute expires_at for the entitlement
  const entitlementExpiresAt = computeEntitlementExpiry(entitlementRow)

  // Create user_entitlements row
  const { error: insertError } = await supabase
    .from('user_entitlements')
    .insert({
      learner_id: learner.id,
      entitlement_code_id: entitlementRow.id,
      access_type: entitlementRow.access_type,
      granted_courses: entitlementRow.granted_courses,
      expires_at: entitlementExpiresAt,
    })

  if (insertError) {
    console.error('[CodeRedeem] Failed to create user_entitlement:', insertError)
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  // Atomically claim a use LAST — after the entitlement insert above — so a failed
  // insert never burns a use. Non-fatal: the entitlement is already granted, and
  // the per-user UNIQUE(learner_id, entitlement_code_id) is the same-user backstop.
  try {
    const claimed = await claimCodeUse(supabase, 'entitlement_codes', 'claim_entitlement_code_use', entitlementRow.id as string)
    if (!claimed) {
      console.warn('[CodeRedeem] entitlement use not claimed (code exhausted/expired after grant):', entitlementRow.id)
    }
  } catch (e: any) {
    console.error('[CodeRedeem] Failed to claim entitlement use (non-fatal, entitlement granted):', e?.message)
  }

  // If code grants dashboard access, apply platform_role + dashboard_courses.
  await applyDashboardRole(supabase, learner.id as string, entitlementRow, {
    actorUserId: userId,
    source: 'entitlement-code',
    codeUsed: entitlementRow.code as string,
  })

  const redirectTo = entitlementRow.grants_platform_role ? '/' : '/'

  console.log('[CodeRedeem] Redeemed entitlement code:', entitlementRow.code, 'for user:', userId, 'label:', entitlementRow.label)
  res.status(200).json({
    success: true,
    codeKind: 'entitlement',
    label: entitlementRow.label,
    accessType: entitlementRow.access_type,
    grantsDashboardAccess: !!entitlementRow.grants_platform_role,
    redirectTo,
  })
}
