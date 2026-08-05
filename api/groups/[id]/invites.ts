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
 * GET ?scope=subtree — the LINK LEDGER (founder scope-add 2026-07-20): every
 *   link minted anywhere in this node's SUBTREE, including revoked/expired/
 *   exhausted rows — where (node/school/class name), role, species (personal
 *   vs shareable), uses n/max, status, created when/by. Root sees everything
 *   below; a school sees its own + its classes.
 * PATCH — `{ code, action: 'revoke' | 'reactivate' | 'rotate' }` — the ledger
 *   verbs. Ownership is server-verified: the code's grant target must sit in
 *   :id's subtree. 'rotate' (personal links only) mints a NEW code bound to
 *   the SAME pre-provisioned account and revokes the old one — credential
 *   rotation without touching the account; the binding never crosses the
 *   client.
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
 * Authz: the shared node-surface resolver (groupTreeAuth) — ssi_admin/god,
 * OR a leader whose own scope root (govt_admin: governed group; school_admin:
 * their school's node) is `:id` itself or a strict ancestor of it —
 * "the leader of this node, or of a node above it, may invite into it."
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateCode } from '../../_utils/codeGen'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../../_utils/groupTreeAuth'
import { ownSchoolIdForNode } from '../../_utils/schoolScope'
import { getAppOrigin, redeemPathForRole } from '../../_utils/appOrigin'
import { provisionPersona } from '../../_utils/provisionPersona'
import { sendInviteEmail, isMailable } from '../../_utils/sendInviteEmail'

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
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH') {
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

  // Authz: the shared node-surface resolver (groupTreeAuth) — ssi_admin/god
  // sees everything; a govt_admin is scoped to their governed group's
  // subtree; a school_admin to their own school's node (nav unification,
  // 2026-07-30 — the member node home's invite verbs are how a school
  // leader invites teachers now).
  const caller = await resolveGroupTreeCaller(req, res, supabase)
  if (!caller) return
  if (!(await callerCanSeeGroup(supabase, caller, groupId))) {
    res.status(403).json({ error: 'You do not govern this group' })
    return
  }
  const callerUserId = caller.userId

  // ─── Subtree scope resolution (shared by the ledger GET and PATCH) ───
  // Segment-safe path prefix (path 'a/b' matches 'a/b' and 'a/b/…', never
  // 'a/b-c'), plus the school/class bridges: schools by group_id OR
  // node_group_id in the subtree; classes by school_id in those schools.
  async function resolveSubtree() {
    const { data: nodeRow } = await supabase
      .from('groups')
      .select('id, path')
      .eq('id', groupId)
      .maybeSingle()
    if (!nodeRow) return null
    const path = (nodeRow as any).path as string
    const { data: groupRows } = await supabase
      .from('groups')
      .select('id, name')
      .or(`path.eq.${path},path.like.${path}/%`)
    const groups = (groupRows || []) as { id: string; name: string }[]
    const groupIds = groups.map((g) => g.id)
    let schools: { id: string; school_name: string; group_id: string | null; node_group_id: string | null }[] = []
    if (groupIds.length) {
      const { data: schoolRows } = await supabase
        .from('schools')
        .select('id, school_name, group_id, node_group_id')
        .or(`group_id.in.(${groupIds.join(',')}),node_group_id.in.(${groupIds.join(',')})`)
      schools = (schoolRows || []) as any[]
    }
    let classes: { id: string; class_name: string; school_id: string }[] = []
    if (schools.length) {
      const { data: classRows } = await supabase
        .from('classes')
        .select('id, class_name, school_id')
        .in('school_id', schools.map((s) => s.id))
      classes = (classRows || []) as any[]
    }
    return { groups, schools, classes, groupIds }
  }

  // ─── The words the invite email is written in ───
  // "Deborah invited you to join Seaside Model School" needs two names the
  // mailer cannot know: who is inviting, and into what. Both are read here,
  // server-side, and passed down — never taken from the client. Missing either
  // is fine: the template degrades to a sentence that still reads naturally
  // (see inviteEmailTemplate.ts), never to an empty name.
  let inviterNameCache: string | null | undefined
  async function inviterName(): Promise<string | null> {
    if (inviterNameCache !== undefined) return inviterNameCache
    const { data } = await supabase
      .from('learners')
      .select('display_name')
      .eq('user_id', callerUserId)
      .maybeSingle()
    const name = (((data as any)?.display_name as string) || '').trim()
    inviterNameCache = name && !(await looksLikeOwnEmail(name)) ? name : null
    return inviterNameCache
  }

  /**
   * A leader who never set a name still HAS one: creating an auth account
   * seeds learners.display_name from the email's local part (verified live
   * 2026-08-05 — an account made as `d.jones@…` comes back named "d.jones").
   * Signing an invitation with that would put a fragment of the inviter's
   * email in a stranger's inbox, so it counts as "no name" and the mail falls
   * back to naming the org alone.
   */
  async function looksLikeOwnEmail(name: string): Promise<boolean> {
    const { data } = await supabase.auth.admin.getUserById(callerUserId)
    const local = (data?.user?.email || '').split('@')[0].trim().toLowerCase()
    return !!local && local === name.toLowerCase()
  }

  /** The name of a node as an invitee would recognise it — its school name where it is a school. */
  async function nodeName(id: string): Promise<string | null> {
    const { data: school } = await supabase
      .from('schools')
      .select('school_name')
      .or(`group_id.eq.${id},node_group_id.eq.${id}`)
      .maybeSingle()
    if ((school as any)?.school_name) return (school as any).school_name as string
    const { data: group } = await supabase.from('groups').select('name').eq('id', id).maybeSingle()
    return ((group as any)?.name as string) || null
  }

  // ─── PATCH: the ledger verbs — revoke / reactivate / rotate ───
  if (req.method === 'PATCH') {
    const { code, action } = (req.body || {}) as { code?: string; action?: string }
    if (!code || !['revoke', 'reactivate', 'rotate', 'resend'].includes(action || '')) {
      res.status(400).json({ error: "action must be one of 'revoke', 'reactivate', 'rotate', 'resend'" })
      return
    }
    try {
      const subtree = await resolveSubtree()
      if (!subtree) {
        res.status(404).json({ error: 'Group not found' })
        return
      }
      const { data: row } = await supabase
        .from('invite_codes')
        .select('id, code, code_type, metadata, grants_group_id, grants_school_id, grants_class_id, is_active, max_uses, expires_at')
        .eq('code', code)
        .maybeSingle()
      // Ownership: the code's grant target must sit in THIS node's subtree —
      // a leader can never touch a sideways link.
      const inSubtree = !!row && (
        (row.grants_group_id && subtree.groupIds.includes(row.grants_group_id as string)) ||
        (row.grants_school_id && subtree.schools.some((s) => s.id === row.grants_school_id)) ||
        (row.grants_class_id && subtree.classes.some((c) => c.id === row.grants_class_id))
      )
      if (!row || !inSubtree) {
        res.status(404).json({ error: 'Link not found in this group' })
        return
      }

      // The org an existing link grants into — the invitee's own words for
      // where they are going, which is the link's grant target, not
      // necessarily the node the admin happens to be standing on. A class
      // link says the school; a class name alone would not tell them much.
      const classOfRow = row.grants_class_id
        ? subtree.classes.find((c) => c.id === row.grants_class_id)
        : null
      const orgNameForRow =
        (row.grants_school_id
          ? subtree.schools.find((s) => s.id === row.grants_school_id)?.school_name
          : classOfRow
            ? subtree.schools.find((s) => s.id === classOfRow.school_id)?.school_name
            : subtree.groups.find((g) => g.id === row.grants_group_id)?.name) || null

      if (action === 'revoke' || action === 'reactivate') {
        const { error: updError } = await supabase
          .from('invite_codes')
          .update({ is_active: action === 'reactivate' })
          .eq('id', row.id)
        if (updError) throw updError
        res.status(200).json({ ok: true, code: row.code, is_active: action === 'reactivate' })
        return
      }

      // resend — personal links only: same code, mail it again. The recovery
      // verb for "I sent it to the wrong address / it never arrived"; invites
      // are re-mintable ways in, so nothing heavier is warranted.
      if (action === 'resend') {
        const personalEmail = (row as any).metadata?.personal_email as string | undefined
        if (!personalEmail) {
          res.status(400).json({ error: 'No email address on this person — copy the link and send it yourself' })
          return
        }
        const roleForPath = ROLE_BY_CODE_TYPE[row.code_type as string] || 'teacher'
        const resendUrl = `${getAppOrigin(req)}/${redeemPathForRole(roleForPath)}/${row.code}`
        const result = await sendInviteEmail(personalEmail, resendUrl, {
          inviterName: await inviterName(),
          orgName: orgNameForRow,
        })
        if (!result.sent) {
          console.error('[GroupInvites] resend failed:', result.error)
          res.status(502).json({ error: `Could not send the email: ${result.error}`, url: resendUrl })
          return
        }
        res.status(200).json({ ok: true, code: row.code, url: resendUrl, emailed: { sent: true, to: personalEmail, via: result.via } })
        return
      }

      // rotate — personal links only: new code, SAME bound account + grants,
      // old code revoked. The binding is read from the stored row, never the
      // client.
      const personalUserId = (row as any).metadata?.personal_auth_user_id as string | undefined
      if (!personalUserId) {
        res.status(400).json({ error: 'Only personal links can be re-minted; mint a fresh shareable link instead' })
        return
      }
      let rotated: string | null = null
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateCode()
        const { data: existing } = await supabase
          .from('invite_codes')
          .select('id')
          .eq('code', candidate)
          .maybeSingle()
        if (!existing) { rotated = candidate; break }
      }
      if (!rotated) {
        res.status(500).json({ error: 'Could not generate unique code, please try again' })
        return
      }
      const { data: minted, error: mintError } = await supabase
        .from('invite_codes')
        .insert({
          code: rotated,
          code_type: row.code_type,
          created_by: callerUserId,
          is_active: true,
          grants_group_id: row.grants_group_id,
          grants_school_id: row.grants_school_id,
          grants_class_id: row.grants_class_id,
          max_uses: row.max_uses,
          expires_at: row.expires_at,
          metadata: (row as any).metadata,
        })
        .select('code')
        .single()
      if (mintError || !minted) throw mintError || new Error('rotate insert returned nothing')
      await supabase.from('invite_codes').update({ is_active: false }).eq('id', row.id)
      const role = ROLE_BY_CODE_TYPE[row.code_type as string] || 'teacher'
      const rotatedUrl = `${getAppOrigin(req)}/${redeemPathForRole(role)}/${(minted as any).code}`
      // A re-mint invalidates the address they were already sent, so mail the
      // replacement automatically when we have somewhere to send it.
      let rotatedEmail: { sent: boolean; to?: string; via?: 'link' | 'code'; error?: string } | null = null
      const rotatedTo = (row as any).metadata?.personal_email as string | undefined
      if (isMailable(rotatedTo)) {
        const result = await sendInviteEmail(rotatedTo, rotatedUrl, {
          inviterName: await inviterName(),
          orgName: orgNameForRow,
        })
        if (!result.sent) console.error('[GroupInvites] rotate email failed:', result.error)
        rotatedEmail = { sent: result.sent, to: rotatedTo as string, ...(result.via ? { via: result.via } : {}), ...(result.error ? { error: result.error } : {}) }
      }
      res.status(200).json({
        ok: true,
        code: (minted as any).code,
        url: rotatedUrl,
        revoked: row.code,
        ...(rotatedEmail ? { emailed: rotatedEmail } : {}),
      })
      return
    } catch (error) {
      console.error('[GroupInvites] PATCH error:', error)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  }

  // ─── GET ?scope=subtree: the LINK LEDGER ───
  if (req.method === 'GET' && req.query.scope === 'subtree') {
    try {
      const subtree = await resolveSubtree()
      if (!subtree) {
        res.status(404).json({ error: 'Group not found' })
        return
      }
      const nameByGroup = new Map(subtree.groups.map((g) => [g.id, g.name]))
      const nameBySchool = new Map(subtree.schools.map((s) => [s.id, s.school_name]))
      const nodeBySchool = new Map(subtree.schools.map((s) => [s.id, s.node_group_id || s.group_id]))
      const classById = new Map(subtree.classes.map((c) => [c.id, c]))

      const orClauses: string[] = []
      if (subtree.groupIds.length) orClauses.push(`grants_group_id.in.(${subtree.groupIds.join(',')})`)
      if (subtree.schools.length) orClauses.push(`grants_school_id.in.(${subtree.schools.map((s) => s.id).join(',')})`)
      if (subtree.classes.length) orClauses.push(`grants_class_id.in.(${subtree.classes.map((c) => c.id).join(',')})`)
      const { data: codeRows, error } = await supabase
        .from('invite_codes')
        .select('code, code_type, metadata, max_uses, use_count, expires_at, is_active, created_at, created_by, grants_group_id, grants_school_id, grants_class_id')
        .or(orClauses.join(','))
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error

      // Resolve creator display names in one query (auth uids → learners).
      const creatorIds = [...new Set((codeRows || []).map((r: any) => r.created_by).filter(Boolean))]
      const creatorName = new Map<string, string>()
      if (creatorIds.length) {
        const { data: creators } = await supabase
          .from('learners')
          .select('user_id, display_name')
          .in('user_id', creatorIds)
        for (const c of creators || []) creatorName.set((c as any).user_id, (c as any).display_name)
      }

      const origin = getAppOrigin(req)
      const now = Date.now()
      const links = (codeRows || [])
        .map((row: any) => {
          const role = ROLE_BY_CODE_TYPE[row.code_type as string]
          if (!role) return null
          let where: { nodeId: string | null; name: string; kind: 'group' | 'school' | 'class' }
          if (row.grants_class_id) {
            const cls = classById.get(row.grants_class_id)
            const schoolName = cls ? nameBySchool.get(cls.school_id) : null
            where = {
              nodeId: cls ? (nodeBySchool.get(cls.school_id) as string | null) : null,
              name: cls ? `${cls.class_name}${schoolName ? ` — ${schoolName}` : ''}` : 'a class',
              kind: 'class',
            }
          } else if (row.grants_school_id) {
            where = {
              nodeId: (nodeBySchool.get(row.grants_school_id) as string | null) ?? null,
              name: nameBySchool.get(row.grants_school_id) || 'a school',
              kind: 'school',
            }
          } else {
            where = {
              nodeId: row.grants_group_id,
              name: nameByGroup.get(row.grants_group_id) || 'a group',
              kind: 'group',
            }
          }
          const exhausted = row.max_uses !== null && row.use_count >= row.max_uses
          const expired = !!row.expires_at && new Date(row.expires_at).getTime() <= now
          const status = !row.is_active ? 'revoked' : expired ? 'expired' : exhausted ? 'exhausted' : 'active'
          return {
            role,
            species: row.metadata?.personal_auth_user_id ? 'personal' : 'shareable',
            personalName: row.metadata?.personal_name ?? null,
            // Present only when this person has a real address on file — the
            // ledger's "resend" affordance keys off it.
            personalEmail: row.metadata?.personal_email ?? null,
            code: row.code,
            url: `${origin}/${redeemPathForRole(role)}/${row.code}`,
            where,
            uses: { count: row.use_count, max: row.max_uses },
            status,
            createdAt: row.created_at,
            createdBy: creatorName.get(row.created_by) || null,
          }
        })
        .filter(Boolean)

      res.status(200).json({ links })
    } catch (error) {
      console.error('[GroupInvites] Ledger error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
    return
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
      // `personal_email` is stored so the ledger can offer "resend" without an
      // admin auth lookup per row — it is the address the leader themselves
      // just typed, never a new disclosure.
      ...(personaUserId
        ? {
            metadata: {
              personal_auth_user_id: personaUserId,
              personal_name: personaName,
              ...(isMailable(personaEmail) ? { personal_email: personaEmail } : {}),
            },
          }
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
    const url = `${origin}/${redeemPathForRole(role)}/${created.code}`

    // Auto-send the personal invite when the leader gave a real address. A
    // failure here NEVER fails the mint — the link is already good, and the
    // client falls back to "copy and send it yourself".
    let emailed: { sent: boolean; to?: string; via?: 'link' | 'code'; error?: string } | null = null
    if (personaUserId && isMailable(personaEmail)) {
      const result = await sendInviteEmail(personaEmail, url, {
        inviterName: await inviterName(),
        orgName: await nodeName(groupId),
      })
      if (!result.sent) console.error('[GroupInvites] invite email failed:', result.error)
      emailed = { sent: result.sent, to: personaEmail as string, ...(result.via ? { via: result.via } : {}), ...(result.error ? { error: result.error } : {}) }
    }

    res.status(201).json({
      code: created.code,
      id: created.id,
      url,
      ...(personaUserId ? { account: { auth_user_id: personaUserId, email: personaEmail, name: personaName } } : {}),
      ...(emailed ? { emailed } : {}),
    })
  } catch (error) {
    console.error('[GroupInvites] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
