/**
 * Invite Code Creation API - POST /api/invite/create
 *
 * Requires a Supabase Auth JWT. Creates a new invite code. Caller must have
 * appropriate permission for the code_type they're creating.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { generateCode } from '../_utils/codeGen'
import { boundPrivilegedCodeLimits } from '../_utils/codeGuard'
import { isWithinLeaderSubtree } from '../_utils/orgLeader'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

/**
 * Class-teacher authorization — a MEMBERSHIP test, never an ownership test.
 *
 * teacher↔class is `user_tags(tag_type='class', role_in_context='teacher')`,
 * surfaced by the `class_teachers` view; `classes.teacher_user_id` is a
 * DEMOTED denormalised lead pointer, not ownership
 * (docs/methodology/class-first-class-citizen.md). Checking only the lead
 * pointer here is what stopped a co-teacher minting a student code for their
 * own class while `api/school/delete-class.ts` already let them DELETE it.
 *
 * Shape copied from the canonical site, api/teacher/class-teachers.ts:99-134:
 * lead pointer → class relationship → platform admin → the class's school admin.
 */
async function authorizeClassTeacher(
  supabase: SupabaseClient,
  classId: string,
  userId: string
): Promise<{ classRow: { id: string; teacher_user_id: string | null; school_id: string | null } | null; authorized: boolean }> {
  const { data: cls } = await supabase
    .from('classes')
    .select('id, teacher_user_id, school_id')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return { classRow: null, authorized: false }
  const classRow = cls as unknown as { id: string; teacher_user_id: string | null; school_id: string | null }

  let authorized = classRow.teacher_user_id === userId

  if (!authorized) {
    const { data: callerTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('tag_type', 'class')
      .eq('tag_value', `CLASS:${classId}`)
      .eq('role_in_context', 'teacher')
      .eq('user_id', userId)
      .is('removed_at', null)
      .maybeSingle()
    if (callerTag) authorized = true
  }

  if (!authorized) {
    const { data: caller } = await supabase
      .from('learners')
      .select('platform_role, educational_role')
      .eq('user_id', userId)
      .maybeSingle()
    const role = caller as unknown as { platform_role?: string; educational_role?: string } | null
    if (role?.platform_role === 'ssi_admin' || role?.educational_role === 'god') authorized = true
  }

  if (!authorized && classRow.school_id) {
    const { data: school } = await supabase
      .from('schools')
      .select('admin_user_id')
      .eq('id', classRow.school_id)
      .maybeSingle()
    if ((school as unknown as { admin_user_id?: string } | null)?.admin_user_id === userId) authorized = true
  }

  return { classRow, authorized }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Verify Supabase Auth JWT
  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const {
    code_type,
    grants_region,
    grants_group_id,
    grants_school_id,
    grants_class_id,
    metadata,
    expires_at,
    max_uses,
  } = req.body || {}

  if (!code_type || typeof code_type !== 'string') {
    res.status(400).json({ error: 'Missing code_type' })
    return
  }

  const validCodeTypes = ['ssi_admin', 'god', 'govt_admin', 'school_admin', 'teacher', 'student', 'tester']
  if (!validCodeTypes.includes(code_type)) {
    res.status(400).json({ error: 'Invalid code_type' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // For govt_admin callers minting school_admin codes, the group is SERVER-
  // DERIVED from the caller's own govt_admins row — never from the client
  // payload. This one rule is what makes every leader-minted link group-bound
  // and cross-region minting impossible (region-tier-design.md §1e).
  let derivedGrantsGroupId: string | null | undefined
  // Same rule for a class-scoped teacher code: the school is read off the
  // class row, never trusted from the payload (see the teacher branch below).
  let derivedGrantsSchoolId: string | null | undefined

  try {
    // Verify caller has permission for the code_type
    if (code_type === 'ssi_admin' || code_type === 'god') {
      const { data: learner } = await supabase
        .from('learners')
        .select('platform_role, educational_role')
        .eq('user_id', userId)
        .single()
      const isAdmin = learner?.platform_role === 'ssi_admin' || learner?.educational_role === 'god'
      if (!learner || !isAdmin) {
        res.status(403).json({ error: 'Only SSi admins or god users can create admin/god codes' })
        return
      }
    } else if (code_type === 'govt_admin') {
      const { data: learner } = await supabase
        .from('learners')
        .select('platform_role')
        .eq('user_id', userId)
        .single()
      if (!learner || learner.platform_role !== 'ssi_admin') {
        // Not a platform admin — allow a group-LEADER to appoint a
        // sub-leader within their OWN governed subtree only. grants_group_id
        // is required and SERVER-VALIDATED against the caller's own
        // govt_admins.group_id (self or a strict descendant of it, via
        // isStrictDescendantGroup) — never taken on trust from the client,
        // same rule that makes the school_admin group-stamp cross-region-proof
        // above. Founder ruling 2026-08-01: a leader has "full authority over
        // everything below them ... appoint sub-leaders."
        const { data: govtAdmin } = await supabase
          .from('govt_admins')
          .select('group_id')
          .eq('user_id', userId)
          .maybeSingle()
        const ownGroupId = (govtAdmin as any)?.group_id as string | undefined
        const targetGroupId = grants_group_id as string | undefined
        if (!(await isWithinLeaderSubtree(supabase, ownGroupId, targetGroupId))) {
          res.status(403).json({ error: 'Only SSi admins can create govt_admin codes for a group outside your own subtree' })
          return
        }
      }
    } else if (code_type === 'tester') {
      const { data: learner } = await supabase
        .from('learners')
        .select('platform_role')
        .eq('user_id', userId)
        .single()
      if (!learner || learner.platform_role !== 'ssi_admin') {
        res.status(403).json({ error: 'Only SSi admins can create tester codes' })
        return
      }
    } else if (code_type === 'school_admin') {
      const { data: govtAdmin } = await supabase
        .from('govt_admins')
        .select('id, group_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (govtAdmin) {
        derivedGrantsGroupId = (govtAdmin as any).group_id ?? null
      } else {
        // ssi_admins (the /admin/invites surface) may mint school_admin codes
        // for ANY group, so the client-supplied grants_group_id is honoured for
        // them — they are the platform operator, not a region leader, so the
        // leader-scoped derivation above has nothing to derive from. The
        // leader invariant is untouched: a govt_admin caller always gets the
        // group stamped from their own row, never from the payload.
        const { data: learner } = await supabase
          .from('learners')
          .select('platform_role')
          .eq('user_id', userId)
          .single()
        if (!learner || learner.platform_role !== 'ssi_admin') {
          res.status(403).json({ error: 'Only government admins can create school_admin codes' })
          return
        }
        derivedGrantsGroupId = grants_group_id ?? null
      }
    } else if (code_type === 'teacher') {
      if (grants_class_id) {
        // CLASS-SCOPED co-teacher link (A-74). A teacher of the class — or its
        // school admin — invites a co-teacher / supply teacher straight into
        // that one class. The school grant is SERVER-DERIVED from the class so
        // redemption can write the school tag alongside the class one and the
        // co-teacher's dashboard resolves scope; it is never taken from the
        // payload on this lane, and never left null (a `SCHOOL:null` tag is
        // exactly the silent garbage this derivation prevents).
        const { classRow, authorized } = await authorizeClassTeacher(supabase, grants_class_id as string, userId)
        if (!classRow) {
          res.status(404).json({ error: 'Class not found' })
          return
        }
        if (!authorized) {
          res.status(403).json({ error: 'Only a teacher of this class or its school admin can create co-teacher codes for this class' })
          return
        }
        derivedGrantsSchoolId = classRow.school_id ?? null
      } else {
        if (!grants_school_id) {
          res.status(400).json({ error: 'grants_school_id or grants_class_id required for teacher codes' })
          return
        }
        const { data: school } = await supabase
          .from('schools')
          .select('id')
          .eq('id', grants_school_id)
          .eq('admin_user_id', userId)
          .maybeSingle()
        if (!school) {
          res.status(403).json({ error: 'Only the school admin can create teacher codes for this school' })
          return
        }
      }
    } else if (code_type === 'student') {
      if (!grants_class_id) {
        res.status(400).json({ error: 'grants_class_id required for student codes' })
        return
      }
      // MEMBERSHIP, not ownership — a co-teacher must be able to mint student
      // codes for a class they co-teach (guard S1, A-74). See
      // authorizeClassTeacher above.
      const { classRow, authorized } = await authorizeClassTeacher(supabase, grants_class_id as string, userId)
      if (!classRow || !authorized) {
        res.status(403).json({ error: 'Only a teacher of this class can create student codes for this class' })
        return
      }
    }

    // Generate unique code with up to 10 retries
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
      console.error('[InviteCreate] Failed to generate unique code after 10 attempts')
      res.status(500).json({ error: 'Could not generate unique code, please try again' })
      return
    }

    // Insert the new invite code
    const insertData: Record<string, unknown> = {
      code: newCode,
      code_type,
      created_by: userId,
      is_active: true,
    }
    if (grants_region !== undefined) insertData.grants_region = grants_region
    if (code_type === 'school_admin') {
      // Server-derived only — see derivedGrantsGroupId above. Ignore any
      // client-supplied grants_group_id for this code_type.
      insertData.grants_group_id = derivedGrantsGroupId ?? null
    } else if (grants_group_id !== undefined) {
      insertData.grants_group_id = grants_group_id
    }
    if (derivedGrantsSchoolId !== undefined) {
      // Server-derived from the class — ignore any client-supplied value.
      insertData.grants_school_id = derivedGrantsSchoolId
    } else if (grants_school_id !== undefined) {
      insertData.grants_school_id = grants_school_id
    }
    if (grants_class_id !== undefined) insertData.grants_class_id = grants_class_id
    if (metadata !== undefined) insertData.metadata = metadata

    // Privileged codes (admin / tester) are bearer tokens to elevated access —
    // force them to be bounded (must expire, must have a use cap). Onboarding
    // codes (school/teacher/student/govt) keep the caller's values as-is.
    const isPrivileged = code_type === 'ssi_admin' || code_type === 'god' || code_type === 'tester'
    if (isPrivileged) {
      const bounded = boundPrivilegedCodeLimits(expires_at, max_uses)
      insertData.expires_at = bounded.expires_at
      insertData.max_uses = bounded.max_uses
    } else {
      if (expires_at !== undefined) insertData.expires_at = expires_at
      if (max_uses !== undefined) insertData.max_uses = max_uses
    }

    const { data: created, error: insertError } = await supabase
      .from('invite_codes')
      .insert(insertData)
      .select('id, code')
      .single()

    if (insertError || !created) {
      console.error('[InviteCreate] Failed to insert invite code:', insertError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    console.log('[InviteCreate] Created code:', newCode, 'type:', code_type, 'by:', userId)
    res.status(201).json({
      code: created.code,
      id: created.id,
    })
  } catch (error) {
    console.error('[InviteCreate] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
