/**
 * Create a class ON A NODE — POST /api/school/create-class
 *
 * FOUNDER RULING (Tom, 2026-09-07): "can a class exist without a teacher? I
 * think it can — but someone has to create it, so the class has to belong to
 * a group somehow, even if the group is the root group — the org itself."
 *
 * WHY A SERVER ENDPOINT AND NOT A WIDER POLICY. The only class-creation path
 * that existed before this was the client insert in
 * packages/player-vue/src/composables/schools/useClassesData.ts, and the live
 * RLS policy behind it (`classes_insert`) is
 * `WITH CHECK (teacher_user_id = auth.uid()::text)` — so the ONLY way to make
 * a class was to name yourself its teacher on the spot. Widening that policy
 * to understand org hierarchy is exactly what this repo's RLS doctrine
 * forbids (RLS answers "is this my row?"; hierarchy authz lives in
 * server-mediated endpoints with tests). So the policy is untouched and the
 * authority check lives here.
 *
 * AUTHORITY IS THE #147 PREDICATE, REUSED, NOT A SECOND RULE.
 * resolveGroupTreeCaller + callerCanSeeGroup are the same pair the node
 * surface's other write verbs (add a group, mint an invite) authorize with:
 * ssi_admin sees the whole forest, a leader may act on their OWN governed
 * node and every strict descendant of it — never sideways, never up. A
 * school leader's governed node IS their school's own node, so "create a
 * class in the org itself" and "create a class in a sub-group" are the same
 * call with a different group_id.
 *
 * NO TEACHER REQUIRED, BY DESIGN. `classes.teacher_user_id` is nullable and
 * already null on live rows; the real teacher↔class relationship is the
 * `user_tags` CLASS:<id>/teacher row, attached afterwards through the
 * existing "Assign to a class" mechanism (api/teacher/class-teachers.ts).
 * Creation is deliberately NOT gated on a teacher existing — a leader
 * standing up next term's classes in August has no staff to name yet.
 *
 * THE COURSE IS GATED, TOO (2026-09-10). A class's course_code is not a
 * label: classCoverage.ts hands it to every student tagged into the class.
 * So this endpoint asks classCourseEntitlement.ts whether the node actually
 * has that course before it writes one — without it, a leader-created school
 * sitting on its 365-day heritage platform trial could open a class on a
 * premium Big-10 course and hand a whole class a paid course free for a year.
 *
 * GET ?group_id= returns nothing; there is no read half. The class's course
 * options come from the same catalogue every other school surface reads.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../_utils/groupTreeAuth'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { ensureClassLearnerEntity } from '../_utils/classLearnerEntity'
import { enforceMintRateLimit, CLASS_MINT_OUTCOME } from '../_utils/mintRateLimit'
import { checkClassCourseEntitlement } from '../_utils/classCourseEntitlement'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const CLASS_SELECT =
  'id, class_name, course_code, school_id, group_id, teacher_user_id, student_join_code, class_learner_id, is_active, created_at'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // An admin browsing read-only as a persona must not be able to write
  // through that persona (actAsGuard.ts).
  const viewAsRejection = rejectIfViewAs(req)
  if (viewAsRejection) {
    res.status(viewAsRejection.status).json({ error: viewAsRejection.error })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[school/create-class] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const groupId = typeof req.body?.group_id === 'string' ? req.body.group_id.trim() : ''
  // SEC25 INPUT-09: length-capped free text — same caps as
  // api/school/rename-class.ts and api/teacher/classes.ts.
  const className = typeof req.body?.class_name === 'string' ? req.body.class_name.trim().slice(0, 120) : ''
  const courseCode = typeof req.body?.course_code === 'string' ? req.body.course_code.trim().slice(0, 64) : ''

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Writes its own 401/403 on rejection.
  const caller = await resolveGroupTreeCaller(req, res, supabase)
  if (!caller) return

  if (!groupId) {
    res.status(400).json({ error: 'group_id is required' })
    return
  }
  if (!className) {
    res.status(400).json({ error: 'class_name is required' })
    return
  }
  if (!courseCode) {
    res.status(400).json({ error: 'course_code is required' })
    return
  }

  try {
    if (!(await callerCanSeeGroup(supabase, caller, groupId))) {
      res.status(403).json({ error: 'That group is not yours to add a class to' })
      return
    }

    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .maybeSingle()
    if (groupError) {
      console.error('[school/create-class] group read failed:', groupError)
      res.status(500).json({ error: groupError.message })
      return
    }
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    // A node that IS a school's own node keeps the legacy school_id arm
    // populated, so the school lane (/schools/classes, useClassesData's
    // school_id scoping) sees the class exactly like any other. A class on a
    // plain group node has no school and is reached by group_id — every
    // subtree reader already UNIONs the two (api/groups/[id]/home.ts).
    const { data: schoolForNode } = await supabase
      .from('schools')
      .select('id')
      .eq('node_group_id', groupId)
      .maybeSingle()

    // THE COURSE MUST BE ONE THIS NODE ACTUALLY HAS (classCourseEntitlement.ts).
    // A class's course_code is what classCoverage.ts hands every student in
    // it, so an unchecked course_code here is a free premium course for a
    // whole class for as long as the node's platform clock runs — up to the
    // 365-day heritage trial a leader-created school is stamped with. The
    // ladder is the settled commercial model, not a new rule: heritage always,
    // premium only on a paid node, its own trialled course, a live grant, or a
    // live ancestor org.
    const entitlement = await checkClassCourseEntitlement(supabase, {
      schoolId: (schoolForNode as { id?: string } | null)?.id ?? null,
      groupId,
      courseCode,
    })
    if (!entitlement.allowed) {
      console.warn(
        '[school/create-class] refused course', courseCode, 'for group', groupId, 'by', caller.userId,
      )
      res.status(entitlement.status ?? 403).json({
        error: entitlement.error,
        ...(entitlement.requiresCheckout ? { requires_checkout: true } : {}),
      })
      return
    }

    // Mint throttle (SEC22-01): every `classes` insert mints a join code.
    // Checked after the cheap refusals so nothing above burns a real
    // leader's budget.
    const mintLimit = await enforceMintRateLimit(supabase, req, caller.userId, CLASS_MINT_OUTCOME)
    if (!mintLimit.ok) {
      res.status(mintLimit.status).json({ error: mintLimit.error })
      return
    }

    const { data: created, error: insertError } = await supabase
      .from('classes')
      .insert({
        class_name: className,
        course_code: courseCode,
        group_id: groupId,
        school_id: (schoolForNode as { id?: string } | null)?.id ?? null,
        // THE POINT OF THIS ENDPOINT: no teacher. The lead pointer stays null
        // until somebody is assigned through api/teacher/class-teachers.ts.
        teacher_user_id: null,
        is_active: true,
      })
      .select(CLASS_SELECT)
      .single()

    if (insertError || !created) {
      console.error('[school/create-class] insert failed:', insertError)
      res.status(500).json({ error: insertError?.message || 'Failed to create class' })
      return
    }

    // Back the auto-minted student_join_code with its invite_codes row —
    // client INSERT on invite_codes was REVOKEd (20260521180000), so this is
    // the same server-side write api/teacher/create-class-join-code.ts does.
    // Non-fatal: the class works, its join link would just not resolve until
    // the code is minted, and that endpoint can still do it later.
    if ((created as { student_join_code?: string | null }).student_join_code) {
      const { error: codeError } = await supabase.from('invite_codes').insert({
        code: (created as { student_join_code: string }).student_join_code,
        code_type: 'student',
        grants_class_id: created.id,
        created_by: caller.userId,
        is_active: true,
      })
      if (codeError) {
        console.error('[school/create-class] join-code insert failed (non-fatal):', codeError)
      }
    }

    // The class's own learner entity (owner ruling 2026-07-16: a class is a
    // first-class learner citizen). Non-fatal — play-as-class re-attempts it.
    const learnerResult = await ensureClassLearnerEntity(supabase, created.id)
    if ('error' in learnerResult) {
      console.error('[school/create-class] class learner entity failed (non-fatal):', learnerResult.error)
    } else {
      ;(created as { class_learner_id?: string | null }).class_learner_id = learnerResult.learnerId
    }

    console.log('[school/create-class] created', created.id, 'in group', groupId, 'by', caller.userId)
    res.status(201).json({ class: created })
  } catch (err: any) {
    console.error('[school/create-class] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
