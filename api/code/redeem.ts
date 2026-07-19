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
import { provisionSchoolPlatformTrial } from '../_utils/schoolPlatformTrial'
import { isOperatorAccount, OPERATOR_CAPTURE_ERROR } from '../_utils/operatorGuard'

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

/**
 * Group-scoped teacher/student affiliation (THE-MODEL.md §6, I8; I7 — any
 * node, not just leaves). Writes the GROUP: tag at the invited node, and —
 * if that node IS a school's own node (schools.node_group_id) — dual-writes
 * the legacy SCHOOL:<id> tag too (§5 item 5), so every deployed dashboard
 * still sees the person tonight without waiting on a reader repoint.
 * Returns an error message on failure, or null on success.
 */
async function affiliateToGroupNode(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  groupId: string,
  roleInContext: 'teacher' | 'student'
): Promise<string | null> {
  const { error: groupTagError } = await supabase
    .from('user_tags')
    .insert({
      user_id: userId,
      tag_type: 'group',
      tag_value: `GROUP:${groupId}`,
      role_in_context: roleInContext,
      added_by: userId,
    })
  if (groupTagError) return groupTagError.message

  const { data: schoolNode } = await supabase
    .from('schools')
    .select('id')
    .eq('node_group_id', groupId)
    .maybeSingle()
  if (schoolNode) {
    const { error: schoolTagError } = await supabase
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'school',
        tag_value: `SCHOOL:${(schoolNode as any).id}`,
        role_in_context: roleInContext,
        added_by: userId,
      })
    if (schoolTagError) return schoolTagError.message
  }
  return null
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
  } else if (
    (codeType === 'teacher' || codeType === 'student') &&
    inviteRow.grants_group_id &&
    !inviteRow.grants_school_id &&
    !inviteRow.grants_class_id
  ) {
    // Group-scoped codes (THE-MODEL.md §6, I8; api/groups/:id/invites.ts) carry
    // ONLY grants_group_id — an interior-node join (I7). Same dedup shape as
    // the school/class checks above, scoped to the group tag instead.
    const { data: existingTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', userId)
      .eq('tag_type', 'group')
      .eq('tag_value', `GROUP:${inviteRow.grants_group_id}`)
      .is('removed_at', null)
      .maybeSingle()
    if (existingTag) {
      res.status(200).json({ success: false, error: 'Already redeemed for this group' })
      return
    }
  }

  // Operator-capture guard (2026-07-18): every invite code type mutates the
  // signed-in account's roles (platform_role or educational_role) — an
  // ssi_admin testing an invite link must never have their real account
  // captured. Refuse BEFORE claiming a use, so the test doesn't burn a
  // capped code either.
  if (await isOperatorAccount(supabase, userId)) {
    res.status(200).json({ success: false, error: OPERATOR_CAPTURE_ERROR })
    return
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
    // Get email from auth.users for display_name. A possession-onboarded
    // user (api/auth/possession-redeem.ts) typed a name at redemption time
    // and carries it in user_metadata — prefer that over the email prefix.
    const { data: authUser } = await supabase.auth.admin.getUserById(userId)
    const metadata = authUser?.user?.user_metadata as Record<string, unknown> | undefined
    const metadataName = metadata?.display_name
    // A link-auth (straight-in) account carries a placeholder email
    // (api/auth/possession-redeem.ts) — never derive a display name from it
    // ("link-<uuid>"); fall back to a generic name until they add a real one.
    const authEmail = authUser?.user?.email
    const emailPrefix = authEmail && !authEmail.endsWith('@invite.saysomethingin.app')
      ? authEmail.split('@')[0]
      : undefined
    const displayName = (typeof metadataName === 'string' && metadataName.trim())
      || emailPrefix
      || 'User'
    // Possession-onboarded accounts (api/auth/possession-redeem.ts) never
    // prove mailbox receipt — that endpoint mints a session without ever
    // emailing anyone. needs_verification is the durable record of
    // that; cleared only by a completed round-trip through api/email/verify.ts.
    const needsEmailVerification = metadata?.onboarded_via === 'possession'
    const { error: insertError } = await supabase
      .from('learners')
      .insert({
        user_id: userId,
        display_name: displayName,
        needs_verification: needsEmailVerification,
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
      // Idempotent re-redemption / lost-the-race check: if this admin already
      // has a govt_admins row (this code redeemed concurrently, or retried),
      // reuse its group rather than minting a second "New region" group.
      const { data: existingGovt } = await supabase
        .from('govt_admins')
        .select('group_id')
        .eq('user_id', userId)
        .maybeSingle()
      groupId = (existingGovt as any)?.group_id ?? null
    }
    // Tracks whether THIS request minted the group below, so we can clean up
    // an orphan if we then lose the govt_admins race (no unique key on
    // groups — the govt_admins unique key is the real backstop, this just
    // avoids leaving a stray empty "New region" group behind).
    let createdGroupThisRequest = false
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
      createdGroupThisRequest = true
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
    // 23505 = unique_violation on govt_admins_user_id_key (2026-07-13 migration):
    // a concurrent redemption for this same admin won the race and already
    // created the row — idempotent no-op, not an error, since the winner's
    // row grants the same role this request was asking for.
    if (govtError && govtError.code !== '23505') {
      console.error('[CodeRedeem] Failed to create govt_admin record:', govtError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
    if (govtError?.code === '23505' && createdGroupThisRequest) {
      // Lost the race after already minting a group for it — delete the
      // orphan (best-effort; a leftover empty group is cosmetic, not worth
      // failing the response over).
      await supabase.from('groups').delete().eq('id', groupId)
    }
  } else if (codeType === 'school_admin') {
    // Idempotent select-then-insert: reuse an existing school for this admin
    // (re-redemption, or a concurrent request that already won). The real
    // backstop against the double-redeem race is the unique index on
    // admin_user_id (2026-07-13 migration) caught as 23505 below — this
    // select just avoids paying for a doomed insert on the common path.
    const { data: existing } = await supabase
      .from('schools')
      .select('id, teacher_join_code, admin_join_code, group_id')
      .eq('admin_user_id', userId)
      .maybeSingle()

    let newSchool: { id: string; teacher_join_code?: string; admin_join_code?: string; group_id?: string | null } | null =
      existing as any
    // True only when THIS request's own insert won — group_id was just written
    // from inviteRow above, so the reattach check below is redundant (and the
    // mocked insert response in tests may not echo it back). False for the
    // precheck-existing and 23505-race-reread cases, where reattachment is
    // exactly the point.
    let freshlyInserted = false

    if (!newSchool) {
      const { data: inserted, error: schoolError } = await supabase
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
          // The invite label pre-fills the name, but it's the LEADER's guess,
          // not the admin's own choice — unconfirmed until DashboardView's
          // rename card (same pattern as groups.name_confirmed, region-tier
          // -design.md §1d) is saved once by this school's own admin.
          name_confirmed: false,
        })
        .select('id, teacher_join_code, admin_join_code, group_id')
        .single()

      if (schoolError?.code === '23505') {
        // Lost the race: another concurrent request for this admin inserted
        // first — either another redemption of THIS invite (already carries
        // the same group_id, nothing to do) or an unrelated ungrouped insert
        // (e.g. a self-serve /schools1 provision that raced ahead of this
        // redemption — the exact leak that slipped through group_id
        // reattachment below only running for the precheck-existing branch).
        // Reuse the winner's row instead of erroring.
        const { data: raced } = await supabase
          .from('schools')
          .select('id, teacher_join_code, admin_join_code, group_id')
          .eq('admin_user_id', userId)
          .maybeSingle()
        if (!raced) {
          console.error('[CodeRedeem] school unique-violation but no row found on re-read')
          res.status(500).json({ error: 'Internal server error' })
          return
        }
        newSchool = raced as any
      } else if (schoolError || !inserted) {
        console.error('[CodeRedeem] Failed to create school:', schoolError)
        res.status(500).json({ error: 'Internal server error' })
        return
      } else {
        newSchool = inserted as any
        freshlyInserted = true
      }
    }

    if (!freshlyInserted && inviteRow.grants_group_id && newSchool && !newSchool.group_id) {
      // Reusing a PRE-EXISTING school for this admin that predates this
      // group-stamped invite — whether found at the precheck (e.g. an
      // earlier ungrouped self-serve signup) or via the 23505 race re-read
      // above (e.g. a concurrent self-serve provision won the insert race).
      // Without this, the invite's group grant was silently dropped — the
      // admin ended up with a working, ungrouped school the leader's group
      // view could never see (the actual leak this branch used to have).
      // Only fills in an UNSET group_id — never reassigns a school that's
      // already attached to a (possibly different) group.
      const { error: attachError } = await supabase
        .from('schools')
        .update({ group_id: inviteRow.grants_group_id })
        .eq('id', newSchool.id)
        .is('group_id', null)
      if (attachError) {
        console.error('[CodeRedeem] Failed to attach pre-existing school to invite group:', attachError)
      } else {
        newSchool = { ...newSchool, group_id: inviteRow.grants_group_id }
      }
    }

    // Register BOTH the teacher and school-admin join codes (the pre-existing
    // bug: this branch only ever registered the teacher one, silently leaving
    // the admin join code unredeemable — same class of fix as provision.ts's
    // ensureJoinCodesRegistered, now shared from there).
    await ensureJoinCodesRegistered(supabase, newSchool!.id as string, userId)

    // Set the platform trial clocks HERE, at redemption, instead of routing
    // the admin through the /schools1 onboarding continuation to trigger
    // POST /api/onboarding/provision (the old design, region-tier-design.md
    // §1f) — that continuation forced a SECOND email+OTP because Onboarding.vue
    // always starts at its 'choose' step with no session check, discarding the
    // one just established here. No course is chosen yet at invite redemption
    // (the invite only carries a school_name label, never a course_code), so
    // this grants the same generous no-course-lock 1-year window self-serve
    // gives minority-language schools — TeacherDashboard.vue's
    // schoolAvailableCourses already reads a null trial_course_code as "no
    // restriction", so the admin can freely try any course until they commit
    // to one. Best-effort: a failure here must not fail the redemption itself,
    // same fail-open posture as every other platform-trial write.
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      const email = (authUser?.user?.email || '').trim().toLowerCase()
      await provisionSchoolPlatformTrial(supabase, email, newSchool!.id as string, null, true)
    } catch (trialError) {
      console.error('[CodeRedeem] Platform-trial provisioning failed (non-fatal):', trialError)
    }
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
    if (inviteRow.grants_group_id && !inviteRow.grants_school_id) {
      // Group-scoped code (interior-node join, I7) — no legacy branch to fall
      // through to.
      const affiliateError = await affiliateToGroupNode(supabase, userId, inviteRow.grants_group_id as string, 'teacher')
      if (affiliateError) {
        console.error('[CodeRedeem] Failed to create teacher group tag:', affiliateError)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
    } else {
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
    }
  } else if (codeType === 'student') {
    if (inviteRow.grants_group_id && !inviteRow.grants_class_id) {
      // Group-scoped code (interior-node join, I7) — no legacy branch to fall
      // through to. No course to auto-enrol into (a group-scoped student code
      // carries no class), so the course_enrollments step below stays gated
      // on grants_class_id and is skipped for this path, same as any student
      // code without a class grant.
      const affiliateError = await affiliateToGroupNode(supabase, userId, inviteRow.grants_group_id as string, 'student')
      if (affiliateError) {
        console.error('[CodeRedeem] Failed to create student group tag:', affiliateError)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
    } else {
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
  }

  // Student redemption needs the class's course_code so the client can carry
  // it through the redirect — without it, the redirect lands on App.vue's
  // cold-boot default course logic instead of the class's actual course
  // (finding #3, 2026-07-13 audit).
  let studentCourseCode: string | null = null
  if (codeType === 'student' && inviteRow.grants_class_id) {
    const { data: cls } = await supabase
      .from('classes')
      .select('course_code')
      .eq('id', inviteRow.grants_class_id)
      .maybeSingle()
    studentCourseCode = cls?.course_code ?? null

    // Enrol the student in the class's course (idempotent — mirrors
    // WithTeacher.vue's linkLearnerToClass, the /with/:code join path). Without
    // this, a class-invite student had a CLASS: tag but no course_enrollments
    // row at all — "landed in the right course" isn't the same as "enrolled and
    // ready to play" (2026-07-15 owner finding). Best-effort: a failure here
    // must not fail the redemption itself (the tag + course landing already
    // succeeded), same fail-open posture as the platform-trial writes above.
    if (studentCourseCode) {
      const { data: learnerRow } = await supabase
        .from('learners')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()
      if (learnerRow?.id) {
        const { error: enrollError } = await supabase
          .from('course_enrollments')
          .upsert(
            { learner_id: learnerRow.id, course_id: studentCourseCode },
            { onConflict: 'learner_id,course_id', ignoreDuplicates: true }
          )
        if (enrollError) {
          console.error('[CodeRedeem] Failed to enrol student in class course (non-fatal):', enrollError)
        }
      }
    }
  }

  // school_admin (invite-born — the ONLY way this code_type reaches redeem.ts;
  // self-serve signup never redeems a code, it goes straight from Onboarding.vue's
  // OTP step to POST /api/onboarding/provision) goes straight to /schools —
  // its trial clocks are already set above at redemption, and NO second
  // onboarding journey (the /schools1 continuation, which used to force a
  // second email+OTP) runs for it. Self-serve's own /schools1 course-picking
  // journey is untouched — this redirect only fires from redeem.ts.
  const redirectTo = codeType === 'ssi_admin' ? '/admin'
    : ['school_admin', 'god', 'govt_admin', 'school_admin_join', 'teacher'].includes(codeType) ? '/schools'
    : '/'

  console.log('[CodeRedeem] Redeemed invite code:', inviteRow.code, 'for user:', userId, 'role:', codeType)
  res.status(200).json({
    success: true,
    codeKind: 'invite',
    role: codeType,
    redirectTo,
    courseCode: studentCourseCode,
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
  const dashboardRoleApplied = await applyDashboardRole(supabase, learner.id as string, entitlementRow, {
    actorUserId: userId,
    source: 'entitlement-code',
    codeUsed: entitlementRow.code as string,
  })
  if (!dashboardRoleApplied) {
    console.error('[CodeRedeem] Entitlement granted but dashboard role update failed:', entitlementRow.code, 'for user:', userId)
  }

  const redirectTo = entitlementRow.grants_platform_role ? '/' : '/'

  console.log('[CodeRedeem] Redeemed entitlement code:', entitlementRow.code, 'for user:', userId, 'label:', entitlementRow.label)
  res.status(200).json({
    success: true,
    dashboardRoleApplied,
    codeKind: 'entitlement',
    label: entitlementRow.label,
    accessType: entitlementRow.access_type,
    grantsDashboardAccess: !!entitlementRow.grants_platform_role,
    redirectTo,
  })
}
