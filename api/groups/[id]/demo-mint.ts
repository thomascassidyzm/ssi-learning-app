/**
 * Demo Mint API - POST /api/groups/:id/demo-mint
 *
 * THE-MODEL §1.6/§1.7, §6, I8/I9: "The bottom line is FLEXIBILITY." Demo-mint
 * moves org creation to the tree — create a demo group + invite its leader in
 * ONE gesture, AT THE NODE, instead of the standalone /admin/demo-schools
 * flow (which keeps working unchanged for its existing sales-showcase use).
 *
 * Body: { name: string, shape?: 'node' | 'school' (default 'node'),
 *         leader_email?: string, course_code?: string }
 *   - 'node'   — bare child group, no commercial attachment.
 *   - 'school' — also provisions a hidden leaf class + join code via the
 *     demo-schools generator machinery (ensureDemoLeafClass), so the demo
 *     has something playable immediately, before any invite is redeemed
 *     (I8: invite redemption never creates structure, so this is done here,
 *     not in api/code/redeem.ts). course_code is required for this shape
 *     unless :id already sits inside an existing demo_orgs tree (resolved by
 *     walking parent_id to the owning root, same as demoLeaf.ts).
 *
 * Mints ONE leader invite (code_type 'govt_admin', grants_group_id = the new
 * node) — people-only (I8): redeeming it affiliates the leader to the node,
 * creates no structure of its own. A govt_admin whose own group_id is the
 * node itself sees everything in its subtree (schoolScope's path-prefix
 * match includes the node's own path), so this also covers the 'school'
 * shape's pre-provisioned hidden school without a second invite type.
 *
 * Records the mint to demo_orgs (group_id, metadata snapshot) so the
 * existing expiry cron (api/cron/expire-demo-schools.ts) covers node-minted
 * demos exactly like /admin/demo-schools ones — same table, same cron, same
 * ban-on-expire semantics.
 *
 * Authz: ssi_admin, OR the leader (govt_admins row) whose own governed group
 * IS :id or a strict ancestor of :id — same server-derived ownership check
 * as api/groups/[id].ts's leader-delete path. Never trust a client claim.
 *
 * Atomic-ish: no cross-table transactions available via supabase-js, so on
 * any failure after the group insert, the partially-minted group (+ its
 * hidden school/class/invite, if shape='school' got that far) is deleted
 * before returning the error — no half-minted orgs left behind.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../../_utils/auth'
import { isStrictDescendantGroup } from '../../_utils/schoolScope'
import { ensureDemoLeafClass, resolveDemoOrgCourseCode } from '../../_utils/demoLeaf'
import { generateCodeForType } from '../../_utils/codeGen'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const DAY = 86400000
const DEFAULT_DEMO_DAYS = 30

/**
 * Derive the app origin from the request — never trust a client-supplied
 * value (same pattern as api/admin/create-signin-link.ts). Links-first
 * (THE-MODEL §1.10): the URL is the artifact, the code is plumbing.
 */
function getAppOrigin(req: VercelRequest): string {
  const host = ((req.headers['host'] as string) || '').toLowerCase().replace(/:\d+$/, '')
  if (host === 'saysomethingin.app' || host === 'www.saysomethingin.app') return 'https://saysomethingin.app'
  if (host === 'staging.saysomethingin.app') return 'https://staging.saysomethingin.app'
  if (host) return `https://${host}`
  return 'https://saysomethingin.app'
}

/**
 * ssi_admin first; fall back to a leader whose OWN governed group is
 * `groupId` itself or a strict ancestor of it (minting AT their own node or
 * somewhere in their own subtree). Writes the 401/403 response itself and
 * returns null on rejection.
 */
async function resolveAdminOrGroupLeader(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  groupId: string,
): Promise<string | null> {
  const adminResult = await verifyAdmin(req)
  if (!('error' in adminResult)) return adminResult.userId

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return null
  }
  const { data: govtAdmin } = await supabase
    .from('govt_admins')
    .select('group_id')
    .eq('user_id', authResult.userId)
    .maybeSingle()
  const ownGroupId = (govtAdmin as any)?.group_id as string | undefined
  const owns = !!ownGroupId && (ownGroupId === groupId || (await isStrictDescendantGroup(supabase, ownGroupId, groupId)))
  if (!owns) {
    res.status(403).json({ error: 'You do not govern this group' })
    return null
  }
  return authResult.userId
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const parentGroupId = req.query.id as string
  if (!parentGroupId) {
    res.status(400).json({ error: 'Group ID is required' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const callerUserId = await resolveAdminOrGroupLeader(req, res, supabase, parentGroupId)
  if (!callerUserId) return

  const { name, shape, leader_email: leaderEmail, course_code: courseCodeInput } = req.body || {}
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const mintShape: 'node' | 'school' = shape === 'school' ? 'school' : 'node'

  const { data: parent, error: parentErr } = await supabase
    .from('groups')
    .select('id')
    .eq('id', parentGroupId)
    .maybeSingle()
  if (parentErr) {
    res.status(500).json({ error: parentErr.message })
    return
  }
  if (!parent) {
    res.status(404).json({ error: 'Parent group not found' })
    return
  }

  // ---- one gesture, step 1: the child group node ----
  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .insert({
      name: name.trim(),
      type: mintShape === 'school' ? 'school' : 'organisation',
      parent_id: parentGroupId,
      is_demo: true,
      is_test: true,
      name_confirmed: true,
    })
    .select('id')
    .single()
  if (groupErr || !group) {
    res.status(500).json({ error: `groups insert failed: ${groupErr?.message}` })
    return
  }
  const groupId = group.id as string

  // Cleanup helper for every failure path below — deletes the group (and
  // anything FK'd to it: hidden schools/classes cascade via schools.group_id
  // -> groups, but invite_codes/demo_orgs have no ON DELETE, so those are
  // deleted explicitly before the group).
  const rollback = async (inviteCodeId?: string, demoOrgId?: string) => {
    if (demoOrgId) await supabase.from('demo_orgs').delete().eq('id', demoOrgId)
    if (inviteCodeId) await supabase.from('invite_codes').delete().eq('id', inviteCodeId)
    await supabase.from('groups').delete().eq('id', groupId)
  }

  try {
    // ---- one gesture, step 2 (shape='school' only): hidden leaf so the
    // demo is playable immediately, before any invite is redeemed. ----
    let schoolId: string | null = null
    let studentJoinCode: string | null = null
    let courseCode: string | null = null
    if (mintShape === 'school') {
      courseCode = (typeof courseCodeInput === 'string' && courseCodeInput.trim())
        ? courseCodeInput.trim()
        : await resolveDemoOrgCourseCode(supabase, parentGroupId)
      if (!courseCode) {
        await rollback()
        res.status(400).json({ error: 'course_code is required for shape "school" (could not resolve one from the parent tree)' })
        return
      }
      const leaf = await ensureDemoLeafClass(supabase, groupId, callerUserId, courseCode)
      if ('error' in leaf) {
        await rollback()
        res.status(500).json({ error: `hidden leaf provisioning failed: ${leaf.error}` })
        return
      }
      const { data: hiddenSchool } = await supabase.from('schools').select('id').eq('group_id', groupId).maybeSingle()
      schoolId = (hiddenSchool?.id as string) ?? null
      studentJoinCode = leaf.studentJoinCode
    } else {
      // A bare node still needs a course_code on demo_orgs (NOT NULL) even
      // with nothing playable yet — resolve from the tree if possible,
      // otherwise fall back to what the caller supplied.
      courseCode = (typeof courseCodeInput === 'string' && courseCodeInput.trim())
        ? courseCodeInput.trim()
        : await resolveDemoOrgCourseCode(supabase, parentGroupId)
      if (!courseCode) {
        await rollback()
        res.status(400).json({ error: 'course_code is required (could not resolve one from the parent tree)' })
        return
      }
    }

    // ---- one gesture, step 3: the leader invite (people-only, I8) ----
    let newCode: string | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateCodeForType('govt_admin')
      const { data: existing } = await supabase.from('invite_codes').select('id').eq('code', candidate).maybeSingle()
      if (!existing) { newCode = candidate; break }
    }
    if (!newCode) {
      await rollback()
      res.status(500).json({ error: 'Could not generate unique invite code, please try again' })
      return
    }

    const { data: invite, error: inviteErr } = await supabase
      .from('invite_codes')
      .insert({
        code: newCode,
        code_type: 'govt_admin',
        grants_group_id: groupId,
        created_by: callerUserId,
        is_active: true,
        metadata: { organization_name: name.trim(), ...(leaderEmail ? { leader_email: leaderEmail } : {}) },
      })
      .select('id, code')
      .single()
    if (inviteErr || !invite) {
      await rollback()
      res.status(500).json({ error: `invite creation failed: ${inviteErr?.message}` })
      return
    }

    // ---- one gesture, step 4: record the mint so the expiry cron covers it ----
    const expiresAt = new Date(Date.now() + DEFAULT_DEMO_DAYS * DAY).toISOString()
    const { data: demoOrg, error: demoOrgErr } = await supabase
      .from('demo_orgs')
      .insert({
        created_by: callerUserId,
        prospect_name: name.trim(),
        org_shape: mintShape === 'school' ? 'single_school' : 'group',
        course_code: courseCode,
        group_id: groupId,
        school_id: schoolId,
        expires_at: expiresAt,
        status: 'active',
        metadata: {
          orgName: name.trim(),
          mintedAtNode: parentGroupId,
          shape: mintShape,
          ...(leaderEmail ? { leaderEmail } : {}),
        },
      })
      .select('id')
      .single()
    if (demoOrgErr || !demoOrg) {
      await rollback(invite.id as string)
      res.status(500).json({ error: `demo_orgs insert failed: ${demoOrgErr?.message}` })
      return
    }

    try {
      await supabase.from('player_events').insert({
        occurred_at: new Date().toISOString(),
        event_type: 'admin_demo_node_minted',
        payload: { actor_user_id: callerUserId, parent_group_id: parentGroupId, group_id: groupId, shape: mintShape, demo_org_id: demoOrg.id },
      })
    } catch (auditErr) {
      console.warn('[DemoMint] audit insert threw:', auditErr)
    }

    // Links-first (THE-MODEL §1.10): the shareable URL leads; codes are
    // plumbing. Same URL shapes as the standalone demo flow's result card
    // (leader /group/<code>, learner /with/<join_code>) and the node panel
    // consumes this array by contract: { role, url, code, limits }.
    const origin = getAppOrigin(req)
    const links = [
      {
        role: 'leader',
        url: `${origin}/group/${invite.code}`,
        code: invite.code,
        limits: { max_uses: null, expires_at: expiresAt },
      },
      ...(studentJoinCode
        ? [{
            role: 'student',
            url: `${origin}/with/${studentJoinCode}`,
            code: studentJoinCode,
            limits: { max_uses: null, expires_at: expiresAt },
          }]
        : []),
    ]

    res.status(201).json({
      group_id: groupId,
      demo_org_id: demoOrg.id,
      shape: mintShape,
      links,
      invite_code: invite.code,
      school_id: schoolId,
      student_join_code: studentJoinCode,
      expires_at: expiresAt,
    })
  } catch (error: any) {
    console.error('[DemoMint] Error:', error)
    await rollback()
    res.status(500).json({ error: error?.message || 'Failed to mint demo org' })
  }
}
