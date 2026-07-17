/**
 * demoLeaf — the join primitive behind the Demos tool's arbitrary-depth
 * group tree (founder ruling 2026-07-17, spec update: "Demos", not "Demo
 * Organisations" — NO teachers/classes/students anywhere in the UI or
 * flow; a leaf entity just holds learners directly).
 *
 * Least-action implementation note (Tom, verbatim): reworking the redeem
 * model (which only ever writes CLASS: tags from an invite code's
 * grants_class_id) is more than this needs — instead, any group node the
 * admin wants learners to join gets an INVISIBLE class behind it, via a
 * hidden school (schools carry `group_id`; classes don't). Neither the
 * school nor the class is ever named, listed, or exposed as a concept in
 * the Demos UI — only the resulting join code is. No teacher/school_admin
 * account is created and no teacher/admin join code is registered for that
 * hidden school (schoolJoinCodes.ts's ensureJoinCodesRegistered is
 * deliberately NOT called here — nobody should be able to claim a
 * teacher/admin seat on a hidden school).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureClassLearnerEntity } from './classLearnerEntity'

/**
 * Walk a group's parent_id chain to its root, then read that root's
 * course_code off the demo_orgs row that owns it. Every group in a Demos
 * tree descends from exactly one demo_orgs.group_id (the tool never lets
 * two orgs share a subtree), so this is the one place a leaf's course
 * comes from — set once, at org-creation time, never re-picked per leaf.
 */
export async function resolveDemoOrgCourseCode(supabase: SupabaseClient, groupId: string): Promise<string | null> {
  let currentId: string | null = groupId
  for (let guard = 0; guard < 50 && currentId; guard++) {
    const { data: group } = await supabase.from('groups').select('id, parent_id').eq('id', currentId).maybeSingle()
    if (!group) return null
    if (!group.parent_id) {
      const { data: org } = await supabase.from('demo_orgs').select('course_code').eq('group_id', group.id).maybeSingle()
      return (org?.course_code as string) ?? null
    }
    currentId = group.parent_id as string
  }
  return null
}

export interface DemoLeaf {
  classId: string
  studentJoinCode: string
  created: boolean
}

/**
 * Idempotent: a group that already has its hidden leaf class just returns
 * it (so re-clicking "Get join code" in the tree is always safe).
 */
export async function ensureDemoLeafClass(
  supabase: SupabaseClient,
  groupId: string,
  createdBy: string,
): Promise<DemoLeaf | { error: string }> {
  const { data: existingSchools } = await supabase.from('schools').select('id').eq('group_id', groupId).limit(1)
  const existingSchoolId = existingSchools?.[0]?.id as string | undefined

  if (existingSchoolId) {
    const { data: existingClasses } = await supabase
      .from('classes')
      .select('id, student_join_code')
      .eq('school_id', existingSchoolId)
      .limit(1)
    const existing = existingClasses?.[0]
    if (existing) {
      return { classId: existing.id as string, studentJoinCode: existing.student_join_code as string, created: false }
    }
  }

  const { data: group, error: groupErr } = await supabase.from('groups').select('id, name').eq('id', groupId).maybeSingle()
  if (groupErr || !group) return { error: groupErr?.message || 'Group not found' }

  const courseCode = await resolveDemoOrgCourseCode(supabase, groupId)
  if (!courseCode) return { error: 'Could not resolve a course for this organisation' }

  let schoolId = existingSchoolId
  if (!schoolId) {
    const { data: school, error: schoolErr } = await supabase
      .from('schools')
      .insert({
        school_name: group.name as string,
        group_id: groupId,
        admin_user_id: null,
        is_demo: true,
        is_test: true,
        platform_status: 'trial',
        trial_kind: 'free_1yr',
        trial_course_code: courseCode,
        platform_expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      })
      .select('id')
      .single()
    if (schoolErr || !school) return { error: `hidden school insert failed: ${schoolErr?.message}` }
    schoolId = school.id as string
  }

  // student_join_code is trigger-generated on insert when omitted.
  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .insert({
      school_id: schoolId,
      teacher_user_id: null,
      class_name: group.name as string,
      course_code: courseCode,
    })
    .select('id, student_join_code')
    .single()
  if (clsErr || !cls) return { error: `hidden class insert failed: ${clsErr?.message}` }
  const classId = cls.id as string
  const studentJoinCode = cls.student_join_code as string

  const { error: inviteErr } = await supabase.from('invite_codes').insert({
    code: studentJoinCode,
    code_type: 'student',
    grants_class_id: classId,
    created_by: createdBy,
    is_active: true,
  })
  if (inviteErr) return { error: `join code registration failed: ${inviteErr.message}` }

  const entityResult = await ensureClassLearnerEntity(supabase, classId)
  if ('error' in entityResult) {
    console.warn('[demoLeaf] ensureClassLearnerEntity failed (non-fatal):', entityResult.error)
  }

  return { classId, studentJoinCode, created: true }
}
