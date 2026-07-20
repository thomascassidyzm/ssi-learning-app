/**
 * Group Invites API - GET/POST /api/groups/:id/invites
 *
 * THE-MODEL.md §6 groundwork + §1.10 ("the invites page dies — links live
 * ON the node"): the group-scoped shape of the "invites mint people, never
 * structure" contract (I8).
 *
 * GET  — the node panel's "ways in" section: every ACTIVE link minted at
 *   this exact node, links-first (`{role, url, code, limits, useCount}`),
 *   newest first. The URL is the artifact; the code is plumbing.
 * POST — `{ role: 'teacher' | 'leader' | 'student', limits?: { max_uses?, expires_at? } }`
 *   — the :id in the path IS the where, so there is no grants_group_id field to
 *   accept from the client (mirrors invite/create.ts's rule that a leader's own
 *   group is always server-derived, never client-supplied). Response includes
 *   the ready-to-share `url` (links-first) alongside the raw `code`.
 *
 * Reuses the existing invite_codes table/machinery (generateCode, the same
 * columns api/invite/create.ts writes) — no new table, no new redemption
 * path. Role maps to the existing code_type vocabulary: leader → govt_admin,
 * teacher → teacher, student → student. Redemption of a group-scoped
 * teacher/student code (grants_group_id set, no grants_school_id/
 * grants_class_id) is NOT yet handled by api/code/redeem.ts's teacher/student
 * branches (they key off grants_school_id/grants_class_id) — that dual-write
 * is THE-MODEL.md §5 item 4/5 territory, another worker's lane. This endpoint
 * only mints the code; see the architect report for the flagged gap.
 *
 * Authz: ssi_admin/god, OR a govt_admin whose own governed group is `:id`
 * itself or a strict ancestor of it (schoolScope.isStrictDescendantGroup) —
 * "the leader of this node, or of a node above it, may invite into it."
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../../_utils/auth'
import { generateCode } from '../../_utils/codeGen'
import { isStrictDescendantGroup, ownSchoolIdForNode } from '../../_utils/schoolScope'
import { getAppOrigin, redeemPathForRole } from '../../_utils/appOrigin'
import { provisionPersona } from '../../_utils/provisionPersona'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Role vocabulary (founder-ruled 2026-07-20, role-scoped links): 'leader' =
// group leader (govt_admin), 'school_leader' = school admin seat at a school
// node (school_admin_join — only mintable/listable where the node IS a
// school), 'teacher', 'student' = the learner/pupil join. Classes are never
// invited — a class's student link lives on the class page.
type Role = 'teacher' | 'leader' | 'school_leader' | 'student'

const CODE_TYPE_BY_ROLE: Record<Role, string> = {
  leader: 'govt_admin',
  school_leader: 'school_admin_join',
  teacher: 'teacher',
  student: 'student',
}
const ROLE_BY_CODE_TYPE: Record<string, Role> = {
  govt_admin: 'leader',
  school_admin_join: 'school_leader',
  teacher: 'teacher',
  student: 'student',
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const groupId = req.query.id as string
  if (!groupId) {
    res.status(400).json({ error: 'Group ID is required' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured — missing SUPABASE_SERVICE_ROLE_KEY' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Authz: ssi_admin/god first; else a govt_admin governing this exact node
  // or a strict ancestor of it.
  let callerUserId: string
  const adminResult = await verifyAdmin(req)
  if (!('error' in adminResult)) {
    callerUserId = adminResult.userId
  } else {
    const authResult = await verifyAuthToken(req)
    if (!authResult.valid || !authResult.userId) {
      res.status(401).json({ error: authResult.error || 'Unauthorized' })
      return
    }
    const { data: govtAdmin } = await supabase
      .from('govt_admins')
      .select('group_id')
      .eq('user_id', authResult.userId)
      .maybeSingle()
    const ownGroupId = (govtAdmin as any)?.group_id as string | undefined
    const governsNode = !!ownGroupId && (
      ownGroupId === groupId || await isStrictDescendantGroup(supabase, ownGroupId, groupId)
    )
    if (!governsNode) {
      res.status(403).json({ error: 'You do not govern this group' })
      return
    }
    callerUserId = authResult.userId
  }

  if (req.method === 'GET') {
    try {
      // School-node duality (THE MODEL I2): codes minted BEFORE the node
      // existed reference the school row by schools.id (grants_school_id), not
      // the node id — so a node-id-only query silently returns nothing (the
      // founder-reported "No invite links yet" on a school node that has demo
      // codes). Bridge to the node's own school and match either key.
      const ownSchoolId = await ownSchoolIdForNode(supabase, groupId)
      let query = supabase
        .from('invite_codes')
        .select('code, code_type, metadata, max_uses, use_count, expires_at, created_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      query = ownSchoolId
        ? query.or(`grants_group_id.eq.${groupId},grants_school_id.eq.${ownSchoolId}`)
        : query.eq('grants_group_id', groupId)
      const { data, error } = await query
      if (error) throw error

      const origin = getAppOrigin(req)
      const links = (data || [])
        .map((row: any) => {
          const role = ROLE_BY_CODE_TYPE[row.code_type as string]
          if (!role) return null
          return {
            role,
            url: `${origin}/${redeemPathForRole(role)}/${row.code}`,
            code: row.code,
            limits: { max_uses: row.max_uses, expires_at: row.expires_at },
            useCount: row.use_count,
            // Species 1 marker: this link is a specific person's login.
            ...(row.metadata?.personal_auth_user_id
              ? { personal: true, personalName: row.metadata?.personal_name ?? null }
              : {}),
          }
        })
        .filter(Boolean)

      res.status(200).json({ links })
    } catch (error) {
      console.error('[GroupInvites] List error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
    return
  }

  const { role, limits, personal } = (req.body || {}) as {
    role?: string
    limits?: { max_uses?: number; expires_at?: string }
    // Species 1 (founder-ruled 2026-07-20): pre-provision a REAL account
    // (role + node + display name) and bind the minted code to it — the link
    // becomes that person's login, zero screens. Omitted → species 2, the
    // shareable open link with identity capture at redeem.
    personal?: { name?: string; email?: string; class_id?: string }
  }

  if (role !== 'teacher' && role !== 'leader' && role !== 'school_leader' && role !== 'student') {
    res.status(400).json({ error: "role must be one of 'teacher', 'leader', 'school_leader', 'student'" })
    return
  }

  // school_leader is only meaningful where the node IS a school — the code
  // grants the school-admin seat (school_admin_join keys off grants_school_id,
  // the commercial row, not the node id).
  let schoolLeaderSchoolId: string | null = null
  if (role === 'school_leader') {
    schoolLeaderSchoolId = await ownSchoolIdForNode(supabase, groupId)
    if (!schoolLeaderSchoolId) {
      res.status(400).json({ error: 'School leader links can only be minted at a school' })
      return
    }
  }

  if (personal !== undefined) {
    if (!personal || typeof personal.name !== 'string' || !personal.name.trim()) {
      res.status(400).json({ error: 'personal.name is required for a personal link' })
      return
    }
    if (personal.class_id && role !== 'student') {
      res.status(400).json({ error: 'personal.class_id only applies to student links' })
      return
    }
  }

  try {
    // Personal links: provision the account FIRST, so a code is never minted
    // pointing at nothing. teacher/student class checks need the node's own
    // school where applicable.
    let personaUserId: string | null = null
    let personaEmail: string | null = null
    let personaName: string | null = null
    if (personal) {
      const nodeSchoolId = role === 'school_leader'
        ? schoolLeaderSchoolId
        : await ownSchoolIdForNode(supabase, groupId)
      if (personal.class_id && nodeSchoolId) {
        const { data: cls } = await supabase
          .from('classes')
          .select('id, school_id')
          .eq('id', personal.class_id)
          .maybeSingle()
        if (!cls || (cls as any).school_id !== nodeSchoolId) {
          res.status(400).json({ error: 'class does not belong to this school' })
          return
        }
      } else if (personal.class_id && !nodeSchoolId) {
        res.status(400).json({ error: 'class links can only be minted at a school' })
        return
      }
      const persona = await provisionPersona(supabase, {
        role: role as 'leader' | 'school_leader' | 'teacher' | 'student',
        name: personal.name!.trim().slice(0, 100),
        email: personal.email,
        groupId,
        classId: personal.class_id,
        schoolId: nodeSchoolId,
        createdBy: callerUserId,
      })
      if (persona.error || !persona.authUserId) {
        console.error('[GroupInvites] persona provisioning failed:', persona.error)
        const conflict = /already been registered|already registered|already exists/i.test(persona.error || '')
        res.status(conflict ? 409 : 500).json({ error: conflict ? 'An account already exists for this email' : 'Could not set up the account' })
        return
      }
      personaUserId = persona.authUserId
      personaEmail = persona.email
      personaName = personal.name!.trim().slice(0, 100)
    }

    let newCode: string | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateCode()
      const { data: existing } = await supabase
        .from('invite_codes')
        .select('id')
        .eq('code', candidate)
        .maybeSingle()
      if (!existing) {
        newCode = candidate
        break
      }
    }
    if (!newCode) {
      console.error('[GroupInvites] Failed to generate unique code after 10 attempts')
      res.status(500).json({ error: 'Could not generate unique code, please try again' })
      return
    }

    const insertData: Record<string, unknown> = {
      code: newCode,
      code_type: CODE_TYPE_BY_ROLE[role],
      created_by: callerUserId,
      is_active: true,
      // school_leader grants the school-admin seat by school id (what
      // redeem.ts's school_admin_join branch reads); a personal class-student
      // link is class-scoped (so validate can surface class + course for the
      // client's course landing); everything else is node-scoped by group id.
      ...(role === 'school_leader'
        ? { grants_school_id: schoolLeaderSchoolId }
        : personal?.class_id
          ? { grants_class_id: personal.class_id }
          : { grants_group_id: groupId }),
      // Personal binding — server-derived from the account we just
      // provisioned above, never client-supplied.
      ...(personaUserId
        ? { metadata: { personal_auth_user_id: personaUserId, personal_name: personaName } }
        : {}),
    }
    if (limits?.expires_at !== undefined) insertData.expires_at = limits.expires_at
    if (limits?.max_uses !== undefined) insertData.max_uses = limits.max_uses

    const { data: created, error: insertError } = await supabase
      .from('invite_codes')
      .insert(insertData)
      .select('id, code')
      .single()

    if (insertError || !created) {
      console.error('[GroupInvites] Failed to insert invite code:', insertError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    const origin = getAppOrigin(req)
    res.status(201).json({
      code: created.code,
      id: created.id,
      url: `${origin}/${redeemPathForRole(role)}/${created.code}`,
      ...(personaUserId ? { account: { auth_user_id: personaUserId, email: personaEmail, name: personaName } } : {}),
    })
  } catch (error) {
    console.error('[GroupInvites] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
