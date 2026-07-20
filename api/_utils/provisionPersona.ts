/**
 * provisionPersona — pre-provision a REAL account for a PERSONAL invite link
 * (species 1, founder-ruled 2026-07-20): role + node + display name are set
 * at mint time, so clicking the link signs the person straight into a
 * ready-made account with ZERO screens. Used only by the admin/leader-gated
 * mint path (api/groups/[id]/invites.ts POST { personal }).
 *
 * Role wiring mirrors api/code/redeem.ts's own writes exactly (same tags,
 * same dual-writes), so every deployed dashboard sees the person the moment
 * the account exists:
 *   - leader        → govt_admins row at the node
 *   - school_leader → SCHOOL:<id> tag, role admin (school nodes only)
 *   - teacher       → GROUP:<node> tag (+ SCHOOL dual-write when the node is
 *                     a school's own node)
 *   - student + class_id → CLASS:<id> tag + course enrolment
 *   - student (no class) → GROUP:<node> tag (the learner join)
 *
 * When no email is given the account is minted against a placeholder address
 * (never mailed, same convention as link-auth pupils) and flagged
 * needs_verification. learners.is_demo follows the node's own is_demo flag so
 * demo containment holds.
 */
import type { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

type Svc = ReturnType<typeof createClient>

const PERSONA_EMAIL_DOMAIN = 'invite.saysomethingin.app'

export interface PersonaSpec {
  role: 'leader' | 'school_leader' | 'teacher' | 'student'
  name: string
  email?: string
  groupId: string
  /** required for role 'student' when the link should join a CLASS */
  classId?: string
  /** the school row when the node is a school's own node (resolved by caller) */
  schoolId?: string | null
  createdBy: string
}

export interface PersonaResult {
  authUserId: string
  email: string
  learnerId: string | null
  error?: string
}

const EDUCATIONAL_ROLE: Record<PersonaSpec['role'], string> = {
  leader: 'govt_admin',
  school_leader: 'school_admin',
  teacher: 'teacher',
  student: 'student',
}

export async function provisionPersona(svc: Svc, spec: PersonaSpec): Promise<PersonaResult> {
  const email = (spec.email || '').trim().toLowerCase() || `persona-${randomUUID()}@${PERSONA_EMAIL_DOMAIN}`

  const { data: node } = await svc.from('groups').select('is_demo').eq('id', spec.groupId).maybeSingle()
  const isDemo = (node as any)?.is_demo === true

  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: {
      onboarded_via: 'possession',
      personal_link: true,
      display_name: spec.name,
    },
  })
  if (createError || !created?.user) {
    return { authUserId: '', email, learnerId: null, error: createError?.message || 'createUser failed' }
  }
  const authUserId = created.user.id

  // An auth trigger creates the learners row on createUser (verified live
  // 2026-07-20: blind insert hits learners_user_id_key) — but redeem.ts's
  // own comment says it doesn't always. Update-if-present, insert-if-not.
  const learnerFields = {
    display_name: spec.name,
    educational_role: EDUCATIONAL_ROLE[spec.role],
    needs_verification: !spec.email,
    is_demo: isDemo,
  }
  let learnerId: string | null = null
  const { data: existingLearner } = await svc
    .from('learners')
    .select('id')
    .eq('user_id', authUserId)
    .maybeSingle()
  if (existingLearner) {
    const { error: updateError } = await svc.from('learners').update(learnerFields).eq('user_id', authUserId)
    if (updateError) {
      await svc.auth.admin.deleteUser(authUserId).catch(() => {})
      return { authUserId: '', email, learnerId: null, error: `learner update failed: ${updateError.message}` }
    }
    learnerId = (existingLearner as any).id as string
  } else {
    const { data: learner, error: learnerError } = await svc
      .from('learners')
      .insert({ user_id: authUserId, ...learnerFields })
      .select('id')
      .single()
    if (learnerError) {
      await svc.auth.admin.deleteUser(authUserId).catch(() => {})
      return { authUserId: '', email, learnerId: null, error: `learner insert failed: ${learnerError.message}` }
    }
    learnerId = (learner as any)?.id as string
  }

  const tag = (tagType: string, tagValue: string, roleInContext: string) =>
    svc.from('user_tags').insert({
      user_id: authUserId,
      tag_type: tagType,
      tag_value: tagValue,
      role_in_context: roleInContext,
      added_by: spec.createdBy,
    })

  let wireError: string | null = null
  if (spec.role === 'leader') {
    const { error } = await svc.from('govt_admins').insert({
      user_id: authUserId,
      group_id: spec.groupId,
      organization_name: spec.name,
      created_by: spec.createdBy,
    })
    wireError = error?.message ?? null
  } else if (spec.role === 'school_leader') {
    if (!spec.schoolId) wireError = 'school_leader persona requires a school node'
    else {
      const { error } = await tag('school', `SCHOOL:${spec.schoolId}`, 'admin')
      wireError = error?.message ?? null
    }
  } else if (spec.role === 'teacher') {
    const { error } = await tag('group', `GROUP:${spec.groupId}`, 'teacher')
    wireError = error?.message ?? null
    if (!wireError && spec.schoolId) {
      const { error: dualError } = await tag('school', `SCHOOL:${spec.schoolId}`, 'teacher')
      wireError = dualError?.message ?? null
    }
  } else if (spec.role === 'student' && spec.classId) {
    const { data: cls } = await svc
      .from('classes')
      .select('id, course_code, school_id')
      .eq('id', spec.classId)
      .maybeSingle()
    if (!cls) wireError = 'class not found'
    else {
      const { error } = await tag('class', `CLASS:${(cls as any).id}`, 'student')
      wireError = error?.message ?? null
      if (!wireError && (cls as any).course_code && learnerId) {
        await svc.from('course_enrollments').upsert(
          { learner_id: learnerId, course_id: (cls as any).course_code },
          { onConflict: 'learner_id,course_id', ignoreDuplicates: true }
        )
      }
    }
  } else if (spec.role === 'student') {
    const { error } = await tag('group', `GROUP:${spec.groupId}`, 'student')
    wireError = error?.message ?? null
  }

  if (wireError) {
    await svc.from('learners').delete().eq('user_id', authUserId).catch(() => {})
    await svc.auth.admin.deleteUser(authUserId).catch(() => {})
    return { authUserId: '', email, learnerId: null, error: `role wiring failed: ${wireError}` }
  }

  return { authUserId, email, learnerId }
}
