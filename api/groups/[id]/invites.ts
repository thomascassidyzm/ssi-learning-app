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
import { isStrictDescendantGroup } from '../../_utils/schoolScope'
import { getAppOrigin, redeemPathForRole } from '../../_utils/appOrigin'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

type Role = 'teacher' | 'leader' | 'student'

const CODE_TYPE_BY_ROLE: Record<Role, string> = {
  leader: 'govt_admin',
  teacher: 'teacher',
  student: 'student',
}
const ROLE_BY_CODE_TYPE: Record<string, Role> = {
  govt_admin: 'leader',
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
      const { data, error } = await supabase
        .from('invite_codes')
        .select('code, code_type, max_uses, use_count, expires_at, created_at')
        .eq('grants_group_id', groupId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
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

  const { role, limits } = (req.body || {}) as {
    role?: string
    limits?: { max_uses?: number; expires_at?: string }
  }

  if (role !== 'teacher' && role !== 'leader' && role !== 'student') {
    res.status(400).json({ error: "role must be one of 'teacher', 'leader', 'student'" })
    return
  }

  try {
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
      grants_group_id: groupId,
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
    })
  } catch (error) {
    console.error('[GroupInvites] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
