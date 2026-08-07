/**
 * ensureClassTeacherTag — the ONE way to record "this user teaches this class".
 *
 * teacher↔class is a relationship row in
 * `user_tags(tag_type='class', tag_value='CLASS:<uuid>', role_in_context='teacher')`,
 * surfaced by the `class_teachers` view. `classes.teacher_user_id` is a DEMOTED
 * denormalised LEAD POINTER, not ownership — see
 * docs/methodology/class-first-class-citizen.md.
 *
 * Every class-creation path must write BOTH. Writing only the pointer is
 * precisely how 47 of 62 live classes ended up with a lead and no relationship
 * row, which is what the 2026-08-06 backfill had to repair — without this
 * dual-write at the creation sites the backfill simply rots again.
 *
 * Idempotency respects the TOTAL unique constraint
 * `unique_active_tag UNIQUE (user_id, tag_type, tag_value)` — which is NOT
 * partial, so a soft-removed row still occupies the slot and must be
 * REACTIVATED rather than re-inserted. (Partial-indexing that constraint is a
 * hard no: the Paddle webhook's onConflict arbiter depends on it.)
 *
 * Returns `{ ok: true }` or `{ error }`. Callers must NOT swallow the error —
 * a class whose creator is not a recorded teacher of it is a broken class.
 */
export async function ensureClassTeacherTag(
  supabase: any,
  classId: string,
  teacherUserId: string,
  addedBy: string,
): Promise<{ ok: true; created: boolean; reactivated: boolean } | { error: string }> {
  const tagValue = `CLASS:${classId}`

  const { data: existing, error: readErr } = await supabase
    .from('user_tags')
    .select('id, removed_at')
    .eq('user_id', teacherUserId)
    .eq('tag_type', 'class')
    .eq('tag_value', tagValue)
    .maybeSingle()

  if (readErr) return { error: readErr.message }

  if (existing) {
    if (!existing.removed_at) return { ok: true, created: false, reactivated: false }
    const { error } = await supabase
      .from('user_tags')
      .update({
        removed_at: null,
        role_in_context: 'teacher',
        added_at: new Date().toISOString(),
        added_by: addedBy,
      })
      .eq('id', existing.id)
    if (error) return { error: error.message }
    return { ok: true, created: false, reactivated: true }
  }

  const { error } = await supabase.from('user_tags').insert({
    user_id: teacherUserId,
    tag_type: 'class',
    tag_value: tagValue,
    role_in_context: 'teacher',
    added_by: addedBy,
  })
  if (error) return { error: error.message }
  return { ok: true, created: true, reactivated: false }
}
