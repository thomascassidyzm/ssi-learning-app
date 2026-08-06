/**
 * Remove a teacher from the school — POST /api/school/remove-staff
 *
 * Server-mediated write path for TeachersView.vue's "Remove" action. The
 * direct client write it replaced (`user_tags.update({removed_at})` from the
 * browser) silently no-ops: user_tags has own-row RLS live since 2026-06-10
 * (CLAUDE.md RLS section), so a school_admin's update targeting ANOTHER
 * user's row matches zero rows — no error, no effect, and the old client
 * code reported "success" regardless (finding, 2026-07-16 teacher-loop
 * audit). Per standing doctrine, hierarchy authz (school_admin removing a
 * teacher from THEIR school) belongs in a server-mediated endpoint, never a
 * "clever" RLS policy — this mirrors api/teacher/class-teachers.ts's
 * service-role remove path, scoped to school-level staff instead of
 * class-level.
 *
 * Removing a teacher CASCADES to their class-level teacher relationships for
 * that school's classes (soft-delete, plus lead-pointer handover). Without the
 * cascade, "removed" staff kept `CLASS:<id>/teacher` tags and therefore kept
 * pupil-data visibility through resolveVisibleScope — a live authz hole once
 * co-teaching made those tags load-bearing.
 *
 * Auth: verifyAuthToken, then caller must resolve to the SAME school as
 * target_user_id's active school/teacher tag, via schools.admin_user_id or a
 * user_tags SCHOOL: tag with role_in_context 'admin' (same admin-only
 * resolution as update-profile.ts / update-seats.ts).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[school/remove-staff] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const targetUserId = typeof req.body?.target_user_id === 'string' ? req.body.target_user_id : ''
  if (!targetUserId) {
    res.status(400).json({ error: 'target_user_id is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // --- Resolve the CALLER's school, admin-only (never the body). ---
    let callerSchoolId: string | null = null
    {
      const { data: ownSchool } = await supabase
        .from('schools')
        .select('id')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      callerSchoolId = ownSchool?.id ?? null
      if (!callerSchoolId) {
        const { data: tag } = await supabase
          .from('user_tags')
          .select('tag_value')
          .eq('user_id', auth.userId)
          .eq('tag_type', 'school')
          .eq('role_in_context', 'admin')
          .is('removed_at', null)
          .limit(1)
          .maybeSingle()
        if (tag?.tag_value) callerSchoolId = String(tag.tag_value).replace('SCHOOL:', '')
      }
    }
    if (!callerSchoolId) {
      res.status(403).json({ error: 'Only a school admin can remove staff' })
      return
    }

    // --- Target must be an active TEACHER tag on the caller's own school. ---
    const { data: targetTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', targetUserId)
      .eq('tag_type', 'school')
      .eq('tag_value', `SCHOOL:${callerSchoolId}`)
      .eq('role_in_context', 'teacher')
      .is('removed_at', null)
      .maybeSingle()

    if (!targetTag) {
      res.status(404).json({ error: 'That teacher is not a member of your school' })
      return
    }

    const removedAt = new Date().toISOString()

    const { error: rmErr } = await supabase
      .from('user_tags')
      .update({ removed_at: removedAt })
      .eq('id', targetTag.id)

    if (rmErr) {
      console.error('[school/remove-staff] user_tags update failed:', rmErr)
      res.status(500).json({ error: 'Failed to remove teacher', detail: rmErr.message })
      return
    }

    // --- CASCADE: revoke their class-level teacher tags for THIS school. ---
    // Dropping only the SCHOOL: tag left a removed teacher with live
    // CLASS:<id>/teacher relationship rows, and resolveVisibleScope grants
    // learner-data visibility from those — so "removed" staff kept seeing
    // pupil dashboards for every class they co-taught. Soft-delete, same
    // shape as the school tag; scoped to the caller's own school's classes so
    // a teacher's classes at OTHER schools (or their personal tutor classes,
    // school_id IS NULL) are untouched.
    // Driven from the TEACHER's own tags (a handful) rather than the school's
    // class list (which can run to hundreds) — the `.in()` filter then stays
    // small enough never to strain a PostgREST URL.
    const cascade = { removed: 0 }
    const { data: theirClassTags, error: tagsErr } = await supabase
      .from('user_tags')
      .select('id, tag_value')
      .eq('user_id', targetUserId)
      .eq('tag_type', 'class')
      .eq('role_in_context', 'teacher')
      .is('removed_at', null)

    if (tagsErr) {
      console.error('[school/remove-staff] class-tag lookup for cascade failed:', tagsErr)
      res.status(500).json({
        error: 'Removed from school, but failed to revoke their class access — please retry',
        detail: tagsErr.message,
      })
      return
    }

    const tagByClassId = new Map<string, string>()
    for (const t of theirClassTags || []) {
      const classId = String(t.tag_value || '').replace('CLASS:', '')
      if (classId) tagByClassId.set(classId, t.id)
    }

    if (tagByClassId.size > 0) {
      // Keep only the ones belonging to THIS school — classes at other schools,
      // and their personal tutor classes (school_id IS NULL), stay untouched.
      const { data: ourClasses, error: classesErr } = await supabase
        .from('classes')
        .select('id')
        .eq('school_id', callerSchoolId)
        .in('id', [...tagByClassId.keys()])

      if (classesErr) {
        console.error('[school/remove-staff] class lookup for cascade failed:', classesErr)
        res.status(500).json({
          error: 'Removed from school, but failed to revoke their class access — please retry',
          detail: classesErr.message,
        })
        return
      }

      const tagIds = (ourClasses || [])
        .map((c: any) => tagByClassId.get(c.id))
        .filter((id): id is string => !!id)

      if (tagIds.length > 0) {
        const { error: cascadeErr } = await supabase
          .from('user_tags')
          .update({ removed_at: removedAt })
          .in('id', tagIds)

        if (cascadeErr) {
          // Loud, never swallowed: the school tag is gone but class-level access
          // may still stand. That is a live authz hole, not a cosmetic failure.
          console.error('[school/remove-staff] class-tag cascade failed:', cascadeErr)
          res.status(500).json({
            error: 'Removed from school, but failed to revoke their class access — please retry',
            detail: cascadeErr.message,
          })
          return
        }
        cascade.removed = tagIds.length
      }
    }

    // Hand on the lead pointer for any class of this school they still lead —
    // classes.teacher_user_id is a denormalised pointer, and leaving a removed
    // teacher named on it keeps them authorised by the lead disjunct.
    const { data: ledClasses, error: ledErr } = await supabase
      .from('classes')
      .select('id')
      .eq('school_id', callerSchoolId)
      .eq('teacher_user_id', targetUserId)

    if (ledErr) {
      console.error('[school/remove-staff] lead-pointer lookup failed:', ledErr)
      res.status(500).json({
        error: 'Removed from school, but failed to revoke their class access — please retry',
        detail: ledErr.message,
      })
      return
    }

    for (const led of ledClasses || []) {
      const { data: others } = await supabase
        .from('user_tags')
        .select('user_id')
        .eq('tag_type', 'class')
        .eq('tag_value', `CLASS:${led.id}`)
        .eq('role_in_context', 'teacher')
        .is('removed_at', null)
        .neq('user_id', targetUserId)
        .limit(1)

      const nextLead = others && others.length > 0 ? others[0].user_id : null
      const { error: leadErr } = await supabase
        .from('classes')
        .update({ teacher_user_id: nextLead })
        .eq('id', led.id)

      if (leadErr) {
        console.error('[school/remove-staff] lead handover failed for class', led.id, leadErr)
        res.status(500).json({
          error: 'Removed from school, but failed to revoke their class access — please retry',
          detail: leadErr.message,
        })
        return
      }
    }

    res.status(200).json({
      ok: true,
      class_tags_removed: cascade.removed,
      classes_lead_handed_over: (ledClasses || []).length,
    })
  } catch (err: any) {
    console.error('[school/remove-staff] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
