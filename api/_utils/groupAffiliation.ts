/**
 * Group / school membership tagging, with the 23505 rule that keeps biting.
 * =========================================================================
 *
 * Lifted verbatim out of api/code/redeem.ts (2026-09-08) so the org enrolment
 * endpoint writes membership by exactly the same rule rather than by a second
 * copy of it. Nothing about the logic changed in the move; the comments below
 * are the originals and are the reason this is shared rather than retyped.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Insert a `user_tags` membership row, REACTIVATING a soft-removed one on
 * conflict — the same pattern as `_utils/classTeacherTag.ts`'s
 * ensureClassTeacherTag, and for the same reason.
 *
 * The constraint that fires here is `unique_active_tag UNIQUE (user_id,
 * tag_type, tag_value)`, which is TOTAL — it carries NO `WHERE removed_at IS
 * NULL`. So a REMOVED tag still occupies the unique slot, and re-inviting
 * somebody who was previously removed from a class/school raised 23505,
 * inserted nothing, and — because every branch in this file used to read 23505
 * as "already tagged, idempotent success" — reported SUCCESS while the person
 * was NOT re-added. Silent, and the UI said it worked.
 *
 * 23505 therefore does not mean "already granted"; it means "the key is taken",
 * and this asks by WHOM:
 *   - taken by an ACTIVE row  → the genuine idempotent no-op (concurrent or
 *     retried redemption), unchanged behaviour.
 *   - taken by a REMOVED row  → reactivate it, which is what the re-invite was
 *     actually asking for.
 *   - no row at all           → nothing to reactivate; treated as the no-op it
 *     was before, since a lost race can also be re-read as empty here.
 *
 * Returns an error message on a real failure, or null on success/no-op.
 */
export async function insertTagReactivating(
  supabase: SupabaseClient,
  tag: {
    user_id: string
    tag_type: string
    tag_value: string
    role_in_context: string
    added_by: string
  }
): Promise<string | null> {
  const { error } = await supabase.from('user_tags').insert(tag)
  if (!error) return null
  if (error.code !== '23505') return error.message || 'user_tags insert failed'

  const { data: existing, error: readError } = await supabase
    .from('user_tags')
    .select('id, removed_at')
    .eq('user_id', tag.user_id)
    .eq('tag_type', tag.tag_type)
    .eq('tag_value', tag.tag_value)
    .maybeSingle()
  if (readError) return readError.message || 'user_tags re-read failed'
  const row = existing as { id?: string; removed_at?: string | null } | null
  if (!row || !row.removed_at) return null

  const { error: reactivateError } = await supabase
    .from('user_tags')
    .update({
      removed_at: null,
      role_in_context: tag.role_in_context,
      added_at: new Date().toISOString(),
      added_by: tag.added_by,
    })
    .eq('id', row.id)
  if (reactivateError) return reactivateError.message || 'user_tags reactivate failed'
  return null
}

/**
 * Group-scoped teacher/student affiliation (THE-MODEL.md §6, I8; I7 — any
 * node, not just leaves). Writes the GROUP: tag at the invited node, and —
 * if that node IS a school's own node (schools.node_group_id) — dual-writes
 * the legacy SCHOOL:<id> tag too (§5 item 5), so every deployed dashboard
 * still sees the person tonight without waiting on a reader repoint.
 * Returns an error message on failure, or null on success.
 */
export async function affiliateToGroupNode(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  roleInContext: 'teacher' | 'student'
): Promise<string | null> {
  // 23505 is resolved by insertTagReactivating: an ACTIVE duplicate is the
  // idempotent no-op (concurrent/retried redemption already tagged this user
  // for this group), a REMOVED duplicate is REACTIVATED — re-affiliating
  // somebody previously removed from this group is exactly what this call is
  // for, and swallowing the conflict used to drop it silently.
  const groupTagError = await insertTagReactivating(supabase, {
    user_id: userId,
    tag_type: 'group',
    tag_value: `GROUP:${groupId}`,
    role_in_context: roleInContext,
    added_by: userId,
  })
  if (groupTagError) return groupTagError

  const { data: schoolNode } = await supabase
    .from('schools')
    .select('id')
    .eq('node_group_id', groupId)
    .maybeSingle()
  if (schoolNode) {
    // 23505 here is reachable DETERMINISTICALLY, not just via a race: a user
    // already carrying this SCHOOL: tag (e.g. from an earlier school-scoped
    // code) who then redeems a group code whose node IS this school. Active
    // duplicate → no-op; removed duplicate → reactivated.
    const schoolTagError = await insertTagReactivating(supabase, {
      user_id: userId,
      tag_type: 'school',
      tag_value: `SCHOOL:${(schoolNode as any).id}`,
      role_in_context: roleInContext,
      added_by: userId,
    })
    if (schoolTagError) return schoolTagError
  }
  return null
}
