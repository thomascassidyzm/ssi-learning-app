/**
 * Manage teacher↔class relationships — POST /api/teacher/class-teachers
 *
 * The service-role write path for the first-class-class model: add, remove, or
 * hand over a class's teachers. Teacher↔class is a time-bounded relationship in
 * `user_tags(tag_type='class', role_in_context='teacher')` (see
 * docs/methodology/class-first-class-citizen.md). The live `user_tags_insert`
 * RLS policy forbids any non-god authenticated user from inserting a
 * `role_in_context='teacher'` tag, so privileged tag writes MUST come through a
 * service-role route — this one. Mirrors `create-class-join-code.ts`.
 *
 * Body: { class_id, action: 'add' | 'remove', target_user_id, set_lead? }
 *   add    — give target_user_id a class/teacher tag (reactivates a removed one;
 *            idempotent if already active). set_lead also points classes.teacher_user_id at them.
 *   remove — soft-delete (removed_at) target's class/teacher tag. If they were
 *            the lead pointer, hand the lead to another active teacher, else null.
 *
 * Auth (founder ruling 2026-08-06 — "any group leader or the current teacher
 * of the class can add the co-teacher"): verifyAuthToken + caller must be one of:
 *   - the CURRENT (lead) teacher of the class
 *   - any group leader ABOVE the class — its school admin, or a govt_admin
 *     whose governed group contains the class at any depth
 *   - an ssi_admin / god (platform admin support bypass)
 * One exception, which is not managing anyone else: a co-teacher may remove
 * THEMSELVES, i.e. leave a class they were added to.
 * The predicate itself lives in ../_utils/classTeacherAuth.ts — shared with
 * the co-teacher invite lane so the two cannot drift.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import {
  canManageClassTeachers,
  fetchClassAuthRow,
  isActiveClassTeacher,
} from '../_utils/classTeacherAuth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface ClassTeachersBody {
  class_id?: string
  action?: 'add' | 'remove'
  target_user_id?: string
  set_lead?: boolean
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // This endpoint's ssi_admin bypass (below) exists for genuine admin
  // support actions — it must never fire while an admin is browsing
  // read-only as a persona (see actAsGuard.ts docstring).
  const viewAsRejection = rejectIfViewAs(req)
  if (viewAsRejection) {
    res.status(viewAsRejection.status).json({ error: viewAsRejection.error })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const { class_id: classId, action, target_user_id: targetUserId, set_lead: setLead } =
    (req.body || {}) as ClassTeachersBody

  if (!classId || typeof classId !== 'string') {
    res.status(400).json({ error: 'class_id is required' })
    return
  }
  if (action !== 'add' && action !== 'remove') {
    res.status(400).json({ error: "action must be 'add' or 'remove'" })
    return
  }
  if (!targetUserId || typeof targetUserId !== 'string') {
    res.status(400).json({ error: 'target_user_id is required' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const callerUserId = authResult.userId
  const tagValue = `CLASS:${classId}`

  try {
    const cls = await fetchClassAuthRow(supabase, classId)

    if (!cls) {
      res.status(404).json({ error: 'Class not found' })
      return
    }

    // ── Authorize: the lead teacher, any leader above the class, or a platform
    //    admin (the ruling). Leaving a class you co-teach is self-service. ───
    const isSelfRemoval = action === 'remove' && targetUserId === callerUserId
    const authorized = isSelfRemoval
      ? await isActiveClassTeacher(supabase, callerUserId, cls.id)
      : await canManageClassTeachers(supabase, callerUserId, cls)

    if (!authorized) {
      res.status(403).json({
        error: 'Only the class teacher or a leader above the class can manage its teachers',
      })
      return
    }

    // ── add ────────────────────────────────────────────────────────────────
    if (action === 'add') {
      // Respect the total unique (user_id, tag_type, tag_value): reactivate a
      // removed row rather than insert a duplicate.
      const { data: existing } = await supabase
        .from('user_tags')
        .select('id, removed_at')
        .eq('tag_type', 'class')
        .eq('tag_value', tagValue)
        .eq('role_in_context', 'teacher')
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (existing && existing.removed_at) {
        const { error } = await supabase
          .from('user_tags')
          .update({ removed_at: null, added_at: new Date().toISOString(), added_by: callerUserId })
          .eq('id', existing.id)
        if (error) {
          res.status(500).json({ error: 'Failed to re-add teacher', detail: error.message })
          return
        }
      } else if (!existing) {
        const { error } = await supabase.from('user_tags').insert({
          user_id: targetUserId,
          tag_type: 'class',
          tag_value: tagValue,
          role_in_context: 'teacher',
          added_by: callerUserId,
        })
        if (error) {
          res.status(500).json({ error: 'Failed to add teacher', detail: error.message })
          return
        }
      }
      // (existing && !removed_at) → already an active teacher; idempotent no-op.

      if (setLead) {
        const { error: leadErr } = await supabase
          .from('classes')
          .update({ teacher_user_id: targetUserId })
          .eq('id', cls.id)
        if (leadErr) {
          res.status(500).json({ error: 'Failed to set class lead teacher', detail: leadErr.message })
          return
        }
      }

      res.status(200).json({
        ok: true,
        action: 'add',
        class_id: cls.id,
        target_user_id: targetUserId,
        lead: setLead ? targetUserId : cls.teacher_user_id,
      })
      return
    }

    // ── remove ───────────────────────────────────────────────────────────────
    const { error: rmErr } = await supabase
      .from('user_tags')
      .update({ removed_at: new Date().toISOString() })
      .eq('tag_type', 'class')
      .eq('tag_value', tagValue)
      .eq('role_in_context', 'teacher')
      .eq('user_id', targetUserId)
      .is('removed_at', null)
    if (rmErr) {
      res.status(500).json({ error: 'Failed to remove teacher', detail: rmErr.message })
      return
    }

    // If the removed teacher was the lead pointer, hand it to another active
    // teacher (or null — the class persists teacher-less, e.g. teacher left).
    let lead = cls.teacher_user_id
    if (cls.teacher_user_id === targetUserId) {
      const { data: others } = await supabase
        .from('user_tags')
        .select('user_id')
        .eq('tag_type', 'class')
        .eq('tag_value', tagValue)
        .eq('role_in_context', 'teacher')
        .is('removed_at', null)
        .neq('user_id', targetUserId)
        .limit(1)
      lead = others && others.length > 0 ? others[0].user_id : null
      const { error: leadErr } = await supabase
        .from('classes')
        .update({ teacher_user_id: lead })
        .eq('id', cls.id)
      if (leadErr) {
        res.status(500).json({ error: 'Failed to hand over class lead teacher', detail: leadErr.message })
        return
      }
    }

    res.status(200).json({ ok: true, action: 'remove', class_id: cls.id, target_user_id: targetUserId, lead })
  } catch (err) {
    console.error('[ClassTeachers] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
